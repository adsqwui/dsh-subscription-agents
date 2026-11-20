import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, isAbsolute } from 'node:path';

const path = [...new Set([join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', ...(process.env.PATH || '').split(delimiter).filter(isAbsolute)])].join(delimiter);
export const codexPrefix = ['-c', 'cli_auth_credentials_store="file"'];
export const callTimeout = 180_000;
export function cliEnv(provider, profile) {
  return { HOME: homedir(), PATH: path, LANG: 'en_US.UTF-8', TERM: 'dumb', NO_COLOR: '1', ...(provider === 'codex' ? { CODEX_HOME: profile } : { CLAUDE_CONFIG_DIR: profile }) };
}
export async function executable(name) {
  for (const dir of path.split(delimiter)) {
    const file = join(dir, name);
    try { await access(file, constants.X_OK); return file; } catch {}
  }
}
export function run(exe, args, { env, cwd, signal, timeout = 15_000, input, onOutput } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Операция отменена.'));
    const child = spawn(exe, args, { cwd, env, stdio: ['pipe','pipe','pipe'], detached: process.platform !== 'win32', windowsHide: true });
    let stdout = '', stderr = '', stopped, done = false, force;
    const kill = kind => { try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, kind); else child.kill(kind); } catch {} };
    const stop = reason => {
      if (done || stopped) return;
      stopped = reason;
      kill('SIGTERM');
      force = setTimeout(() => kill('SIGKILL'), 600);
      force.unref?.();
    };
    const abort = () => stop('Операция отменена.');
    const timer = setTimeout(() => stop('CLI не ответил вовремя.'), timeout);
    timer.unref?.();
    signal?.addEventListener('abort', abort, { once:true });
    const finish = (err, value) => {
      if (done) return; done = true;
      clearTimeout(timer); clearTimeout(force);
      signal?.removeEventListener('abort', abort);
      if (err) reject(new Error(err)); else resolve(value);
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    function consume(chunk, target) {
      if (stopped || done) return;
      if (target === 'out') stdout += chunk; else stderr += chunk;
      if (stdout.length + stderr.length > 2_000_000) return stop('CLI вернул слишком большой ответ.');
      onOutput?.(stdout, stderr);
    }
    child.stdout.on('data', chunk => consume(chunk, 'out'));
    child.stderr.on('data', chunk => consume(chunk, 'err'));
    child.stdin.on('error', () => {});
    child.on('error', () => finish('Не удалось запустить CLI.'));
    child.on('close', code => finish(stopped, { code, stdout, stderr }));
    child.stdin.end(input);
  });
}

export function command(provider, op) {
  if (provider === 'codex') {
    if (op === 'login') return [...codexPrefix, 'login'];
    if (op === 'status') return [...codexPrefix, 'login', 'status'];
    if (op === 'logout') return [...codexPrefix, 'logout'];
    return [...codexPrefix, '-a', 'never', '-c', 'web_search="disabled"', ...['shell_tool','unified_exec','apps','plugins','hooks','memories','image_generation','browser_use','computer_use','multi_agent','multi_agent_v2'].flatMap(x => ['--disable',x]), 'exec','--sandbox','read-only','--skip-git-repo-check','--ephemeral','--ignore-user-config','--ignore-rules','--json','-'];
  }
  if (op === 'login') return ['auth','login','--claudeai'];
  if (op === 'status') return ['auth','status','--json'];
  if (op === 'logout') return ['auth','logout'];
  return ['--safe-mode','-p','--output-format','stream-json','--verbose','--tools','','--strict-mcp-config','--no-chrome','--permission-prompts','none','--no-session-persistence'];
}
export function subscribed(provider, result) {
  if (result.code !== 0) return false;
  if (provider === 'codex') return /logged in using chatgpt/i.test(result.stdout + '\n' + result.stderr);
  try {
    const value = JSON.parse(result.stdout);
    return value.loggedIn === true && value.authMethod === 'claude.ai';
  } catch { return false; }
}
const CLAUDE_WINDOWS = { five_hour:'5 часов', seven_day:'7 дней', seven_day_sonnet:'Sonnet · 7 дней', seven_day_opus:'Opus · 7 дней' };
/** Older Claude Code puts one window's numbers on rate_limit_info itself; 2.1.x lists every window under unifiedWindows. */
export function claudeLimitWindows(info) {
  if (!info || typeof info !== 'object') return [];
  const unified = info.unifiedWindows && typeof info.unifiedWindows === 'object' ? Object.entries(info.unifiedWindows) : [];
  const entries = unified.some(([type]) => type === info.rateLimitType) ? unified : [[info.rateLimitType, info], ...unified];
  return entries.flatMap(([type, lim]) => {
    const label = CLAUDE_WINDOWS[type];
    const used = lim?.status === 'rejected' ? 1 : lim?.utilization;
    if (!label || !Number.isFinite(used) || used < 0 || used > 1) return [];
    return [{ label, usedPercent: Math.round(used * 10000) / 100, ...(Number.isFinite(lim.resetsAt) && lim.resetsAt > 0 && lim.resetsAt <= 8.64e12 ? { resetAt: lim.resetsAt * 1000 } : {}) }];
  });
}
function readEvents(stdout) {
  return stdout.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
}
export function inference(provider, result) {
  const events = readEvents(result.stdout);
  const limits = events.filter(e => e?.type === 'rate_limit_event').map(e => e.rate_limit_info).filter(v => v && typeof v === 'object');
  const windows = new Map();
  for (const w of limits.flatMap(claudeLimitWindows)) windows.set(w.label, w);
  const usage = windows.size ? { updatedAt: Date.now(), windows:[...windows.values()] } : undefined;
  const rejected = limits.some(x => x.status === 'rejected');
  const last = events.filter(e => e?.type === 'result').at(-1);
  const errors = events.flatMap(e => ['error','turn.failed'].includes(e?.type) ? [e.message, e.error?.message] : []);
  if (last?.is_error || result.code !== 0) errors.push(last?.result, result.stderr);
  const joined = errors.filter(x => typeof x === 'string').join(' ');
  const error = rejected || /rate.limit|usage limit|quota|hit your limit|too many requests|\b429\b/i.test(joined) ? 'quota' : /not logged|sign in|unauthorized|\b401\b|authentication/i.test(joined) ? 'auth' : 'other';
  if (result.code !== 0 || last?.is_error || events.some(e => e?.type === 'turn.failed')) return { error, usage };
  const text = provider === 'codex'
    ? events.filter(e => e?.type === 'item.completed' && e.item?.type === 'agent_message').at(-1)?.item?.text
    : last?.result;
  return typeof text === 'string' && text.trim() ? { text: text.trim().slice(0, 32_000), usage } : { error, usage };
}
