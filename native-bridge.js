import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

// Older selections name the account as the model on these per-vendor routes; they still resolve but list nothing.
const ROUTES = { 'dsh-subscription-codex': 'codex', 'dsh-subscription-claude': 'claude' };
// Every account is its own provider route, and its models are the ones its CLI lists.
const ACCOUNT_ROUTE = /^dsh-subscription-(codex|claude)-([1-9][0-9]{0,8})$/;
const DEFAULT_MODEL = 'default';
const LABELS = { codex:'Codex', claude:'Claude Code' };
const MAX_TEXT = 2_000_000;
const MAX_CHAT_HISTORY = 80_000;
const accountRoute = account => `dsh-subscription-${account.provider}-${account.number}`;
function parseRoute(route) {
  if (Object.hasOwn(ROUTES, route)) return { provider: ROUTES[route] };
  const match = ACCOUNT_ROUTE.exec(route ?? '');
  return match ? { provider: match[1], number: Number(match[2]) } : undefined;
}
const routeProvider = route => parseRoute(route)?.provider;
const isChild = session => session.header?.origin === 'subagent';
const chatUser = m => m.role === 'user' && (!m.source || m.source.kind === 'user');
const chatText = m => m.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
// Both CLIs read PNG, JPEG, GIF and WebP; 2000 px and 3.75 MB keep a base64 image under Claude's 5 MB per-image limit.
const IMAGE_EDGE = 2000;
const IMAGE_BYTES = 3_750_000;
/** Text and image references of the current user turn; an offloaded image becomes a note naming it. */
function userInput(messages, what) {
  const texts = [], images = [];
  for (const block of messages.flatMap(m => m.content)) {
    if (block.type === 'text') texts.push(block.text);
    else if (block.type === 'image' && block.offloaded) texts.push(`[Image ${block.attachment?.name ?? ''} was removed from this conversation to save space.]`);
    else if (block.type === 'image') images.push(block.attachment);
    else throw new Error(`${what} accepts text and images; ${block.type} attachments are not supported.`);
  }
  let prompt = texts.join('\n\n');
  if (!prompt.trim() && images.length) prompt = 'See the attached image.';
  if (!prompt.trim() || prompt.length > 100_000) throw new Error(`${what} requires a nonempty prompt within 100,000 characters.`);
  return { prompt, images };
}
function promptOf(messages) {
  let start = 0;
  for (let i = 0; i < messages.length; i++) if (messages[i].role === 'assistant') start = i + 1;
  return userInput(messages.slice(start).filter(m => m.role === 'user' && !['runtime-context','subagent-return'].includes(m.source?.kind)), 'CLI child');
}
function chatPromptOf(messages) {
  let start = messages.length;
  while (start > 0) {
    const previous = messages[start - 1];
    if (previous.role === 'assistant' && chatText(previous).trim()) break;
    start--;
  }
  const { prompt, images } = userInput(messages.slice(start).filter(chatUser), 'Subscription chat');
  const history = [];
  let bytes = 0;
  for (let i = start - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant' && !chatUser(m)) continue;
    const text = chatText(m);
    if (!text.trim()) continue;
    const line = JSON.stringify({ role:m.role,text });
    bytes += Buffer.byteLength(line) + 1;
    if (bytes > MAX_CHAT_HISTORY) break;
    history.push(line);
  }
  if (!history.length) return { prompt, images };
  return { prompt:`Previous chat messages (JSON lines, for context):\n${history.reverse().join('\n')}\n\nCurrent user request:\n${prompt}`, images };
}
// Codex and Claude Code both take image input, so both routes declare it to DSH.
function legacyInfo(provider, account) {
  return { provider, id:account.id, name:`${LABELS[account.provider]} · подписка · ${account.name}`, inputModalities:['text','image'] };
}
// Before the CLI has listed its models, the account offers one entry that leaves the choice to the CLI.
const catalogOf = account => account.models?.length ? account.models : [{ id:DEFAULT_MODEL, name:'Модель CLI по умолчанию', inputModalities:['text','image'] }];
const modelInfo = (provider, model) => ({ provider, id:model.id, name:model.name, inputModalities:model.inputModalities });
function* textBlock(index, text) {
  yield { type:'block-start', index, blockType:'text' };
  yield { type:'text-delta', index, text };
  yield { type:'block-end', index, block:{ type:'text',text } };
}
/** Install continuable native child sessions routed through official CLI turns. */
export async function installNativeBridge(ctx, service) {
  const root = join(ctx.profileContext.dir, 'subscription-agents');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, 'native-threads.json');
  let threads;
  try { threads = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; threads = {}; }
  if (!threads || typeof threads !== 'object' || Array.isArray(threads)) throw new Error('Invalid CLI thread registry');
  let writes = Promise.resolve();
  function persist() {
    const text = JSON.stringify(threads);
    const next = writes.catch(() => {}).then(async () => {
      const temp = join(root, `native-threads-${randomUUID()}.tmp`);
      await writeFile(temp, text, { mode: 0o600 });
      await rename(temp, path);
    });
    writes = next;
    return next;
  }
  // Blank chats display the default from the browser's shared model catalog.
  // Refresh it after the Host commits a selection involving a subscription.
  let previousDefault = ctx.agentDefaultModel.currentSelection();
  ctx.on('app-boot/config-reload', () => {
    const next = ctx.agentDefaultModel.currentSelection();
    const previous = previousDefault;
    previousDefault = next;
    if (previous.provider === next.provider && previous.model === next.model &&
        previous.reasoningEffort === next.reasoningEffort) return;
    const route = routeProvider(next.provider) ? next.provider : previous.provider;
    if (routeProvider(route)) ctx.emit('llm/models-updated', route);
  });
  const cleanups = new Map();
  const life = new AbortController();
  ctx.effect(() => () => { life.abort(); for (const dispose of cleanups.values()) dispose(); cleanups.clear(); return writes; });
  function configure(agent) {
    if (!isChild(agent.session) || !routeProvider(agent.model.current()?.provider) || cleanups.has(agent)) return;
    const dispose = agent.ctx.effect(() => agent.ctx.tools.restrict({ allow: [] }));
    cleanups.set(agent, dispose);
  }
  ctx.on('agent/created', ({ agent }) => configure(agent));
  ctx.on('agent/disposed', ({ agent }) => { cleanups.delete(agent); });
  for (const agent of ctx.agents.list()) configure(agent);
  const accountOf = route => {
    const parsed = parseRoute(route);
    return parsed?.number === undefined ? undefined : service.modelAccounts(parsed.provider).find(a => a.number === parsed.number);
  };
  const routes = () => [...Object.keys(ROUTES), ...Object.values(ROUTES).flatMap(provider => service.modelAccounts(provider).map(accountRoute))];
  async function readImages(refs, signal) {
    if (!refs.length) return [];
    const store = ctx.get('attachments');
    if (!store) throw new Error('Image input needs the DSH attachment service, which is not loaded.');
    const images = [];
    for (const ref of refs) {
      const scale = Math.min(1, IMAGE_EDGE / Math.max(ref.width, ref.height));
      const target = { width: Math.max(1, Math.round(ref.width * scale)), height: Math.max(1, Math.round(ref.height * scale)), maxBytes: IMAGE_BYTES };
      const version = await store.readImageRequest(ref, target, signal);
      images.push({ mediaType: version.mediaType, data: version.data });
    }
    return images;
  }
  class CliAdapter extends LlmAdapter {
    providerInfo(provider) {
      const account = accountOf(provider);
      return { id: provider, name: `${LABELS[routeProvider(provider)]} · подписка${account ? ` · ${account.name}` : ''}` };
    }
    providerRetryPolicy() { return { mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 1000, maxDelayMs: 1000, jitterRatio: 0 }; }
    async listModels(provider) {
      const account = accountOf(provider);
      return account ? catalogOf(account).map(model => modelInfo(provider,model)) : [];
    }
    async resolveModel(provider, model) {
      const parsed = parseRoute(provider);
      const account = parsed?.number === undefined ? service.modelAccounts(parsed?.provider).find(row => row.id === model) : accountOf(provider);
      if (!account) throw new Error('Подписочный аккаунт недоступен. Проверьте вход и переключатель в панели «Подписочные агенты».');
      if (parsed.number === undefined) return legacyInfo(provider,account);
      const entry = catalogOf(account).find(row => row.id === model);
      if (!entry) throw new Error('Эта модель недоступна в подписке аккаунта. Выберите другую модель.');
      return modelInfo(provider,entry);
    }
    async *stream(options) {
      if (options.purpose !== undefined) throw new Error('Subscription CLI does not handle auxiliary model requests.');
      const agent = ctx.agents.get(options.sessionId);
      if (!agent || agent.model.current()?.provider !== options.provider || agent.model.current()?.model !== options.model) throw new Error('CLI route requires the selected account on its live Session.');
      const policy = ctx.sandboxPolicy.resolve({ session: agent.session });
      if (policy.mode !== 'danger-full-access') throw new Error('CLI workspace execution requires Full access in this release; restricted DSH policies cannot yet be enforced by this bridge.');
      const cwd = ctx.workingDirectory.get(agent.session);
      const provider = routeProvider(options.provider);
      const routed = parseRoute(options.provider)?.number === undefined ? undefined : accountOf(options.provider);
      if (parseRoute(options.provider)?.number !== undefined && !routed) throw new Error('Подписочный аккаунт недоступен. Проверьте вход и переключатель в панели «Подписочные агенты».');
      const accountId = routed ? routed.id : options.model;
      const cliModel = routed && options.model !== DEFAULT_MODEL ? options.model : undefined;
      const session = agent.session;
      const child = isChild(session);
      const position = ctx.agents.turnBoundaryOf(session);
      const stepEvent = position.lastStepStartSeq === null ? undefined : session.eventAt(position.lastStepStartSeq);
      if (position.openTurnStartSeq === null || stepEvent?.type !== 'step/start') throw new Error('CLI turn has no open DSH step');
      const { turn, step } = stepEvent.data;
      const key = session.id;
      const old = child && Object.hasOwn(threads, key) ? threads[key] : undefined;
      if (old && (old.account !== accountId || old.provider !== provider)) throw new Error('CLI account cannot be switched inside an existing child');
      const operationController = new AbortController();
      const signal = AbortSignal.any([life.signal, operationController.signal, ...(options.signal ? [options.signal] : [])]);
      const calls = new Map();
      const pendingText = [];
      let failure, result, closed = false, settled = false, wake, bytes = 0, textCount = 0;
      const appendResult = (call, output, isError) => session.append('tool/result', {
        turn, step, message: { id: randomUUID(), role: 'tool', source: { kind: 'tool', callId: call.id }, toolCallId: call.id, content: [{ type: 'text', text: String(output ?? '').slice(0, 100_000) }], ...(isError ? { isError: true } : {}) },
      }, { surfaceOp: 'append' });
      function enqueueText(text) {
        if (!text.trim()) return;
        bytes += Buffer.byteLength(text);
        if (bytes > MAX_TEXT || ++textCount > 4096) throw new Error('CLI turn output exceeded the transcript limit');
        pendingText.push(text);
        wake?.();
      }
      async function onEvent(event) {
        if (closed || signal.aborted) return;
        if (event.type === 'thread' && typeof event.id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(event.id)) {
          if (!child) return;
          threads[key] = { account: accountId, provider, threadId: event.id };
          try { await persist(); } catch (error) { operationController.abort(); throw error; }
        } else if (event.type === 'text' && typeof event.text === 'string') {
          enqueueText(event.text);
        } else if (event.type === 'tool-start') {
          const remoteId = String(event.id);
          if (calls.has(remoteId)) return;
          const name = `subscription_cli_${String(event.name ?? 'tool').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 70)}`;
          const args = typeof event.args === 'string' ? event.args : JSON.stringify(event.args ?? {});
          const call = { id: randomUUID(), name, arguments: args.slice(0, 100_000) };
          session.append([
            ['assistant/message', { turn, step, message: { id: randomUUID(), role: 'assistant', source: { kind: 'model', provider: options.provider, model: options.model }, content: [{ type: 'tool-call', ...call }] }, stream: [] }, { surfaceOp: 'append' }],
            ['tool/call', { turn, step, callId: call.id, name, arguments: call.arguments }],
          ]);
          calls.set(remoteId, call);
        } else if (event.type === 'tool-end') {
          const remoteId = String(event.id);
          const call = calls.get(remoteId);
          if (call) { appendResult(call, event.text, Boolean(event.isError)); calls.delete(remoteId); }
        }
      }
      const operation = Promise.resolve().then(async () => {
        const input = child ? promptOf(options.messages) : chatPromptOf(options.messages);
        return service.runAgentTurn(accountId, {
          cwd, permissionMode: policy.mode, ...(cliModel ? { model: cliModel } : {}), threadId: old?.threadId, expectedProvider:provider, ephemeral:!child,
          prompt: input.prompt, images: await readImages(input.images, signal), signal, onEvent,
        });
      }).then(value => { result = value; }, error => { failure = error; }).finally(() => {
        settled = true;
        wake?.();
      });
      try {
        let index = 0;
        while (pendingText.length || !settled) {
          if (!pendingText.length) {
            await new Promise(resolve => { wake = resolve; });
            wake = undefined;
            continue;
          }
          if (signal.aborted) throw new Error('CLI turn canceled');
          yield* textBlock(index++, pendingText.shift());
        }
        await operation;
        if (child && result?.threadId && threads[key]?.threadId !== result.threadId) {
          threads[key] = { account: accountId, provider, threadId: result.threadId };
          await persist();
        }
        if (child) await writes;
        if (failure) throw failure;
        if (result?.ok === false) throw new Error(result.error || 'CLI turn failed');
        if (signal.aborted) throw new Error('CLI turn canceled');
        if (index === 0) {
          if (typeof result?.text !== 'string' || !result.text.trim()) throw new Error('CLI завершил ход, но не вернул ответ.');
          yield* textBlock(index, result.text);
        }
        // The CLI's own token count for the whole turn, so DSH usage totals include subscription turns.
        if (result?.tokens) yield { type: 'usage', usage: result.tokens };
        yield { type: 'finish', reason: { kind: 'stop' } };
      } finally {
        closed = true;
        operationController.abort();
        await operation;
        for (const call of calls.values()) appendResult(call, 'CLI execution ended without a confirmed tool result. Do not assume the operation was completed.', true);
      }
    }
  }
  let registration, registered;
  ctx.effect(() => {
    registered = routes();
    registration = ctx.llm.registerAdapter(registered, new CliAdapter());
    return () => { registration?.(); registration = undefined; };
  });
  /** Bring the provider routes in line with the enabled accounts and tell DSH which catalogs changed. */
  function sync(provider) {
    const next = routes();
    if (registration && next.join() !== registered.join()) { registration.replace(next); registered = next; }
    for (const route of next) if (routeProvider(route) === provider) ctx.emit('llm/models-updated', route);
  }
  ctx.effect(() => ctx.subagents.registerProvider({
    name: 'subscription-cli', inheritsParentContext: false,
    capabilities: { agentOptions: true, agentPreset: false, outputSchema: false, depthLimit: true },
    async prepareContinuable({ parent }) {
      if (ctx.sandboxPolicy.resolve({ session: parent.session }).mode !== 'danger-full-access') throw new Error('CLI agents currently require Full access.');
      return {};
    },
  }));
  return { provider: 'subscription-cli', route: accountRoute, models: catalogOf, sync };
}
