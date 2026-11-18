import { mkdir, chmod, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cliEnv, command, executable, inference, run, subscribed, codexPrefix, callTimeout } from './cli.js';
import { readCodexUsage } from './codex-usage.js';
import { runAgent } from './agent-runner.js';

const providers = ['codex','claude'];
const names = {codex:'ChatGPT / Codex',claude:'Claude Code'};
const fail = message => ({ok:false,error:message});
const ok = value => ({ok:true,...value});
const LIMIT = 24;
const FRESH = 6 * 60_000;
export function remaining(a, now = Date.now()) {
  if (!a.usage || now - a.usage.updatedAt >= FRESH || !a.usage.windows.length || a.usage.windows.some(w => now - (w.sampledAt ?? a.usage.updatedAt) >= FRESH || (w.resetAt && w.resetAt <= now))) return undefined;
  return Math.min(...a.usage.windows.map(w => 100 - w.usedPercent));
}
export function pickAccount(accounts, provider, now = Date.now()) {
  return accounts.filter(a => a.enabled && a.status === 'ready' && !a.busy && !(a.cooldown > now) && (!provider || a.provider === provider) && remaining(a, now) !== 0)
    .sort((a,b) => (remaining(b, now) ?? -1) - (remaining(a, now) ?? -1) || (a.lastUsed ?? 0)-(b.lastUsed ?? 0) || a.number-b.number)[0];
}
export async function makeService(root, options = {}) {
  if (!isAbsolute(root)) throw new Error('Expected an absolute profile directory');
  const cliRun = options.run ?? run, resolve = options.executable ?? executable, getUsage = options.readCodexUsage ?? readCodexUsage;
  const life = new AbortController();
  const cwd = join(root,'empty');
  const file = join(root,'accounts.json');
  await mkdir(cwd,{recursive:true,mode:0o700}); await chmod(root,0o700);
  let db;
  try { db = JSON.parse(await readFile(file,'utf8')); } catch(e) { if (e.code !== 'ENOENT') throw e; db = {next:1, accounts:[]}; }
  if (!Number.isSafeInteger(db.next) || db.next < 1 || !Array.isArray(db.accounts) || db.accounts.some(a => !/^[a-f0-9-]{36}$/.test(a.id) || !providers.includes(a.provider))) throw new Error('Invalid subscription account data');
  const active = new Map();
  const modelAccounts = provider => db.accounts
    .filter(a => a.provider === provider && a.enabled && a.status === 'ready' && a.testPassed === true)
    .map(({id,name,provider,number}) => ({id,name,provider,number}));
  const catalogs = new Map(providers.map(provider => [provider,JSON.stringify(modelAccounts(provider))]));
  function publishCatalogChanges() {
    for (const provider of providers) {
      const catalog = JSON.stringify(modelAccounts(provider));
      if (catalog === catalogs.get(provider)) continue;
      catalogs.set(provider,catalog);
      options.onCatalogChanged?.(provider);
    }
  }
  let writes = Promise.resolve();
  const persist = () => {
    const serialized = JSON.stringify(db, (k,v) => ['busy','loginUrl'].includes(k) ? undefined : v);
    const commit = writes.catch(() => {}).then(async () => {
      const temp = join(root,'accounts.tmp');
      await writeFile(temp,serialized,{mode:0o600}); await rename(temp,file);
      publishCatalogChanges();
    });
    writes = commit; return commit;
  };
  let lastDiscovery = 0, discovered = {};
  async function availability() {
    if (Date.now()-lastDiscovery > 15_000) {
      discovered = Object.fromEntries(await Promise.all(providers.map(async provider => [provider,await resolve(provider)])));
      lastDiscovery = Date.now();
    }
    return discovered;
  }
  const dir = a => join(root, a.id);
  function view(a, user = false) {
    return Object.fromEntries(['id','number','provider','name','enabled','status','busy','note','usage','checkedAt','testPassed',...(user ? ['loginUrl'] : [])].filter(k=>a[k]!==undefined).map(k=>[k,a[k]]));
  }
  function start(a, busy, fn, parent) {
    if (active.has(a.id)) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([life.signal, controller.signal, ...(parent ? [parent] : [])]);
    a.busy = busy;
    const task = Promise.resolve().then(() => fn(signal)).catch(e => {
      a.note = signal.aborted ? 'Операция отменена.' : e.message;
      if (busy === 'login') a.status = 'error';
      return fail(a.note);
    }).finally(async () => {
      delete a.loginUrl;
      delete a.busy;
      try { await persist(); } finally { active.delete(a.id); }
    });
    active.set(a.id,{controller,task,busy});
    return task;
  }
  async function execute(a, op, signal, opts) {
    const exe = (await availability())[a.provider];
    if (!exe) throw new Error(`Не найден официальный CLI: ${names[a.provider]}.`);
    const profile = dir(a);
    await mkdir(profile,{mode:0o700,recursive:true});
    return cliRun(exe, command(a.provider,op), { cwd, env:cliEnv(a.provider,profile), signal, ...opts });
  }
  async function status(a, signal) {
    const valid = subscribed(a.provider, await execute(a,'status',signal));
    a.checkedAt = Date.now();
    a.status = valid ? 'ready' : 'new';
    if (!valid) { delete a.usage; a.note = 'CLI не подтвердил вход по подписке.'; }
    return valid;
  }
  async function quota(a, signal) {
    if (a.provider !== 'codex') return;
    const exe = (await availability())[a.provider];
    if (!exe) return;
    try {
      const usage = await getUsage({exe,argsPrefix:codexPrefix,cwd,env:cliEnv(a.provider,dir(a)),signal});
      if (usage) a.usage = usage;
    } catch { /* An unavailable snapshot is not zero usage. */ }
  }
  async function invoke(a, prompt, signal, testing = false) {
    if (testing) {
      a.testPassed = false;
      publishCatalogChanges();
    }
    if (!await status(a,signal)) return fail(a.note);
    const raw = await execute(a,'infer',signal,{input:prompt,timeout: testing ? 75_000 : callTimeout});
    const reply = inference(a.provider,raw);
    if (reply.usage) {
      const previous = a.usage?.windows.filter(w => Date.now() - (w.sampledAt ?? a.usage.updatedAt) < FRESH && (!w.resetAt || w.resetAt > Date.now())) ?? [];
      const windows = new Map(previous.map(w => [w.label,w]));
      for (const w of reply.usage.windows) windows.set(w.label,{...w,sampledAt:reply.usage.updatedAt});
      a.usage = {...reply.usage,windows:[...windows.values()]};
    }
    await quota(a,signal);
    if (signal.aborted) return fail('Операция отменена.');
    a.lastUsed = Date.now();
    if (reply.error || (testing && reply.text !== 'OK')) {
      a.note = reply.error === 'quota' ? 'CLI сообщил о лимите. Повтор автоматически не запускается.' : reply.error === 'auth' ? 'Авторизация CLI не подтверждена. Войдите заново.' : testing && reply.text ? 'CLI ответил, но не вернул ожидаемое OK.' : 'CLI не вернул результат.';
      if (reply.error === 'auth') a.status = 'new';
      if (reply.error === 'quota') a.cooldown = Date.now() + 5*60_000;
      return fail(a.note);
    }
    delete a.cooldown;
    if (testing) a.testPassed = true;
    a.note = testing ? 'Проверка пройдена: CLI ответил OK.' : 'Последняя задача завершена.';
    return ok({account:{number:a.number,provider:a.provider,name:a.name},text:reply.text});
  }
  function refresh(a) {
    if (a.busy || a.status !== 'ready') return;
    return start(a,'refresh',async signal => { if (await status(a,signal)) await quota(a,signal); });
  }
  function background(p) { p?.catch(() => {}); }
  const interval = setInterval(() => { for (const a of db.accounts) if (a.provider === 'codex') background(refresh(a)); },180_000);
  interval.unref?.();
  async function action(body, {user=false, signal}={}) {
    if (life.signal.aborted || !body || typeof body !== 'object' || Array.isArray(body)) return fail('Некорректный запрос.');
    if (!user && !['list','refresh','test','delegate'].includes(body.action)) return fail('Это действие доступно только пользователю в панели.');
    if (body.action === 'list') {
      const av = await availability();
      return ok({accounts:db.accounts.map(a=>view(a,user)),available:Object.fromEntries(providers.map(p=>[p,Boolean(av[p])]))});
    }
    if (body.action === 'add') {
      if (!providers.includes(body.provider) || db.accounts.length >= LIMIT || !(await availability())[body.provider]) return fail('CLI не найден, выбран неверный тип или достигнут предел аккаунтов.');
      if (db.accounts.length >= LIMIT) return fail('Достигнут предел аккаунтов.');
      const number = db.next++;
      const a = {id:randomUUID(),number,provider:body.provider,name:cleanName(body.name) || `${names[body.provider]} #${number}`,enabled:false,status:'new'};
      db.accounts.push(a); await persist(); return ok({account:view(a)});
    }
    if (body.action === 'delegate') {
      if (user || typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 70_000 || (body.provider != null && !providers.includes(body.provider))) return fail('Неверный запрос делегирования.');
      const a = pickAccount(db.accounts,body.provider);
      if (!a) return fail('Нет подключённого свободного аккаунта с разрешением на делегирование.');
      return fail('Для делегирования используйте управляемую дочернюю сессию.');
    }
    if (body.action === 'refresh' && !body.id) { for (const a of db.accounts) background(refresh(a)); return ok({}); }
    const a = db.accounts.find(x => x.id === body.id);
    if (!a) return fail('Аккаунт не найден.');
    if (body.action === 'cancel') {
      const work = active.get(a.id);
      if (work && ['login','test','refresh'].includes(work.busy)) work.controller.abort();
      return ok({});
    }
    if (body.action === 'toggle' && body.enabled === false) {
      a.enabled = false;
      const work = active.get(a.id);
      if (work?.busy === 'delegate') work.controller.abort();
      await persist(); return ok({});
    }
    if (a.busy) return fail('Аккаунт занят.');
    if (body.action === 'rename') {
      if (!cleanName(body.name)) return fail('Введите имя аккаунта.');
      a.name = cleanName(body.name); await persist(); return ok({});
    }
    if (body.action === 'toggle') {
      if (a.status !== 'ready' || a.testPassed !== true || body.enabled !== true) return fail('Сначала войдите в аккаунт и пройдите проверку CLI.');
      a.enabled = true; await persist(); return ok({});
    }
    if (body.action === 'login') {
      if (db.accounts.some(x=>x.busy === 'login')) return fail('Сначала завершите предыдущий вход.');
      a.enabled = false; a.testPassed = false; a.status = 'login'; delete a.usage;
      publishCatalogChanges();
      a.note = 'Завершите вход в браузере на этом компьютере.';
      background(start(a,'login',async signal => {
        const result = await execute(a,'login',signal,{timeout:300_000,onOutput:(out,err)=>{
          if (!a.loginUrl) a.loginUrl = officialLoginUrl(a.provider,out+'\n'+err);
        }});
        if (result.code !== 0 || !await status(a,signal)) {a.status='error'; a.note='CLI не подтвердил вход. Попробуйте снова.'; return;}
        a.busy = 'test'; delete a.loginUrl;
        a.note = 'Вход подтверждён. Выполняется проверка CLI.';
        const resultTest = await invoke(a,'Reply with exactly OK. No explanation.',signal,true).catch(e => fail(e.message));
        if (!resultTest.ok && a.status === 'ready') a.note = `Вход выполнен. ${a.note}`;
      }));
      return ok({});
    }
    if (body.action === 'refresh') {
      background(start(a,'refresh',async signal => {if (await status(a,signal)) await quota(a,signal);})); return ok({});
    }
    if (body.action === 'test') {
      if (!user && !a.enabled) return fail('Сначала разрешите делегирование для этого аккаунта в панели.');
      const task = start(a,'test',signal=>invoke(a,'Reply with exactly OK. No explanation.',signal,true));
      if (!user) return task;
      background(task); return ok({});
    }
    if (body.action === 'remove') {
      return start(a,'remove',async signal => {
        if (a.status === 'ready' || a.checkedAt || a.provider === 'claude') {
          const result = await execute(a,'logout',signal);
          if (result.code !== 0) return fail('CLI не подтвердил выход; аккаунт не удалён.');
        }
        // Only a validated UUID child of our private state directory may be removed.
        const target = dir(a);
        if (target !== join(root,a.id) || !/^[a-f0-9-]{36}$/.test(a.id)) return fail('Неверный каталог аккаунта.');
        await rm(target,{recursive:true,force:true});
        db.accounts = db.accounts.filter(x=>x!==a);
        return ok({});
      });
    }
    return fail('Неизвестное действие.');
  }
  for (const a of db.accounts) if (a.status === 'login') { a.status='new'; a.note='Прошлый вход был прерван.'; }
  for (const a of db.accounts) if (a.provider === 'codex') background(refresh(a));
  async function runAgentTurn(id, spec) {
    const a = db.accounts.find(a=>a.id===id);
    if (a && spec.expectedProvider !== undefined && a.provider !== spec.expectedProvider) throw new Error('Аккаунт не относится к выбранному провайдеру.');
    if (!a || !a.enabled || a.status !== 'ready' || a.testPassed !== true) throw new Error('Аккаунт отключён или не прошёл проверку CLI.');
    if (a.cooldown > Date.now() || remaining(a) === 0) throw new Error('Лимит аккаунта исчерпан. Дождитесь обновления лимитов; другой аккаунт автоматически не используется.');
    const refreshing = active.get(a.id);
    if (refreshing?.busy === 'refresh') await refreshing.task;
    if (!a.enabled || a.status !== 'ready' || a.busy) throw new Error('Аккаунт отключён или занят. Дождитесь завершения текущей операции.');
    const result = await start(a,'delegate',async signal => {
      if (!await status(a,signal)) throw new Error(a.note);
      const exe = (await availability())[a.provider];
      if (!exe) throw new Error(`Не найден официальный CLI: ${names[a.provider]}.`);
      let reply;
      try {
        reply = await (options.runAgent ?? runAgent)({ ...spec, provider:a.provider, exe, env:cliEnv(a.provider,dir(a)), signal,
          onEvent:async event=>{
            if (event.type === 'quota' && event.usage?.windows?.length) {
              const previous = a.usage?.windows ?? [];
              const windows = new Map(previous.filter(w=>Date.now()-(w.sampledAt ?? a.usage.updatedAt)<FRESH).map(w=>[w.label,w]));
              for (const w of event.usage.windows) windows.set(w.label,{...w,sampledAt:event.usage.updatedAt});
              a.usage = {...event.usage,windows:[...windows.values()]};
              await persist();
              return;
            }
            await spec.onEvent(event);
          },
        });
      } catch (error) {
        if (/rate.limit|usage limit|quota|hit your limit|too many requests|\b429\b/i.test(error.message)) a.cooldown = Date.now() + 5*60_000;
        throw error;
      }
      a.lastUsed = Date.now();
      a.note = 'Последняя задача агента завершена.';
      await quota(a,signal);
      return reply;
    },spec.signal);
    if (!result || result.ok === false) throw new Error(result?.error || 'CLI не завершил задачу.');
    return result;
  }
  return {action, pick:provider=>{const a=pickAccount(db.accounts,provider);return a ? view(a) : undefined;}, modelAccounts, runAgentTurn,
    hasEnabled:()=>db.accounts.some(a=>a.enabled && a.status==='ready'), async dispose(){clearInterval(interval);life.abort();await Promise.allSettled([...active.values()].map(w=>w.task)); await writes.catch(()=>{});} };
}
function cleanName(name) { return typeof name === 'string' ? name.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,70) : ''; }
export function officialLoginUrl(provider, text) {
  const hosts = provider === 'codex' ? ['auth.openai.com','login.openai.com'] : ['claude.ai','console.anthropic.com','platform.claude.com'];
  for (const raw of text.match(/https:\/\/[^\s<>"\u001b]+/g) ?? []) {
    try { const url = new URL(raw); if (hosts.includes(url.hostname) && !url.port && !url.username && !url.password && /oauth|authorize/.test(url.pathname) && raw.length < 8192) return url.href; } catch {}
  }
}
