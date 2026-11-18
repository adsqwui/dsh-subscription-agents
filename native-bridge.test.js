import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';

// The installed adapter's base class has no state. Substitute it only in this
// fixture so tests can run without changing the workspace's package resolution.
async function loadBridge() {
  let source = await readFile(new URL('./native-bridge.js', import.meta.url), 'utf8');
  source = source.replace(/import[^;]+;\n/g, '').replace('export async function installNativeBridge', 'async function installNativeBridge');
  const scope = { LlmAdapter: class {}, randomUUID, ...fs, join, Buffer, AbortController, AbortSignal, console };
  const context = vm.createContext(scope);
  vm.runInContext(source + '\n globalThis.install = installNativeBridge;', context);
  return scope.install;
}
test('native child bridge records CLI tools without returning executable tool calls, then resumes CLI thread', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-bridge-'));
  const effects = [], handlers = {}, events = [], turns = [];
  const account = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  let adapter, provider, releaseTurn, announceText;
  const textPublished = new Promise(resolve => { announceText = resolve; });
  const finishTurn = new Promise(resolve => { releaseTurn = resolve; });
  const session = { id: 'child-test', header: { origin:'subagent' }, seq: 4, eventAt: () => ({ type: 'step/start', data: { turn: 1, step: 1 } }), append(...args) { if (Array.isArray(args[0])) events.push(...args[0]); else events.push(args); } };
  const agent = { id: session.id, session, model: {current:()=>({provider:'dsh-subscription-codex',model:account})}, ctx:{ effect:fn=>fn(),tools:{restrict:()=>()=>{}}} };
  const ctx = {
    profileContext:{dir:root},effect:fn=>{const d=fn();effects.push(d);return d;},on:(key,fn)=>{handlers[key]=fn;},
    agents:{list:()=>[],get:()=>agent,turnBoundaryOf:()=>({openTurnStartSeq:1,lastStepStartSeq:2})},
    sandboxPolicy:{resolve:()=>({mode:'danger-full-access'})},workingDirectory:{get:()=>'/workspace'},
    llm:{registerAdapter(_routes,value){adapter=value;return ()=>{};}},subagents:{registerProvider(value){provider=value;return ()=>{};}},
  };
  try {
    const install = await loadBridge();
    await install(ctx,{runAgentTurn:async(_id,opts)=>{
      turns.push(opts);
      await opts.onEvent({type:'thread',id:'thread-123'});
      await opts.onEvent({type:'text',text:'Inspecting before the tool'});
      announceText();
      await finishTurn;
      await opts.onEvent({type:'tool-start',id:'call-1',name:'shell',args:{command:'pwd'}});
      await opts.onEvent({type:'tool-end',id:'call-1',name:'shell',text:'/workspace'});
      await opts.onEvent({type:'text',text:'Done'});
      await opts.onEvent({type:'text',text:'Second message'});
      return {threadId:'thread-123',text:'Done'};
    }});
    assert.equal(provider.name,'subscription-cli');
    const options={sessionId:session.id,provider:'dsh-subscription-codex',model:account,messages:[{role:'user',source:{kind:'user'},content:[{type:'text',text:'Inspect project'}]}]};
    const collect=async()=>{const chunks=[];for await(const c of adapter.stream(options))chunks.push(c);return chunks;};
    const pending = collect();
    await textPublished;
    releaseTurn();
    const chunks=await pending;
    assert.equal(chunks.at(-1).reason.kind,'stop');
    assert.deepEqual(chunks.filter(c=>c.type==='block-end').map(c=>c.block.text),['Inspecting before the tool','Done','Second message']);
    assert.equal(chunks.some(c=>c.type==='tool-call-delta'),false);
    assert.equal(events[0][0],'assistant/message');
    assert.equal(events[0][1].message.content[0].type,'tool-call');
    assert.equal(events[1][0],'tool/call');assert.equal(events[2][0],'tool/result');
    assert.equal(events[1][1].name,'subscription_cli_shell');
    assert.equal(turns[0].cwd,'/workspace');assert.equal(turns[0].permissionMode,'workspace-write');
    await collect();assert.equal(turns[1].threadId,'thread-123');
    assert.equal(JSON.parse(await readFile(join(root,'subscription-agents','native-threads.json'),'utf8'))[session.id].account,account);
    ctx.sandboxPolicy.resolve=()=>({mode:'workspace-write'});
    await assert.rejects(collect,/Full access/);
  } finally {
    for (const dispose of effects.reverse()) await dispose?.();
    if(dirname(root)===tmpdir() && root.startsWith(join(tmpdir(),'dsh-native-bridge-'))) await rm(root,{recursive:true,force:true});
  }
});

