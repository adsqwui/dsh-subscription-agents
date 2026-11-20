import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

const ROUTES = { 'dsh-subscription-codex': 'codex', 'dsh-subscription-claude': 'claude' };
const LABELS = { codex:'Codex', claude:'Claude Code' };
const MAX_TEXT = 2_000_000;
const MAX_CHAT_HISTORY = 80_000;
const routeProvider = route => ROUTES[route];
const isChild = session => session.header?.origin === 'subagent';
const chatUser = m => m.role === 'user' && (!m.source || m.source.kind === 'user');
const chatText = m => m.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
function promptOf(messages) {
  let start = 0;
  for (let i = 0; i < messages.length; i++) if (messages[i].role === 'assistant') start = i + 1;
  const users = messages.slice(start).filter(m => m.role === 'user' && !['runtime-context','subagent-return'].includes(m.source?.kind));
  if (users.some(m => m.content.some(b => b.type !== 'text'))) throw new Error('CLI child currently accepts text prompts only; image and file attachments are not supported.');
  const prompt = users.flatMap(m => m.content.map(b => b.text)).join('\n\n');
  if (!prompt.trim() || prompt.length > 100_000) throw new Error('CLI child requires a nonempty text prompt within 100,000 characters.');
  return prompt;
}
function chatPromptOf(messages) {
  let start = messages.length;
  while (start > 0) {
    const previous = messages[start - 1];
    if (previous.role === 'assistant' && chatText(previous).trim()) break;
    start--;
  }
  const current = messages.slice(start).filter(chatUser);
  if (current.some(m => m.content.some(b => b.type !== 'text'))) throw new Error('Subscription chats accept text only; attachments are not supported.');
  const prompt = current.map(chatText).join('\n\n');
  if (!prompt.trim() || prompt.length > 100_000) throw new Error('Subscription chat requires a nonempty text prompt within 100,000 characters.');
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
  if (!history.length) return prompt;
  return `Previous chat messages (JSON lines, for context):\n${history.reverse().join('\n')}\n\nCurrent user request:\n${prompt}`;
}
function modelInfo(provider, account) {
  return { provider, id:account.id, name:`${LABELS[account.provider]} · подписка · ${account.name}`, inputModalities:['text'] };
}
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
  class CliAdapter extends LlmAdapter {
    providerInfo(provider) { return { id: provider, name: `${LABELS[routeProvider(provider)]} · подписка` }; }
    providerRetryPolicy() { return { mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 1000, maxDelayMs: 1000, jitterRatio: 0 }; }
    async listModels(provider) {
      return service.modelAccounts(routeProvider(provider)).map(account => modelInfo(provider,account));
    }
    async resolveModel(provider, model) {
      const account = service.modelAccounts(routeProvider(provider)).find(row => row.id === model);
      if (!account) throw new Error('Подписочный аккаунт недоступен. Проверьте вход и переключатель в панели «Подписочные агенты».');
      return modelInfo(provider,account);
    }
    async *stream(options) {
      if (options.purpose !== undefined) throw new Error('Subscription CLI does not handle auxiliary model requests.');
      const agent = ctx.agents.get(options.sessionId);
      if (!agent || agent.model.current()?.provider !== options.provider || agent.model.current()?.model !== options.model) throw new Error('CLI route requires the selected account on its live Session.');
      const policy = ctx.sandboxPolicy.resolve({ session: agent.session });
      if (policy.mode !== 'danger-full-access') throw new Error('CLI workspace execution requires Full access in this release; restricted DSH policies cannot yet be enforced by this bridge.');
      const cwd = ctx.workingDirectory.get(agent.session);
      const provider = routeProvider(options.provider);
      const session = agent.session;
      const child = isChild(session);
      const position = ctx.agents.turnBoundaryOf(session);
      const stepEvent = position.lastStepStartSeq === null ? undefined : session.eventAt(position.lastStepStartSeq);
      if (position.openTurnStartSeq === null || stepEvent?.type !== 'step/start') throw new Error('CLI turn has no open DSH step');
      const { turn, step } = stepEvent.data;
      const key = session.id;
      const old = child && Object.hasOwn(threads, key) ? threads[key] : undefined;
      if (old && (old.account !== options.model || old.provider !== provider)) throw new Error('CLI account cannot be switched inside an existing child');
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
          threads[key] = { account: options.model, provider, threadId: event.id };
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
      const operation = Promise.resolve().then(() => service.runAgentTurn(options.model, {
        cwd, permissionMode: policy.mode, threadId: old?.threadId, expectedProvider:provider, ephemeral:!child,
        prompt: child ? promptOf(options.messages) : chatPromptOf(options.messages), signal, onEvent,
      })).then(value => { result = value; }, error => { failure = error; }).finally(() => {
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
          threads[key] = { account: options.model, provider, threadId: result.threadId };
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
        yield { type: 'finish', reason: { kind: 'stop' } };
      } finally {
        closed = true;
        operationController.abort();
        await operation;
        for (const call of calls.values()) appendResult(call, 'CLI execution ended without a confirmed tool result. Do not assume the operation was completed.', true);
      }
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(Object.keys(ROUTES), new CliAdapter()));
  ctx.effect(() => ctx.subagents.registerProvider({
    name: 'subscription-cli', inheritsParentContext: false,
    capabilities: { agentOptions: true, agentPreset: false, outputSchema: false, depthLimit: true },
    async prepareContinuable({ parent }) {
      if (ctx.sandboxPolicy.resolve({ session: parent.session }).mode !== 'danger-full-access') throw new Error('CLI agents currently require Full access.');
      return {};
    },
  }));
  return { provider: 'subscription-cli', route: provider => provider === 'codex' ? 'dsh-subscription-codex' : 'dsh-subscription-claude' };
}
