import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { agentArgs, runAgent } from './agent-runner.js';

const UUID = '00000000-0000-4000-8000-000000000001';
async function fixture(t, lines, suffix = '') {
  const parent = tmpdir(), root = await mkdtemp(join(parent, 'dsh-agent-runner-'));
  t.after(async () => { if (dirname(root) === parent && root.startsWith(join(parent, 'dsh-agent-runner-'))) await rm(root, { recursive:true, force:true }); });
  const exe = join(root,'fake-cli');
  await writeFile(exe, `#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',async()=>{${lines.map(x=>`process.stdout.write(${JSON.stringify(JSON.stringify(x)+'\n')});`).join('')} ${suffix}});\n`);
  await chmod(exe,0o700);
  return { exe, cwd:root, env:{PATH:process.env.PATH}, permissionMode:'workspace-write', prompt:'Test fixture' };
}

test('argv preserves persistence, workspace and safe permission choices', () => {
  const fresh = agentArgs('codex',{cwd:'/project',permissionMode:'workspace-write'});
  assert.deepEqual(fresh,['-c','cli_auth_credentials_store="file"','-a','never','-s','workspace-write','-C','/project','--disable','multi_agent','--disable','multi_agent_v2','exec','--json','--skip-git-repo-check','-']);
  const resume = agentArgs('codex',{cwd:'/project',permissionMode:'read-only',threadId:UUID});
  assert.deepEqual(resume.slice(8),['--disable','multi_agent','--disable','multi_agent_v2','exec','resume','--json','--skip-git-repo-check',UUID,'-']);
  assert(!resume.includes('--ephemeral'));
  const claude = agentArgs('claude',{cwd:'/project',permissionMode:'workspace-write',threadId:UUID});
  assert(!claude.includes('--disable'));
  assert(claude.includes('acceptEdits')); assert(claude.includes('--resume')); assert(!claude.includes('--session-id')); assert(!claude.includes('--no-session-persistence'));
  assert(agentArgs('claude',{cwd:'/project',permissionMode:'read-only'}).includes('plan'));
  assert.throws(()=>agentArgs('codex',{cwd:'/project',permissionMode:'arbitrary'}));
});

test('ordinary subscription chat requests do not create or resume vendor conversations', () => {
  const options={ cwd:'/project',permissionMode:'workspace-write',ephemeral:true };
  assert(agentArgs('codex',options).includes('--ephemeral'));
  assert(agentArgs('claude',options).includes('--no-session-persistence'));
  assert.throws(()=>agentArgs('codex',{ ...options,threadId:UUID }),/resume/i);
});

test('Codex command lifecycle and complete text are ordered and awaited', async t => {
  const conf = await fixture(t,[{type:'thread.started',thread_id:UUID},{type:'turn.started'},{type:'item.started',item:{id:'c1',type:'command_execution',command:'echo hello',status:'in_progress'}},{type:'item.completed',item:{id:'c1',type:'command_execution',command:'echo hello',aggregated_output:'hello',exit_code:0,status:'completed'}},{type:'item.completed',item:{id:'a1',type:'agent_message',text:'Done'}},{type:'turn.completed',usage:{input_tokens:20,output_tokens:5}}]);
  const events=[]; let active=0;
  const result=await runAgent({...conf,provider:'codex',onEvent:async e=>{assert.equal(active++,0);await new Promise(r=>setTimeout(r,1));events.push(e);active--;}});
  assert.equal(result.threadId,UUID); assert.equal(result.text,'Done');
  assert.deepEqual(events.map(e=>e.type),['thread','tool-start','tool-end','text']);
  assert.match(events[2].text,/hello\n\[exit code: 0\]/); assert.equal(events[2].isError,false);
});

test('Claude tool calls, results, and duplicate assistant messages normalize', async t => {
  const assistant={type:'assistant',uuid:'message-1',session_id:UUID,parent_tool_use_id:null,message:{content:[{type:'text',text:'Checking'},{type:'tool_use',id:'t1',name:'Read',input:{file_path:'/project/a'}}]}};
  const conf=await fixture(t,[{type:'system',subtype:'init',session_id:UUID},assistant,assistant,{type:'user',session_id:UUID,message:{content:[{type:'tool_result',tool_use_id:'t1',content:'file text'}]}},{type:'assistant',uuid:'message-2',session_id:UUID,message:{content:[{type:'text',text:'Complete'}]}},{type:'result',subtype:'success',session_id:UUID,result:'Complete',is_error:false,usage:{input_tokens:2}}]);
  const events=[];
  const result=await runAgent({...conf,provider:'claude',onEvent:async e=>events.push(e)});
  assert.equal(result.text,'Checking\n\nComplete');
  assert.deepEqual(events.map(e=>e.type),['thread','text','tool-start','tool-end','text']);
  assert.equal(events[3].name,'Read'); assert.equal(events[3].text,'file text');
});

