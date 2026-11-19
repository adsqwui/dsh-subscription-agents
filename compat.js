// Host methods this plugin calls. Checked before anything is registered or written,
// so a DSH update that renames one of them stops the plugin with a clear message
// instead of failing halfway through a session.
export const REQUIRED_HOST_API = [
  'effect', 'on', 'emit',
  'connection.fetch.register',
  'tools.register',
  'subagents.startActivation', 'subagents.resolveMaxDepth', 'subagents.registerProvider',
  'llm.registerAdapter',
  'agents.list', 'agents.get', 'agents.turnBoundaryOf',
  'sandboxPolicy.resolve',
  'workingDirectory.ensure', 'workingDirectory.get',
];

export function missingHostApi(ctx, required = REQUIRED_HOST_API) {
  const missing = required.filter(path => {
    const parts = path.split('.');
    let owner = ctx;
    for (const part of parts.slice(0, -1)) owner = owner?.[part];
    return typeof owner?.[parts.at(-1)] !== 'function';
  });
  if (typeof ctx?.profileContext?.dir !== 'string') missing.push('profileContext.dir');
  return missing;
}

export function assertHostApi(ctx) {
  const missing = missingHostApi(ctx);
  if (missing.length) {
    throw new Error(`dsh-subscription-agents: this DSH build lacks ${missing.join(', ')}. Update the plugin for this DSH version; nothing was registered.`);
  }
}
