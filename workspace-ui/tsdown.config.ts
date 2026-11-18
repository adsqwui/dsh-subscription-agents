import { clientBundle } from '../../deepseek-harness-src/packages/client/tsdown.client.ts';
const root = new URL('./upstream/', import.meta.url).pathname;
const build = clientBundle(root, [root + 'src/index.ts']);
export default async options => {
  const configs = await build(options);
  return configs.map(config => ({ ...config, entry: config.name?.endsWith('/client') ? {client:root+'src/client/index.ts'} : config.entry, outDir:root+'lib' }));
};