test('Claude quota events read unifiedWindows from Claude Code 2.1.x', async t => {
  const info = {status:'allowed',resetsAt:1795185000,rateLimitType:'five_hour',
    unifiedWindows:{five_hour:{utilization:0.58,resetsAt:1795185000,status:'allowed'},seven_day:{utilization:0.46,resetsAt:1795528800,status:'allowed'},seven_day_opus:{status:'rejected'},mystery:{utilization:0.1}}};
  const conf=await fixture(t,[{type:'system',subtype:'init',session_id:UUID},{type:'rate_limit_event',session_id:UUID,rate_limit_info:info},{type:'result',subtype:'success',session_id:UUID,result:'Complete',is_error:false}]);
  const events=[];
  await runAgent({...conf,provider:'claude',onEvent:async e=>events.push(e)});
  const quotas=events.filter(e=>e.type==='quota');
  assert.equal(quotas.length,1);
  assert.deepEqual(quotas[0].usage.windows.map(w=>({...w})),[
    {label:'5 часов',usedPercent:58,resetAt:1795185000000},
    {label:'7 дней',usedPercent:46,resetAt:1795528800000},
    {label:'Opus · 7 дней',usedPercent:100},
  ]);
});

test('Claude quota events forward known fresh windows without replacing token usage', async t => {
  const limits = [
    {status:'allowed',rateLimitType:'five_hour',utilization:0.25,resetsAt:1800000000},
    {status:'allowed',rateLimitType:'seven_day',utilization:0.38},
    {status:'rejected',rateLimitType:'seven_day_opus'},
    {status:'allowed',rateLimitType:'five_hour',utilization:1.2},
    {status:'allowed',rateLimitType:'unknown',utilization:0.4},
  ];
  const conf=await fixture(t,[{type:'system',subtype:'init',session_id:UUID},...limits.map(rate_limit_info=>({type:'rate_limit_event',session_id:UUID,rate_limit_info})),{type:'result',subtype:'success',session_id:UUID,result:'Complete',is_error:false,usage:{input_tokens:3}}]);
  const events=[];
  const result=await runAgent({...conf,provider:'claude',onEvent:async e=>events.push(e)});
  const quotas=events.filter(e=>e.type==='quota');
  assert.equal(quotas.length,3);
  assert.deepEqual(quotas[0].usage.windows,[{label:'5 часов',usedPercent:25,resetAt:1800000000000}]);
  assert.deepEqual(quotas[1].usage.windows,[{label:'7 дней',usedPercent:38}]);
  assert.deepEqual(quotas[2].usage.windows,[{label:'Opus · 7 дней',usedPercent:100}]);
  assert(quotas.every(e=>Number.isFinite(e.usage.updatedAt)));
  assert.deepEqual(result.usage,{input_tokens:3});
});

const waitItem = {id:'item_6',type:'collab_tool_call',tool:'wait',sender_thread_id:UUID,receiver_thread_ids:[],agents_states:{},status:'in_progress'};
const codexItem = (type, item) => ({ type: `item.${type}`, item });
async function codexWait(t, items, terminal = true) {
  const conf = await fixture(t, [
    { type:'thread.started', thread_id:UUID }, ...items,
    ...(terminal ? [codexItem('completed',{ id:'reply',type:'agent_message',text:'Готово' }),{ type:'turn.completed' }] : []),
  ]);
  const events = [];
  return { events, run: runAgent({ ...conf, provider:'codex', onEvent:async event=>events.push(event) }) };
}

test('empty Codex waits do not crowd out assistant text', async t => {
  const { events, run } = await codexWait(t, [
    codexItem('started',waitItem), codexItem('updated',waitItem),
    codexItem('completed',{ ...waitItem,status:'completed' }),
  ]);
  assert.equal((await run).text,'Готово');
  assert.deepEqual(events.map(e=>e.type),['thread','text']);
});

test('a wait can report real recipients and results only at completion', async t => {
  const completed = codexItem('completed',{
    ...waitItem, receiver_thread_ids:['worker'], agents_states:{ worker:{ status:'completed',message:'Итог агента' } },status:'completed',
  });
  const { events, run } = await codexWait(t, [codexItem('started',waitItem),completed,completed]);
  await run;
  assert.deepEqual(events.map(e=>e.type),['thread','tool-start','tool-end','text']);
  assert.deepEqual(events[1].args.agents,['worker']);
  assert.match(events[2].text,/Итог агента/);
  assert(!Object.hasOwn(events[1].args,'sender_thread_id'));
});

test('a valid recipient keeps the wait lifecycle visible without a state payload', async t => {
  const item = { ...waitItem, receiver_thread_ids:['worker'] };
  const { events, run } = await codexWait(t, [
    codexItem('started',item), codexItem('updated',item),
    codexItem('completed',{ ...waitItem,status:'completed' }),
  ]);
  await run;
  assert.deepEqual(events.map(e=>e.type),['thread','tool-start','tool-end','text']);
  assert.deepEqual(events[1].args.agents,['worker']);
  assert.match(events[2].text,/не означает завершение/);
});

