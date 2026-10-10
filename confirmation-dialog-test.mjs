import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('./sub-hub-worker.js', 'utf8');
const worker = vm.createContext({ URL, URLSearchParams, TextDecoder, TextEncoder, Headers, Response,
  atob, btoa, encodeURIComponent, decodeURIComponent, escape, unescape, crypto });
new vm.Script(source.replace('export default {', 'globalThis.worker = {') + '\nglobalThis.render = serveAdminPanel;').runInContext(worker);
const html = await worker.render({}, 'sub').text();
assert.doesNotMatch(html, /\b(?:confirm|alert|prompt)\s*\(/);
assert.match(html, /role="alertdialog"/);
const elements = new Map();
const listeners = {};
const document = {
  activeElement: null, body: { style: {} },
  getElementById(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, { textContent: '', isConnected: true,
        classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
        focus() { document.activeElement = this; },
        querySelectorAll() { return ['close', 'confirmationCancel', 'confirmationAccept'].map(id => document.getElementById(id)); },
      });
    }
    return elements.get(id);
  },
  querySelector() { return [...elements.values()].find(el => el.classList.contains('show')); },
  addEventListener(type, handler) { listeners[type] = handler; },
};
let requests = 0;
const frontend = vm.createContext({ document, Promise, setTimeout: callback => callback(),
  fetch: async () => { requests++; return { ok: true, json: async () => ({ success: true }) }; },
  showToast() {}, loadNodeList: async () => {}, loadSubscriptions: async () => {},
});
const controls = html.slice(html.indexOf('    function showModal(id)'), html.indexOf('    function prepareSubscriptionMemberOptions()'));
const deletion = html.slice(html.indexOf('    async function deleteNode('), html.indexOf('    // 创建订阅'));
new vm.Script("const adminPath = 'sub';\n" + controls + deletion).runInContext(frontend);
const trigger = document.getElementById('trigger');
trigger.focus();
let pending = frontend.deleteNode('oracle', 1);
assert.equal(requests, 0);
assert.equal(document.activeElement, document.getElementById('confirmationCancel'));
assert.equal(document.getElementById('confirmationTitle').textContent, '删除节点');
assert.equal(await frontend.showConfirmation('duplicate'), false);
frontend.finishConfirmation(false);
await pending;
assert.equal(requests, 0);
assert.equal(document.activeElement, trigger);

pending = frontend.deleteNode('oracle', 1);
frontend.finishConfirmation(true);
frontend.finishConfirmation(true);
await pending;
assert.equal(requests, 1);

frontend.showModal('editNodeModal');
pending = frontend.showConfirmation('<b>literal text</b>', { danger: false });
assert.equal(document.getElementById('confirmationMessage').textContent, '<b>literal text</b>');
assert.equal(document.getElementById('confirmationAccept').className, 'btn btn-primary');
listeners.keydown({ key: 'Tab', shiftKey: true, preventDefault() {} });
assert.equal(document.activeElement, document.getElementById('close'));
listeners.keydown({ key: 'Escape', preventDefault() {} });
assert.equal(await pending, false);
assert.equal(document.body.style.overflow, 'hidden');
frontend.hideModal('editNodeModal');
assert.equal(document.body.style.overflow, '');
console.log(JSON.stringify({ passed: true, noNativeDialogs: true, cancelDoesNotDelete: true, confirmDeletesOnce: true, keyboardAndNestedModal: true }));
