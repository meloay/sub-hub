import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let source = fs.readFileSync('./sub-hub-worker.js', 'utf8');
source = source.replace('export default {', 'globalThis.worker = {');
source += '\nglobalThis.adminUiTestApi = { serveAdminPanel };';
const context = vm.createContext({
  URL, URLSearchParams, TextDecoder, TextEncoder, Headers, Response,
  atob, btoa, encodeURIComponent, decodeURIComponent, escape, unescape,
  crypto, console,
});
new vm.Script(source, { filename: 'sub-hub-worker.js' }).runInContext(context);

const response = context.adminUiTestApi.serveAdminPanel({}, 'sub');
const html = await response.text();
assert.match(html, /编辑组合/);
assert.match(html, /保存组合/);
assert.match(html, /预览节点/);
assert.match(html, /组合订阅不能直接添加节点/);
assert.match(html, /toggleCombinationList/);
assert.match(html, /combination-list-/);
assert.match(html, /combination-member-meta/);
assert.doesNotMatch(html, /editCombinationModal/);
assert.match(html, /\.subscription-actions \{[\s\S]*?width: 220px;/);
console.log(JSON.stringify({ passed: true, htmlBytes: html.length }, null, 2));