test('an empty failed wait is visible and marked as an error', async t => {
  const { events, run } = await codexWait(t, [
    codexItem('started',waitItem),codexItem('completed',{ ...waitItem,status:'failed' }),
  ]);
  await run;
  assert.deepEqual(events.map(e=>e.type),['thread','tool-start','tool-end','text']);
  assert.equal(events[2].isError,true);
  assert.match(events[2].text,/ошибкой/);
});

test('a wait with state but no receiver list still renders the worker message', async t => {
  const { events, run } = await codexWait(t, [codexItem('completed',{
    ...waitItem, agents_states:{ worker:{ status:'completed',message:'Проверка завершена' } },status:'completed',
  })]);
  await run;
  assert.deepEqual(events[1].args.agents,['worker']);
  assert.match(events[2].text,/Проверка завершена/);
});

test('an empty completed wait cannot settle the turn', async t => {
  const { events, run } = await codexWait(t, [
    codexItem('started',waitItem),codexItem('completed',{ ...waitItem,status:'completed' }),
  ],false);
  await assert.rejects(run,/terminal/);
  assert.deepEqual(events.map(e=>e.type),['thread']);
});

test('missing terminal result rejects rather than returning false success', async t => {
  const conf=await fixture(t,[{type:'thread.started',thread_id:UUID}]);
  await assert.rejects(runAgent({...conf,provider:'codex',onEvent:async()=>{}}),/terminal/);
});

test('callback failure stops subprocess and propagates', async t => {
  const conf=await fixture(t,[{type:'thread.started',thread_id:UUID}], 'setInterval(()=>{},1000);');
  await assert.rejects(runAgent({...conf,provider:'codex',onEvent:async()=>{throw new Error('Recorder failed')}}),/Recorder failed/);
});

test('cancellation stops process and rejects', async t => {
  const conf=await fixture(t,[{type:'thread.started',thread_id:UUID}], 'setInterval(()=>{},1000);');
  const controller=new AbortController();
  await assert.rejects(runAgent({...conf,provider:'codex',signal:controller.signal,onEvent:async()=>controller.abort()}),/cancelled/);
});

test('malformed JSON fails closed; an oversized unknown event is skipped, not fatal', async t => {
  const malformed=await fixture(t,[], 'process.stdout.write("not-json\\n");');
  await assert.rejects(runAgent({...malformed,provider:'codex',onEvent:async()=>{}}),/malformed/);
  const large=await fixture(t,[], 'process.stdout.write(JSON.stringify({type:"message",text:"x".repeat(1100000)})+"\\n");');
  // The skipped line carried no terminal result, so the turn still has to fail for that reason.
  await assert.rejects(runAgent({...large,provider:'codex',onEvent:async()=>{}}),/terminal turn result/);
});

for (const mb of [1.5, 3]) {
  test(`a ${mb} MB Codex command output closes its tool call and the turn continues`, async t => {
    const started={type:'item.started',item:{id:'c1',type:'command_execution',command:'grep -R x .',status:'in_progress'}};
    const conf=await fixture(t,[{type:'thread.started',thread_id:UUID},started],
      `process.stdout.write(JSON.stringify({type:'item.completed',item:{id:'c1',type:'command_execution',command:'grep -R x .',aggregated_output:'x'.repeat(${mb * 1048576}),exit_code:0,status:'completed'}})+'\\n');`
      + `process.stdout.write(JSON.stringify({type:'item.completed',item:{id:'a1',type:'agent_message',text:'Done'}})+'\\n');`
      + `process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}})+'\\n');`);
    const events=[];
    const result=await runAgent({...conf,provider:'codex',onEvent:async e=>events.push(e)});
    assert.equal(result.text,'Done');
    assert.deepEqual(events.map(e=>e.type),['thread','tool-start','tool-end','text']);
    assert.equal(events[2].id,'c1'); assert.equal(events[2].isError,false);
    assert.match(events[2].text,/output omitted/i);
    assert.ok(events[2].text.length < 1000);
  });
}

test('an oversized Claude Code tool result closes its call', async t => {
  const assistant={type:'assistant',uuid:'m1',session_id:UUID,parent_tool_use_id:null,message:{content:[{type:'tool_use',id:'t1',name:'Bash',input:{command:'cat big.log'}}]}};
  const conf=await fixture(t,[{type:'system',subtype:'init',session_id:UUID},assistant],
    `process.stdout.write(JSON.stringify({type:'user',session_id:'${UUID}',parent_tool_use_id:null,message:{content:[{type:'tool_result',tool_use_id:'t1',content:'y'.repeat(1600000)}]}})+'\\n');`
    + `process.stdout.write(JSON.stringify({type:'result',subtype:'success',session_id:'${UUID}',result:'Read it',is_error:false})+'\\n');`);
  const events=[];
  const result=await runAgent({...conf,provider:'claude',onEvent:async e=>events.push(e)});
  assert.equal(result.text,'Read it');
  const end=events.find(e=>e.type==='tool-end');
  assert.equal(end.id,'t1'); assert.match(end.text,/output omitted/i);
});
