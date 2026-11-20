import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { makeService, officialLoginUrl, pickAccount, remaining } from './accounts.js';
import { inference, subscribed } from './cli.js';

const okCli = stdout => ({code:0,stdout,stderr:''});
const json = v => JSON.stringify(v);
test('only CLI subscription status is admitted', () => {
  assert(subscribed('codex',okCli('Logged in using ChatGPT')));
  assert(!subscribed('codex',okCli('Logged in using an API key')));
  assert(subscribed('claude',okCli(json({loggedIn:true,authMethod:'claude.ai'}))));
  assert(!subscribed('claude',okCli(json({loggedIn:true,authMethod:'api_key'}))));
});
test('quota routing uses worst fresh window, not stale/unknown/exhausted/busy data', () => {
  const now = 1_800_000_000_000;
  const a = (number, used, extra={}) => ({number,enabled:true,status:'ready',...extra,...(used && {usage:{updatedAt:now,windows:used.map(usedPercent=>({usedPercent}))}})});
  const rows = [a(1,[10,70]), a(2,[50]), a(3), a(4,[0],{busy:'delegate'}), a(5,[100])];
  assert.equal(pickAccount(rows,undefined,now).number,2);
  assert.equal(pickAccount([rows[4],rows[2]],undefined,now).number,3);
  assert.equal(remaining({usage:{updatedAt:now,windows:[{usedPercent:1,sampledAt:now-360_000}]}},now),undefined);
});
test('validates login URLs and parses Claude rate-limit events', () => {
  assert.equal(officialLoginUrl('codex','https://auth.openai.com.fake.invalid/oauth'),undefined);
  assert.equal(officialLoginUrl('codex','https://auth.openai.com/oauth/authorize?state=temporary'),'https://auth.openai.com/oauth/authorize?state=temporary');
  const parsed = inference('claude',okCli([json({type:'rate_limit_event',rate_limit_info:{status:'allowed',rateLimitType:'five_hour',utilization:0.25,resetsAt:1800000000}}),json({type:'result',result:'OK'})].join('\n')));
  assert.equal(parsed.text,'OK');
  assert.equal(parsed.usage.windows[0].usedPercent,25);
  assert.equal(parsed.usage.windows[0].resetAt,1800000000000);
});
test('reads every Claude window from unifiedWindows (Claude Code 2.1.x)', () => {
  // Shape sent by Claude Code 2.1.319: no top-level utilization, the numbers live in unifiedWindows.
  const info = {status:'allowed',resetsAt:1795185000,rateLimitType:'five_hour',overageStatus:'rejected',isUsingOverage:false,
    unifiedWindows:{five_hour:{utilization:0.58,resetsAt:1795185000,status:'allowed'},seven_day:{utilization:0.46,resetsAt:1795528800,status:'allowed'}}};
  const parsed = inference('claude',okCli([json({type:'rate_limit_event',rate_limit_info:info}),json({type:'result',result:'OK'})].join('\n')));
  assert.equal(parsed.text,'OK');
  assert.deepEqual(parsed.usage.windows.map(w=>({...w})),[{label:'5 часов',usedPercent:58,resetAt:1795185000000},{label:'7 дней',usedPercent:46,resetAt:1795528800000}]);
});
test('account lifecycle, smoke, user-only enable, delegation and persistence', async () => {
  const root = await mkdtemp(join(tmpdir(),'dsh-sub-agents-test-'));
  const calls=[];
  const catalogChanges=[];
  const conf={onCatalogChanged:provider=>catalogChanges.push(provider),runAgent:async spec=>{assert.equal(spec.cwd,root);await spec.onEvent({type:'text',text:'draft'});return {threadId:'thread-1',text:'draft'};},executable:async p=>`/${p}`,readCodexUsage:async()=>({updatedAt:Date.now(),windows:[{label:'5h',usedPercent:30}]}),run:async(exe,args,opts)=>{
    calls.push({exe,args,opts});
    if (args.includes('status')) return okCli('Logged in using ChatGPT');
    if (args.includes('exec')) return okCli(json({type:'item.completed',item:{type:'agent_message',text:opts.input.startsWith('Reply')?'OK':'draft'}}));
    return okCli('');
  }};
  let service;
  try {
    service = await makeService(root,conf);
    const client = (action, body={}) => service.action({action,...body},{user:true});
    const {account:{id}} = await client('add',{provider:'codex',name:'Test'});
    assert.deepEqual(service.modelAccounts('codex'),[]);
    assert.equal((await service.action({action:'toggle',id,enabled:true})).ok,false);
    await client('login',{id});
    let row;
    for(let i=0;i<100;i++) { [row]=(await client('list')).accounts; if (!row.busy) break; await new Promise(r=>setTimeout(r,10)); }
    assert.equal(row.status,'ready');
    assert.match(row.note,/CLI ответил OK/);
    assert.equal(row.enabled,false);
    assert.equal((await client('toggle',{id,enabled:true})).ok,true);
    assert.deepEqual(service.modelAccounts('codex'),[{id,name:'Test',provider:'codex',number:1}]);
    assert.deepEqual(service.modelAccounts('claude'),[]);
    assert.deepEqual(catalogChanges,['codex']);
    assert.equal((await service.action({action:'delegate',prompt:'Draft a short message.'})).ok,false);
    const reply = await service.runAgentTurn(id,{prompt:'Draft a short message.',cwd:root,permissionMode:'workspace-write',onEvent:async()=>{}});
    assert.equal(reply.text,'draft');
    await assert.rejects(service.runAgentTurn(id,{expectedProvider:'claude'}),/провайдер/i);
    assert.deepEqual(catalogChanges,['codex']);
    await client('rename',{id,name:'Renamed'});
    assert.equal(service.modelAccounts('codex')[0].name,'Renamed');
    assert.equal(calls.filter(x=>x.args.includes('exec')).length,1);
    for (const {opts} of calls) { assert.equal(opts.env.CODEX_HOME,join(root,id)); assert.equal(opts.cwd,join(root,'empty')); assert(!('OPENAI_API_KEY' in opts.env)); }
    await service.dispose();
    service = await makeService(root,conf);
    assert.equal((await client('list')).accounts[0].enabled,true);
    await client('toggle',{id,enabled:false});
    assert.deepEqual(service.modelAccounts('codex'),[]);
    assert.deepEqual(catalogChanges,['codex','codex','codex']);
    await service.dispose();
  } finally {
    await service?.dispose();
    if (dirname(root)===tmpdir() && root.startsWith(join(tmpdir(),'dsh-sub-agents-test-'))) await rm(root,{recursive:true,force:true});
  }
});
