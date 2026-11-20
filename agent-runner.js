import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

const MAX_PENDING = 2 * 1024 * 1024;
const MAX_LINE = 1024 * 1024;
const MAX_TEXT = 128 * 1024;
// An oversized line is drained without buffering; only its head is kept to find which call it closes.
const OVERSIZED_HEAD = 64 * 1024;
const TIMEOUT = 30 * 60_000;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/;

/** Construct persistent CLI argv; execution cwd must match the supplied workspace. */
export function agentArgs(provider, { cwd, permissionMode, threadId, ephemeral = false } = {}) {
  if (!['read-only', 'workspace-write', 'danger-full-access'].includes(permissionMode)) throw new Error('Unsupported agent permission mode');
  if (typeof cwd !== 'string' || !cwd) throw new Error('Agent workspace is required');
  if (threadId !== undefined && (typeof threadId !== 'string' || !ID.test(threadId))) throw new Error('Invalid CLI thread identifier');
  if (ephemeral && threadId) throw new Error('An ephemeral CLI request cannot resume a thread');
  if (provider === 'codex') {
    const base = [
      '-c', 'cli_auth_credentials_store="file"', '-a', 'never', '-s', permissionMode, '-C', cwd,
      '--disable', 'multi_agent', '--disable', 'multi_agent_v2', 'exec',
    ];
    return [...base, ...(threadId ? ['resume'] : []), '--json', '--skip-git-repo-check', ...(ephemeral ? ['--ephemeral'] : []), ...(threadId ? [threadId] : []), '-'];
  }
  if (provider === 'claude') {
    // acceptEdits grants edits, not an unconfined Bash bypass, even for a full-access parent.
    return ['-p', '--output-format', 'stream-json', '--verbose', '--tools', 'default', '--permission-mode', permissionMode === 'read-only' ? 'plan' : 'acceptEdits', '--permission-prompts', 'none', ...(ephemeral ? ['--no-session-persistence'] : []), ...(threadId ? ['--resume', threadId] : [])];
  }
  throw new Error('Unsupported CLI provider');
}

const capped = value => typeof value === 'string' ? value.slice(0, MAX_TEXT) : '';
const printable = value => typeof value === 'string' ? capped(value) : capped(JSON.stringify(value ?? ''));