const CODEX = 'dsh-subscription-codex';
const CLAUDE = 'dsh-subscription-claude';
const codeAccount = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const claudeAccount = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const turnInput = (text, kind = 'user') => ({ role:'user', source:{ kind }, content:[{ type:'text', text }] });

async function mainChat(t, runner = async (_id, opts) => {
  await opts.onEvent({ type:'thread',id:'transient-thread' });
  await opts.onEvent({ type:'text',text:'Ответ по подписке' });
  return { threadId:'transient-thread' };
}) {
  const root = await mkdtemp(join(tmpdir(),'dsh-native-model-'));
  const effects = [], events = [], calls = [];
  const session = { id:'main-chat', header:{ origin:'user' }, eventAt:()=>({ type:'step/start',data:{ turn:1,step:1 } }), append(...row){ events.push(row); } };
  let adapter, selection = { provider:CODEX,model:codeAccount }, mode = 'danger-full-access';
  const agent = { session,model:{ current:()=>selection } };
  const ctx = {
    profileContext:{ dir:root }, effect(fn){ const dispose=fn(); effects.push(dispose); return dispose; }, on(){},
    agents:{ list:()=>[agent],get:()=>agent,turnBoundaryOf:()=>({ openTurnStartSeq:1,lastStepStartSeq:2 }) },
    sandboxPolicy:{ resolve:()=>({ mode }) },workingDirectory:{ get:()=>'/project' },
    llm:{ registerAdapter(_routes,value){ adapter=value; } },subagents:{ registerProvider(){} },
  };
  t.after(async () => {
    for (const dispose of effects.reverse()) await dispose?.();
    await rm(root,{ recursive:true,force:true });
  });
  const install = await loadBridge();
  const accounts = [
    { id:codeAccount,name:'Personal',provider:'codex',number:1 },
    { id:claudeAccount,name:'Work',provider:'claude',number:2 },
  ];
  await install(ctx,{
    modelAccounts: provider => accounts.filter(a=>a.provider===provider),
    runAgentTurn(id,opts){ calls.push({ id,opts }); return runner(id,opts); },
  });
  async function ask(messages, extra = {}) {
    const chunks=[];
    for await (const chunk of adapter.stream({ ...selection,sessionId:session.id,messages,...extra })) chunks.push(chunk);
    return chunks;
  }
  return { adapter,ask,calls,events,root,select: next=>{ selection=next; },restrict:()=>{ mode='workspace-write'; } };
}

test('the regular catalog has separate discoverable subscription profiles and text-only metadata', async t => {
  const { adapter } = await mainChat(t);
  for (const [provider,id,vendor] of [[CODEX,codeAccount,'Codex'],[CLAUDE,claudeAccount,'Claude Code']]) {
    const [model] = await adapter.listModels(provider);
    assert.equal(model.provider,provider);
    assert.equal(model.id,id);
    assert.match(model.name,new RegExp(vendor));
    assert.match(model.name,/подписка/i);
    assert.equal((await adapter.resolveModel(provider,id)).name,model.name);
    assert.equal(model.inputModalities.join(),'text');
  }
  await assert.rejects(adapter.resolveModel(CODEX,claudeAccount),/аккаунт/i);
});

