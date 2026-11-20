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
    await install(ctx,{modelAccounts:()=>[],runAgentTurn:async(_id,opts)=>{
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
    assert.equal(turns[0].cwd,'/workspace');assert.equal(turns[0].permissionMode,'danger-full-access');
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
  const registrations = [], emitted = [];
  const agent = { session,model:{ current:()=>selection } };
  const ctx = {
    profileContext:{ dir:root }, effect(fn){ const dispose=fn(); effects.push(dispose); return dispose; }, on(){},
    agents:{ list:()=>[agent],get:()=>agent,turnBoundaryOf:()=>({ openTurnStartSeq:1,lastStepStartSeq:2 }) },
    sandboxPolicy:{ resolve:()=>({ mode }) },workingDirectory:{ get:()=>'/project' },
    llm:{ registerAdapter(routes,value){ adapter=value; registrations.push([...routes]); const handle=()=>{}; handle.replace=next=>registrations.push([...next]); return handle; } },subagents:{ registerProvider(){} },
    emit:(name,route)=>emitted.push([name,route]),
    get:name=>name==='attachments' ? attachments : undefined,
  };
  const reads = [];
  const attachments = { async readImageRequest(ref,target){ reads.push({ ref,target }); return { mediaType:'image/png',data:new Uint8Array([ref.width % 256,1,2]) }; } };
  t.after(async () => {
    for (const dispose of effects.reverse()) await dispose?.();
    await rm(root,{ recursive:true,force:true });
  });
  const install = await loadBridge();
  const accounts = [
    { id:codeAccount,name:'Personal',provider:'codex',number:1,models:[] },
    { id:claudeAccount,name:'Work',provider:'claude',number:2,models:[{ id:'claude-opus-5-5',name:'Opus 5.5',inputModalities:['text','image'],isDefault:true },{ id:'claude-haiku-5-5',name:'Haiku 5.5',inputModalities:['text','image'] }] },
  ];
  const bridge = await install(ctx,{
    modelAccounts: provider => accounts.filter(a=>a.provider===provider),
    runAgentTurn(id,opts){ calls.push({ id,opts }); return runner(id,opts); },
  });
  async function ask(messages, extra = {}) {
    const chunks=[];
    for await (const chunk of adapter.stream({ ...selection,sessionId:session.id,messages,...extra })) chunks.push(chunk);
    return chunks;
  }
  return { adapter,ask,calls,events,root,reads,ctx,accounts,bridge,registrations,emitted,select: next=>{ selection=next; },restrict:()=>{ mode='workspace-write'; } };
}

test('each account is its own provider listing the models its CLI reported', async t => {
  const { adapter,registrations } = await mainChat(t);
  assert.deepEqual(registrations[0],[CODEX,CLAUDE,'dsh-subscription-codex-1','dsh-subscription-claude-2']);
  assert.equal(adapter.providerInfo('dsh-subscription-claude-2').name,'Claude Code · подписка · Work');
  const claude = await adapter.listModels('dsh-subscription-claude-2');
  assert.deepEqual(claude.map(m=>[m.provider,m.id,m.name,m.inputModalities.join()]),[['dsh-subscription-claude-2','claude-opus-5-5','Opus 5.5','text,image'],['dsh-subscription-claude-2','claude-haiku-5-5','Haiku 5.5','text,image']]);
  assert.equal((await adapter.resolveModel('dsh-subscription-claude-2','claude-haiku-5-5')).name,'Haiku 5.5');
  await assert.rejects(adapter.resolveModel('dsh-subscription-claude-2','gpt-x'),/недоступна/);
  // A Codex account whose CLI has not listed models yet offers the CLI default.
  assert.deepEqual([...(await adapter.listModels('dsh-subscription-codex-1'))].map(m=>m.id),['default']);
  await assert.rejects(adapter.resolveModel('dsh-subscription-codex-9','default'),/аккаунт/i);
  // Per-vendor routes list nothing, yet chats that picked an account there keep resolving.
  assert.equal((await adapter.listModels(CODEX)).length,0);
  const legacy = await adapter.resolveModel(CODEX,codeAccount);
  assert.match(legacy.name,/Codex · подписка · Personal/);
  await assert.rejects(adapter.resolveModel(CODEX,claudeAccount),/аккаунт/i);
});

test('account routes follow the enabled accounts and announce changed catalogs', async t => {
  const { accounts,bridge,registrations,emitted } = await mainChat(t);
  accounts.push({ id:'cccccccc-cccc-cccc-cccc-cccccccccccc',name:'Second',provider:'claude',number:3,models:[] });
  bridge.sync('claude');
  assert.deepEqual(registrations.at(-1),[CODEX,CLAUDE,'dsh-subscription-codex-1','dsh-subscription-claude-2','dsh-subscription-claude-3']);
  assert.deepEqual(emitted.map(e=>e[1]),[CLAUDE,'dsh-subscription-claude-2','dsh-subscription-claude-3']);
  const count = registrations.length;
  bridge.sync('codex');
  assert.equal(registrations.length,count);
  assert.equal(bridge.route(accounts[0]),'dsh-subscription-codex-1');
  assert.deepEqual([...bridge.models(accounts[0])].map(m=>m.id),['default']);
});

test('a chosen model reaches the CLI and the CLI token count reaches DSH', async t => {
  const { ask,calls,select } = await mainChat(t, async () => ({ text:'Готово',tokens:{ inputTokens:120,outputTokens:30,totalTokens:150,cacheReadTokens:0 } }));
  select({ provider:'dsh-subscription-claude-2',model:'claude-haiku-5-5' });
  const chunks = await ask([turnInput('Привет')]);
  assert.equal(calls[0].id,claudeAccount);
  assert.equal(calls[0].opts.model,'claude-haiku-5-5');
  assert.deepEqual(chunks.slice(-2).map(c=>c.type),['usage','finish']);
  assert.equal(chunks.at(-2).usage.totalTokens,150);
  select({ provider:'dsh-subscription-codex-1',model:'default' });
  await ask([turnInput('Привет')]);
  assert.equal(calls[1].id,codeAccount);
  assert.equal('model' in calls[1].opts,false);
  select({ provider:'dsh-subscription-codex-7',model:'default' });
  await assert.rejects(ask([turnInput('Привет')]),/аккаунт/i);
  assert.equal(calls.length,2);
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

test('images in the current message reach the CLI, scaled for the request', async t => {
  const { ask,calls,reads } = await mainChat(t);
  const image = { attachmentId:'att-1',mediaType:'image/png',bytes:10,width:4000,height:1000,name:'shot.png' };
  await ask([{ role:'user',source:{ kind:'user' },content:[{ type:'text',text:'Что на скрине?' },{ type:'image',attachment:image }] }]);
  assert.equal(calls[0].opts.prompt,'Что на скрине?');
  assert.equal(calls[0].opts.permissionMode,'danger-full-access');
  assert.equal(JSON.stringify([...calls[0].opts.images].map(i=>({ mediaType:i.mediaType,data:[...i.data] }))),JSON.stringify([{ mediaType:'image/png',data:[4000 % 256,1,2] }]));
  assert.deepEqual({ ...reads[0].target },{ width:2000,height:500,maxBytes:3_750_000 });
  await ask([{ role:'user',source:{ kind:'user' },content:[{ type:'image',attachment:{ ...image,width:100,height:50 } }] }]);
  assert.equal(calls[1].opts.prompt,'See the attached image.');
  assert.deepEqual({ ...reads[1].target },{ width:100,height:50,maxBytes:3_750_000 });
  await ask([{ role:'user',source:{ kind:'user' },content:[{ type:'text',text:'Дальше' },{ type:'image',attachment:image,offloaded:true }] }]);
  assert.match(calls[2].opts.prompt,/Image shot\.png was removed/);
  assert.equal(calls[2].opts.images.length,0);
});

test('an image without the attachment service fails before the CLI starts', async t => {
  const { ask,calls,ctx } = await mainChat(t);
  ctx.get = () => undefined;
  await assert.rejects(ask([{ role:'user',source:{ kind:'user' },content:[{ type:'image',attachment:{ width:1,height:1 } }] }]),/attachment service/);
  assert.equal(calls.length,0);
});

test('restricted chats, unsupported attachments and auxiliary calls never start the CLI', async t => {
  const { ask,calls,restrict } = await mainChat(t);
  await assert.rejects(ask([turnInput('Вопрос')],{ purpose:'compaction' }),/auxiliary/i);
  await assert.rejects(ask([{ role:'user',source:{ kind:'user' },content:[{ type:'file' }] }]),/text and images/i);
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
