import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('manifest accepts the whole 0.2 line and no absolute paths remain', () => {
  const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.engines.dsh, '>=0.2.2-rc.3 <0.3.0-0');
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-llm'], manifest.engines.dsh);
  const patch = readFileSync(new URL('./cordis.patch.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(patch, /name: '\//);
});
