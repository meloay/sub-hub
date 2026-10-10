// 本机 UI 预览：只提供演示数据，拒绝所有修改请求，不连接线上数据库。
import fs from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';

const context = vm.createContext({ URL, URLSearchParams, TextDecoder, TextEncoder, Uint8Array,
  Headers, Response, atob, btoa, encodeURIComponent, decodeURIComponent, escape, unescape, crypto });
new vm.Script(fs.readFileSync('./sub-hub-worker.js', 'utf8').replace('export default {', 'globalThis.worker = {')
  + '\nglobalThis.render = serveAdminPanel;').runInContext(context);
const subscriptions = [
  { name: 'Oracle', path: 'oracleabcdef', nodeCount: 4, subscription_type: 'standard', auto_rename: 1 },
  { name: 'Surge · 日常组合', path: 'surgeabcdef', nodeCount: 12, subscription_type: 'combined', member_count: 2, auto_rename: 1 },
  { name: '香港专线', path: 'hongkongabcdef', nodeCount: 8, subscription_type: 'standard', auto_rename: 0 },
].map(sub => ({ ...sub, updated_at: Date.now() - 3600000, converter_backend: 'sub.xeton.dev' }));
http.createServer(async (request, response) => {
  if (request.method !== 'GET') { response.writeHead(403); response.end('Preview is read-only'); return; }
  if (request.url === '/sub') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(await context.render({}, 'sub').text());
    return;
  }
  let data;
  if (request.url === '/sub/api/subscriptions') data = subscriptions;
  else if (request.url.endsWith('/members')) data = [subscriptions[0], subscriptions[2]];
  else if (request.url.endsWith('/nodes')) data = [
    { id: 1, name: '🇭🇰 香港 01', original_link: 'trojan://demo@example.com:443#HK01', node_order: 0, enabled: 1 },
    { id: 2, name: '🇯🇵 日本 01', original_link: 'mierus://demo:demo@example.com?profile=JP01&port=443&protocol=TCP', node_order: 1, enabled: 1 },
  ];
  else { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ success: true, data }));
}).listen(8789, '127.0.0.1', () => console.log('UI preview ready: http://127.0.0.1:8789/sub'));
