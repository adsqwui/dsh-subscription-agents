// Run after compiling upstream/lib/client.js with the source build preset.
// This installed Desktop predates stylesheet metadata support.
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
const input = new URL('./upstream/lib/client.js', import.meta.url);
const output = new URL('./client.js', import.meta.url);
let source = readFileSync(input, 'utf8');
let registration;
vm.runInNewContext(source, { window: { __ModuleLoader__: { load: value => { registration = value; } } } });
const sheets = registration?.meta?.().stylesheets;
if (!sheets) throw new Error('Missing compiled stylesheet metadata');
const css = Object.values(sheets).map(sheet => sheet.text({})).join('\n');
if (!css.includes('childRow') || !css.includes('text-overflow:ellipsis')) throw new Error('Incomplete workspace stylesheet');
if (source.split('function WorkspaceBrowser(').length !== 2 || source.split('exports.apply=apply;').length !== 2) throw new Error('Unexpected compiled component bindings');
source = source.replace('function WorkspaceBrowser(', 'function SubscriptionWorkspaceBrowserBody(');
source = source.replace('exports.apply=apply;', `function WorkspaceBrowser(props){return react.createElement(react.Fragment,null,react.createElement("style",{"data-subscription-workspace-styles":"installed-compatible"},${JSON.stringify(css)}),react.createElement(SubscriptionWorkspaceBrowserBody,props))}exports.apply=apply;`);
writeFileSync(output, source);
console.log(`Embedded ${css.length} bytes of component-owned workspace CSS`);