test('ordinary chats use the selected account directly and can switch subscriptions with text history', async t => {
  const { ask,calls,events,select,root } = await mainChat(t);
  const first = await ask([turnInput('Первый вопрос')]);
  assert.equal(first.at(-1).reason.kind,'stop');
  assert.equal(first.find(chunk=>chunk.type==='block-end')?.block.text,'Ответ по подписке');
  select({ provider:CLAUDE,model:claudeAccount });
  await ask([
    turnInput('Первый вопрос'),
    turnInput('Скрытая настройка','runtime-context'),
    { role:'assistant',content:[{ type:'text',text:'Предыдущий ответ' },{ type:'reasoning',text:'Скрытое рассуждение' }] },
    { role:'tool',content:[{ type:'text',text:'Сырой вывод инструмента' }] },
    turnInput('Уточнение'),
  ]);
  assert.equal(calls.map(c=>c.id).join(),[codeAccount,claudeAccount].join());
  assert.equal(calls[0].opts.prompt,'Первый вопрос');
  assert.match(calls[1].opts.prompt,/Первый вопрос.*Предыдущий ответ/s);
  assert.match(calls[1].opts.prompt,/Уточнение$/);
  assert.doesNotMatch(calls[1].opts.prompt,/Скрыт|Сырой/);
  assert.equal(calls.every(c=>c.opts.ephemeral && c.opts.threadId===undefined),true);
  assert.equal(events.filter(e=>e[0]==='assistant/message').length,0);
  await assert.rejects(readFile(join(root,'subscription-agents','native-threads.json')), { code:'ENOENT' });
});

test('subscription errors surface without routing through another account', async t => {
  const { ask,calls,events } = await mainChat(t, async () => { throw new Error('quota exhausted'); });
  await assert.rejects(ask([turnInput('Вопрос')]),/quota exhausted/);
  assert.equal(calls.length,1);
  assert.equal(events.length,0);
});

test('a CLI that ends without any answer is not shown as successfully completed', async t => {
  const { ask,calls } = await mainChat(t, async () => ({}));
  await assert.rejects(ask([turnInput('Вопрос')]),/не вернул ответ/);
  assert.equal(calls.length,1);
});

test('restricted chats, current attachments and auxiliary calls never start the CLI', async t => {
  const { ask,calls,restrict } = await mainChat(t);
  await assert.rejects(ask([turnInput('Вопрос')],{ purpose:'compaction' }),/auxiliary/i);
  await assert.rejects(ask([{ role:'user',source:{ kind:'user' },content:[{ type:'image' }] }]),/text/i);
  restrict();
  await assert.rejects(ask([turnInput('Вопрос')]),/Full access/);
  assert.equal(calls.length,0);
});

test('primary chat keeps recent context bounded without clipping the current question', async t => {
  const { ask,calls } = await mainChat(t);
  const reply = text => ({ role:'assistant',content:[{ type:'text',text }] });
  await ask([turnInput('OLD '+ 'x'.repeat(60_000)),reply('EARLIEST'),turnInput('RECENT'),reply('y'.repeat(23_000)),turnInput('CURRENT')]);
  assert.match(calls[0].opts.prompt,/RECENT/);
  assert.doesNotMatch(calls[0].opts.prompt,/OLD/);
  assert.match(calls[0].opts.prompt,/CURRENT$/);
  assert(calls[0].opts.prompt.length < 80_500);
});

test('a completed CLI message is streamed before the CLI turn ends', async t => {
  let release;
  const gate = new Promise(resolve=>{ release=resolve; });
  const chunks=[];
  const { adapter } = await mainChat(t, async (_id,opts) => {
    await opts.onEvent({ type:'text',text:'Progress' });
    await gate;
    return { text:'Progress' };
  });
  const stream = adapter.stream({ provider:CODEX,model:codeAccount,sessionId:'main-chat',messages:[turnInput('Hi')] });
  const next = stream.next();
  try {
    const state = await Promise.race([next,new Promise(resolve=>setTimeout(()=>resolve(null),150))]);
    assert.equal(state?.value?.type,'block-start');
  } finally {
    release();
    await next;
    for await (const chunk of stream) chunks.push(chunk);
  }
  assert.equal(chunks.filter(c=>c.type==='text-delta').length,1);
});
