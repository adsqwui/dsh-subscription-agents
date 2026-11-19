import { join } from 'node:path';
import { makeService } from './accounts.js';
import { installNativeBridge } from './native-bridge.js';
import { randomUUID } from 'node:crypto';
import { assertHostApi } from './compat.js';

export const inject = ['connection','tools','profileContext','subagents','llm','agents','sandboxPolicy','workingDirectory'];
const path = '/api/subscription-agents';
const json = (value, status=200) => Response.json(value, {status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});

export async function apply(ctx) {
  assertHostApi(ctx);
  const service = await makeService(join(ctx.profileContext.dir, 'subscription-agents'), {
    onCatalogChanged(provider) {
      try { ctx.emit('llm/models-updated', `dsh-subscription-${provider}`); }
      catch (error) { ctx.logger.warn(error); }
    },
  });
  ctx.effect(() => () => service.dispose());
  await installNativeBridge(ctx,service);
  ctx.effect(() => ctx.connection.fetch.register({
    path, methods:['POST'], requestBody:'streaming',
    async fetch(request) {
      if (request.headers.get('x-dsh-subscription-agents') !== '1' || request.headers.get('sec-fetch-site') === 'cross-site' || request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
        return json({ok:false,error:'Запрос отклонён.'},403);
      }
      try {
        const reader = request.body?.getReader();
        if (!reader) return json({ok:false,error:'Пустой запрос.'},400);
        const chunks = []; let size = 0;
        while (true) {
          const {done,value} = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 8192) { await reader.cancel(); return json({ok:false,error:'Слишком большой запрос.'},413); }
          chunks.push(value);
        }
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return json({ok:false,error:'Неверный JSON.'},400); }
        return json(await service.action(data, {user:true,signal:request.signal}));
      } catch {
        return json({ok:false,error:'Не удалось выполнить действие. Проверьте состояние аккаунта.'},500);
      }
    },
  }));
  const properties = {action:{enum:['list','refresh','test','delegate'],type:'string'},id:{type:'string',description:'Account ID for refresh or test.'},provider:{enum:['codex','claude'],type:'string',description:'Optional CLI preference; omit to pick the available account with most fresh quota.'},prompt:{type:'string',description:'Task for a full CLI agent. It has access to the current project and built-in file and command tools. Specify the files it owns; avoid concurrent edits to the same files.',maxLength:70000},name:{type:'string',description:'Optional short agent name, lower-case letters, digits and hyphens.'},description:{type:'string',description:'Short task label displayed in the child chat.'}};
  ctx.effect(() => ctx.tools.register({
    name:'subscription_agent',
    description:'Delegate project work to a full Codex or Claude Code agent using an enabled subscription account. Returns the child name immediately; a completion notice follows. Its ordinary DSH child chat preserves prompts, replies and CLI tool activity. Follow up with send_message, inspect list_agents, and interrupt through native subagent controls. Prefer this for independent project tasks; review the final diff and tests yourself. Never retry a quota failure through another account automatically.',
    parameters:{type:'object',properties,required:['action'],additionalProperties:false},
    output:{schema:{type:'object',properties:{ok:{type:'boolean'},error:{type:'string'},text:{type:'string'},accounts:{type:'array'},available:{type:'object'},account:{type:'object'},childId:{type:'string'},name:{type:'string'},messageId:{type:'string'}},required:['ok'],additionalProperties:false}, render(_args,value){return [{type:'text',text:JSON.stringify(value)}];}},
    timeoutMs:205000,
    isConcurrencySafe:()=>true,
    async execute(args,exec) {
      try {
        if (args?.action !== 'delegate') return await service.action(args,{signal:exec.signal});
        if (!exec.agent || typeof args.prompt !== 'string' || !args.prompt.trim() || args.prompt.length > 70000 || (args.provider !== undefined && !['codex','claude'].includes(args.provider))) return {ok:false,error:'Некорректная задача агента.'};
        const parent = exec.agent;
        if (ctx.sandboxPolicy.resolve({session:parent.session}).mode !== 'danger-full-access') return {ok:false,error:'Полноценный CLI-агент пока доступен только в сессии с полным доступом. Ограничения DSH не будут обходиться.'};
        const account = service.pick(args.provider);
        if (!account) return {ok:false,error:'Нет свободного подключённого аккаунта с разрешённым делегированием.'};
        const activation = await ctx.subagents.startActivation({
          provider:'subscription-cli', childId:randomUUID(), parent, signal:exec.signal,
          prompt:[{type:'text',text:args.prompt}], label:typeof args.description==='string' ? args.description.trim().slice(0,120) || `${account.provider} · ${account.name}` : `${account.provider} · ${account.name}`,
          ...(args.name ? {name:args.name} : {}), delivery:'parent',
          cwd:await ctx.workingDirectory.ensure(parent,exec.signal),
          agentOptions:{provider:`dsh-subscription-${account.provider}`,model:account.id},
          maxDepth:ctx.subagents.resolveMaxDepth(),
        });
        activation.result.catch(()=>{});
        return {ok:true,childId:activation.childId,name:activation.name,messageId:activation.messageId,account:{number:account.number,provider:account.provider,name:account.name}};
      }
      catch { return {ok:false,error:'Не удалось выполнить операцию подписки.'}; }
    },
  }));
}