/** Run a persistent CLI turn; normalized events are awaited sequentially with bounded backpressure. */
export async function runAgent({ provider, exe, env, cwd, permissionMode, threadId, ephemeral, prompt, signal, onEvent }) {
  const args = agentArgs(provider, { cwd, permissionMode, threadId, ephemeral });
  if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > 512 * 1024) throw new Error('Invalid agent prompt');
  if (signal?.aborted) throw new Error('Agent cancelled');
  if (typeof onEvent !== 'function') throw new Error('Agent event callback is required');
  const child = spawn(exe, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
  const decoder = new StringDecoder('utf8');
  let pending = '', pendingBytes = 0, stderrBytes = 0, stdoutBytes = 0;
  let vendorId = threadId, text = '', usage, terminal = false, terminalError, stopped;
  let forceTimer, closed = false, processing = false, closeCode, closeSignal;
  const tools = new Map(), messages = new Set();
  let queue = [], queuedBytes = 0;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const kill = sig => { try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, sig); else child.kill(sig); } catch { /* Already stopped. */ } };
  const stop = error => {
    if (stopped) return;
    stopped = error instanceof Error ? error : new Error(error);
    queue = []; queuedBytes = 0;
    child.stdout.resume();
    kill('SIGTERM');
    forceTimer = setTimeout(() => kill('SIGKILL'), 750);
    forceTimer.unref?.();
  };
  const abort = () => stop('Agent cancelled');
  const timeout = setTimeout(() => stop('Agent execution timed out'), TIMEOUT);
  timeout.unref?.();
  signal?.addEventListener('abort', abort, { once: true });
  async function emit(event) {
    if (!stopped) await onEvent(event);
  }
  async function setThread(id) {
    if (typeof id !== 'string' || !ID.test(id)) return;
    if (vendorId && vendorId !== id) throw new Error('CLI changed the pinned thread identifier');
    if (!vendorId) { vendorId = id; await emit({ type: 'thread', id }); }
  }
  async function completedText(value, key) {
    if (!value || messages.has(key)) return;
    messages.add(key);
    const next = capped(value);
    text = capped(text ? text + '\n\n' + next : next);
    await emit({ type: 'text', text: next });
  }
  async function startTool(id, name, input) {
    if (typeof id !== 'string' || !id || tools.has(id)) return;
    if (tools.size >= 4096) throw new Error('Too many CLI tool calls');
    const item = { id: capped(id), name: capped(name), args: input && typeof input === 'object' ? input : {} };
    if (Buffer.byteLength(JSON.stringify(item.args)) > MAX_LINE) throw new Error('CLI tool input exceeds limit');
    tools.set(id, item);
    await emit({ type: 'tool-start', ...item });
  }
  async function endTool(id, name, input, value, isError) {
    await startTool(id, name, input);
    const item = tools.get(id);
    if (!item || item.ended) return;
    item.ended = true;
    const { ended, ...fields } = item;
    await emit({ type: 'tool-end', ...fields, text: printable(value), isError: Boolean(isError) });
  }
  async function codex(event) {
    if (event.type === 'thread.started') await setThread(event.thread_id);
    if (event.type === 'turn.completed') { terminal = true; usage = event.usage; }
    if (event.type === 'turn.failed' || event.type === 'error') { terminal = true; terminalError = capped(event.error?.message || event.message || 'Codex turn failed'); }
    if (!['item.started', 'item.updated', 'item.completed'].includes(event.type) || !event.item) return;
    const item = event.item, complete = event.type === 'item.completed', id = item.id;
    if (item.type === 'agent_message' && complete) return completedText(item.text, id);
    if (item.type === 'command_execution') {
      const input = { command: item.command };
      await startTool(id, 'Bash', input);
      if (complete) await endTool(id, 'Bash', input, `${item.aggregated_output || ''}${item.exit_code != null ? `\n[exit code: ${item.exit_code}]` : ''}`, item.status !== 'completed' || (item.exit_code != null && item.exit_code !== 0));
    } else if (item.type === 'file_change') {
      const input = { changes: item.changes };
      await startTool(id, 'File changes', input);
      if (complete) await endTool(id, 'File changes', input, item.changes, item.status === 'failed');
    } else if (item.type === 'mcp_tool_call') {
      const name = `${item.server}/${item.tool}`;
      await startTool(id, name, item.arguments);
      if (complete) await endTool(id, name, item.arguments, item.error?.message || item.result, item.status === 'failed');
    } else if (item.type === 'collab_tool_call') {
      const tool = typeof item.tool === 'string' ? item.tool : 'collaboration';
      const receivers = Array.isArray(item.receiver_thread_ids) ? item.receiver_thread_ids.filter(id => typeof id === 'string' && ID.test(id)) : [];
      const states = item.agents_states && typeof item.agents_states === 'object' && !Array.isArray(item.agents_states)
        ? Object.entries(item.agents_states).filter(([agent]) => ID.test(agent)).slice(0, 32) : [];
      const failed = item.status === 'failed';
      if (tool === 'wait' && !receivers.length && !states.length && !failed && !tools.has(id)) return;
      const labels = { wait:'Ожидание внутренних агентов Codex', spawn_agent:'Запуск внутреннего агента Codex', send_input:'Сообщение внутреннему агенту Codex', close_agent:'Завершение внутреннего агента Codex' };
      const input = { action:tool, agents:receivers.length ? receivers : states.map(([agent]) => agent), ...(typeof item.prompt === 'string' && item.prompt ? {prompt:item.prompt} : {}) };
      const name = `Codex ${tool}`;
      input.description = labels[tool] || 'Внутренние агенты Codex';
      await startTool(id, name, input);
      if (complete) {
        const summary = states.length ? states.map(([agent,state])=>`${agent}: ${printable(state)}`).join('\n')
          : failed ? 'Внутренний вызов Codex завершился с ошибкой.'
          : tool === 'wait' ? 'Вызов ожидания завершён. CLI не передал состояния внутренних агентов; это не означает завершение основной задачи.'
          : 'Внутренний вызов Codex завершён.';
        await endTool(id, name, input, summary, failed);
      }
    } else if (['web_search', 'todo_list'].includes(item.type)) {
      await startTool(id, item.type, item);
      if (complete) await endTool(id, item.type, item, item, item.status === 'failed');
    }
  }
  async function claude(event) {
    // Nested vendor subagents must not replace the main thread identity or replies.
    if (event.parent_tool_use_id != null) return;
    if (typeof event.session_id === 'string') await setThread(event.session_id);
    if (event.type === 'rate_limit_event') {
      const info = event.rate_limit_info;
      const label = ({ five_hour: '5 часов', seven_day: '7 дней', seven_day_sonnet: 'Sonnet · 7 дней', seven_day_opus: 'Opus · 7 дней' })[info?.rateLimitType];
      const used = info?.status === 'rejected' ? 1 : info?.utilization;
      if (label && Number.isFinite(used) && used >= 0 && used <= 1) {
        const window = { label, usedPercent: used * 100 };
        if (Number.isFinite(info.resetsAt) && info.resetsAt > 0 && info.resetsAt <= 8.64e12) window.resetAt = info.resetsAt * 1000;
        await emit({ type: 'quota', usage: { updatedAt: Date.now(), windows: [window] } });
      }
    }
    if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
      for (const [index, block] of event.message.content.entries()) {
        if (block.type === 'text') await completedText(block.text, `${event.uuid || event.message.id}:${index}`);
        if (block.type === 'tool_use') await startTool(block.id, block.name, block.input);
      }
    }
    if (event.type === 'user' && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) if (block.type === 'tool_result') await endTool(block.tool_use_id, 'Tool', {}, block.content, block.is_error);
    }
    if (event.type === 'result') {
      terminal = true; usage = event.usage;
      if (event.is_error || event.subtype !== 'success') terminalError = capped(event.result || event.errors?.join('\n') || 'Claude turn failed');
      else if (!text && event.result) await completedText(event.result, 'final-result');
    }
  }
  // A command or tool result too large for one event line closes its call with a note
  // instead of ending the turn. Lines that belong to no open call are skipped.
  async function oversized(head, bytes) {
    const id = provider === 'codex'
      ? (/"type":"item\.completed"/.test(head.slice(0, 200)) ? head.slice(head.indexOf('"item":{')).match(/"id":"([^"]+)"/)?.[1] : undefined)
      : head.match(/"tool_use_id":"([^"]+)"/)?.[1];
    const item = id ? tools.get(id) : undefined;
    if (!item || item.ended) return;
    const note = `[CLI output omitted: ${(bytes / 1048576).toFixed(1)} MB is over the ${MAX_LINE / 1048576} MB event limit. The CLI still received it.]`;
    await endTool(id, item.name, item.args, note, false);
  }
  async function drain() {
    if (processing) return;
    processing = true;
    try {
      while (queue.length && !stopped) {
        const { line, bytes, head } = queue.shift(); queuedBytes -= head === undefined ? bytes : head.length;
        if (head !== undefined) { await oversized(head, bytes); continue; }
        let event;
        try { event = JSON.parse(line); } catch { throw new Error('CLI returned malformed JSONL'); }
        if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('CLI returned invalid JSONL event');
        await (provider === 'codex' ? codex(event) : claude(event));
        if (queuedBytes < MAX_PENDING / 2 && !closed && !stopped) child.stdout.resume();
      }
    } catch (error) { stop(error); }
    finally { processing = false; if (closed && !queue.length) resolveDone(); }
  }
  let skipping = null; // { head, bytes } while the rest of an oversized line is being drained
  const queueOversized = ({ head, bytes }) => { queuedBytes += head.length; queue.push({ head, bytes }); };
  child.stdout.on('data', chunk => {
    if (stopped) return;
    stdoutBytes += chunk.length;
    if (stdoutBytes > 64 * MAX_PENDING) return stop('CLI output exceeds turn limit');
    let text = decoder.write(chunk);
    while (text) {
      if (skipping) {
        const end = text.indexOf('\n');
        skipping.bytes += Buffer.byteLength(end === -1 ? text : text.slice(0, end));
        if (end === -1) break;
        queueOversized(skipping); skipping = null; text = text.slice(end + 1);
        continue;
      }
      pending += text; text = '';
      let index;
      while ((index = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, index).trim(); pending = pending.slice(index + 1);
        if (!line) continue;
        const bytes = Buffer.byteLength(line);
        if (bytes > MAX_LINE) { queueOversized({ head: line.slice(0, OVERSIZED_HEAD), bytes }); continue; }
        queuedBytes += bytes; queue.push({ line, bytes });
      }
      pendingBytes = Buffer.byteLength(pending);
      if (pendingBytes > MAX_LINE) { skipping = { head: pending.slice(0, OVERSIZED_HEAD), bytes: pendingBytes }; pending = ''; }
    }
    if (queuedBytes > MAX_PENDING) return stop('CLI event queue exceeds limit');
    if (queuedBytes >= MAX_PENDING / 2) child.stdout.pause();
    void drain();
  });
  child.stderr.on('data', chunk => { stderrBytes += chunk.length; if (stderrBytes > MAX_PENDING * 4) stop('CLI diagnostics exceed limit'); });
  for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', error => stop(new Error(`CLI stream failed: ${error.code || 'error'}`)));
  child.once('error', error => stop(new Error(`CLI process failed: ${error.code || 'error'}`)));
  child.once('close', (code, sig) => {
    closed = true; closeCode = code; closeSignal = sig;
    pending += decoder.end();
    if (skipping && !stopped) { queueOversized(skipping); skipping = null; }
    else if (pending.trim() && !stopped) {
      const bytes = Buffer.byteLength(pending);
      if (bytes > MAX_LINE) queueOversized({ head: pending.trim().slice(0, OVERSIZED_HEAD), bytes });
      else if (queuedBytes + bytes > MAX_PENDING) stop('CLI trailing event exceeds limit');
      else { queue.push({ line: pending.trim(), bytes }); queuedBytes += bytes; }
    }
    pending = '';
    void drain();
    if (!processing && !queue.length) resolveDone();
  });
  child.stdin.end(prompt);
  if (signal?.aborted) abort();
  try {
    await done;
    if (stopped) throw stopped;
    if (closeCode !== 0 || closeSignal) throw new Error(`CLI exited unsuccessfully (${closeCode ?? closeSignal})`);
    if (terminalError) throw new Error(terminalError);
    if (!terminal) throw new Error('CLI ended without a terminal turn result');
    if (!vendorId && !ephemeral) throw new Error('CLI did not identify its persistent thread');
    return { ...(vendorId ? { threadId:vendorId } : {}), text, ...(usage ? { usage } : {}) };
  } finally {
    clearTimeout(timeout); clearTimeout(forceTimer);
    signal?.removeEventListener('abort', abort);
  }
}
