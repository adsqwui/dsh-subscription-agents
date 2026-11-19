import test from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRED_HOST_API, missingHostApi, assertHostApi } from './compat.js';

function fakeHost() {
  const ctx = { profileContext: { dir: '/tmp/profile' } };
  for (const path of REQUIRED_HOST_API) {
    const parts = path.split('.');
    let owner = ctx;
    for (const part of parts.slice(0, -1)) owner = owner[part] ??= {};
    owner[parts.at(-1)] = () => {};
  }
  return ctx;
}

test('a host with every required method passes', () => {
  assert.deepEqual(missingHostApi(fakeHost()), []);
  assert.doesNotThrow(() => assertHostApi(fakeHost()));
});

test('a renamed host method is reported by name before anything registers', () => {
  const ctx = fakeHost();
  delete ctx.agents.turnBoundaryOf;
  ctx.subagents.startActivation = 'not a function';
  assert.deepEqual(missingHostApi(ctx), ['subagents.startActivation', 'agents.turnBoundaryOf']);
  assert.throws(() => assertHostApi(ctx), /agents\.turnBoundaryOf/);
});
