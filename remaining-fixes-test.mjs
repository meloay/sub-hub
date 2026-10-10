import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const globals = { URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, atob, btoa,
  Request, Response, Headers, crypto, console, encodeURIComponent, decodeURIComponent, escape, unescape };
const source = fs.readFileSync('./sub-hub-worker.js', 'utf8').replace('export default {', 'globalThis.worker = {') + `
globalThis.api = { generateSubscriptionContent, handleGetSubscriptions, handleUpdateSubscriptionMembers,
  validateCombinationGraph, handleLogout, serveAdminPanel };`;
const context = vm.createContext(globals);
new vm.Script(source).runInContext(context);
const api = context.api;

// 在内存 SQLite 中执行 Worker 实际使用的 SQL，避免模拟器掩盖 CTE/排序问题。
const sqlite = `
import sqlite3, json, sys
data = json.load(sys.stdin)
db = sqlite3.connect(':memory:')
db.row_factory = sqlite3.Row
db.executescript('''
CREATE TABLE subscriptions(id INTEGER PRIMARY KEY, path TEXT UNIQUE, name TEXT, subscription_type TEXT DEFAULT 'standard', sub_order INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0, converter_backend TEXT DEFAULT 'sub.xeton.dev', auto_rename INTEGER DEFAULT 0);
CREATE TABLE nodes(id INTEGER PRIMARY KEY, subscription_id INTEGER, original_link TEXT, node_order INTEGER, enabled INTEGER);
CREATE TABLE subscription_members(parent_subscription_id INTEGER, child_subscription_id INTEGER, member_order INTEGER, PRIMARY KEY(parent_subscription_id, child_subscription_id));
CREATE TABLE sessions(session_id TEXT, username TEXT, expires_at INTEGER);
''')
for table, rows in data['tables'].items():
  for row in rows:
    columns = list(row)
    db.execute('INSERT INTO '+table+' ('+','.join(columns)+') VALUES ('+','.join('?' for _ in columns)+')', [row[c] for c in columns])
results = []
for query in data['queries']:
  cursor = db.execute(query['sql'], query['params'])
  results.append({'success': True, 'results': [dict(r) for r in cursor.fetchall()] if cursor.description else [], 'meta': {'changes': max(cursor.rowcount, 0)}})
tables = {table: [dict(r) for r in db.execute('SELECT * FROM '+table)] for table in data['tables']}
print(json.dumps({'results': results, 'tables': tables}))
`;
function database(tables) {
  const db = { tables: { subscriptions: [], nodes: [], subscription_members: [], sessions: [], ...tables }, queries: 0, batches: 0 };
  function execute(queries) {
    db.queries += queries.length;
    const result = spawnSync('python3', ['-c', sqlite], {
      input: JSON.stringify({ tables: db.tables, queries }), encoding: 'utf8',
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    db.tables = output.tables;
    return output.results;
  }
  db.prepare = sql => {
    const statement = { sql, params: [], bind(...params) { return { ...statement, params }; },
      async all() { return execute([this])[0]; },
      async first() { return (await this.all()).results[0] || null; },
      async run() { return execute([this])[0]; } };
    return statement;
  };
  db.batch = async statements => { db.batches++; return execute(statements); };
  return db;
}
const sub = (id, path, type = 'standard') => ({ id, path, name: path, subscription_type: type });
const member = (parent, child, order = 0) => ({ parent_subscription_id: parent, child_subscription_id: child, member_order: order });
const node = (id, subscription_id, original_link, node_order = id, enabled = 1) => ({ id, subscription_id, original_link, node_order, enabled });
const db = database({
  subscriptions: [sub(1, 'combo', 'combined'), sub(2, 'leftcombo', 'combined'), sub(3, 'rightcombo', 'combined'),
    sub(4, 'oracle'), sub(5, 'america'), sub(6, 'unrelated')],
  subscription_members: [member(1, 3, 1), member(1, 2, 0), member(2, 4), member(3, 4), member(3, 5, 1)],
  nodes: [node(1, 1, 'ss://own#Own'), node(2, 4, 'ss://hk#HK'), node(3, 4, 'ss://hk#HK'),
    node(4, 4, 'ss://disabled#Hidden', 4, 0), node(5, 5, 'ss://us#US'),
    node(6, 6, 'ss://unrelated#Hidden'), node(7, 4, 'ss://hk2#HK2', 0, null)],
});
const combined = await api.generateSubscriptionContent({ DB: db }, 'combo');
assert.equal(combined, 'ss://own#Own\nss://hk2#HK2\nss://hk#HK\nss://us#US');
assert.equal(db.queries, 3);
assert.equal(db.batches, 1);
const countBefore = db.queries;
const listing = await (await api.handleGetSubscriptions({ DB: db })).json();
assert.equal(listing.data.find(item => item.path === 'combo').nodeCount, 4);
assert.equal(listing.data.find(item => item.path === 'rightcombo').nodeCount, 3);
assert.equal(db.queries - countBefore, 4); // 列表一次查询 + 全图三次，不随组合数量增长。
assert.equal(await api.generateSubscriptionContent({ DB: db }, 'missing'), '');

const many = database({
  subscriptions: [sub(1, 'manycombo', 'combined'), ...Array.from({ length: 20 }, (_, i) => sub(i + 2, 'plain' + i))],
  subscription_members: Array.from({ length: 20 }, (_, i) => member(1, i + 2, i)),
  nodes: Array.from({ length: 20 }, (_, i) => node(i + 1, i + 2, 'ss://node' + i)),
});
assert.equal((await api.generateSubscriptionContent({ DB: many }, 'manycombo')).split('\n').length, 20);
assert.equal(many.queries, 3);

// 旧数据的异常循环安全终止；深层旧数据仍完整输出，不再悄悄丢弃第九层之后内容。
db.tables.subscription_members.push(member(4, 1));
assert.equal(await api.generateSubscriptionContent({ DB: db }, 'combo'), combined);
const chainSubs = Array.from({ length: 11 }, (_, i) => sub(i + 1, 'chain' + i, i < 10 ? 'combined' : 'standard'));
const chainMembers = Array.from({ length: 10 }, (_, i) => member(i + 1, i + 2));
const deepDb = database({ subscriptions: chainSubs, subscription_members: chainMembers,
  nodes: [node(1, 11, 'ss://deep#Deep')], sessions: [{ session_id: 'test-session', username: 'test', expires_at: Date.now() + 60000 }] });
assert.equal(await api.generateSubscriptionContent({ DB: deepDb }, 'chain0'), 'ss://deep#Deep');
assert.match(api.validateCombinationGraph(chainMembers.slice(0, 8), 'new', [1]), /八层/);
assert.equal(api.validateCombinationGraph(chainMembers.slice(0, 7), 'new', [1]), null);
assert.match(api.validateCombinationGraph([member(1, 2)], 2, [1]), /循环/);
assert.equal(api.validateCombinationGraph([member(100, 101), member(101, 100)], 1, [2]), null);
// 子组合本身未超过八层，但修改会让其上级超限，也必须拒绝。
assert.equal(api.validateCombinationGraph(chainMembers.slice(0, 7), 8, [9, 10]), null);
assert.match(api.validateCombinationGraph([...chainMembers.slice(0, 7), member(9, 10)], 8, [9]), /八层/);

const snapshot = JSON.stringify(deepDb.tables.subscription_members);
const update = await api.handleUpdateSubscriptionMembers(new Request('https://example.com/sub/api/subscriptions/chain7/members',
  { method: 'PUT', body: JSON.stringify({ member_paths: ['chain8'] }) }), { DB: deepDb }, 'chain7');
assert.equal(update.status, 400);
assert.equal(JSON.stringify(deepDb.tables.subscription_members), snapshot);
const env = { DB: deepDb, ADMIN_PATH: 'sub', ADMIN_USERNAME: 'test', ADMIN_PASSWORD: 'test', TURNSTILE_SITE_KEY: 'test', TURNSTILE_SECRET_KEY: 'test' };
const create = await context.worker.fetch(new Request('https://example.com/sub/api/subscriptions', {
  method: 'POST', headers: { Cookie: 'session=test-session' }, body: JSON.stringify({ name: 'Too Deep', member_paths: ['chain0'] }),
}), env);
assert.equal(create.status, 400);
assert.equal(deepDb.tables.subscriptions.length, 11);

// 退出后删除服务端会话并向浏览器返回清除 Cookie 的实际响应头。
const logout = await api.handleLogout(new Request('https://example.com/sub/logout', { headers: { Cookie: 'session=test-session' } }), env, 'sub');
assert.equal(logout.status, 302);
assert.equal(logout.headers.get('Location'), 'https://example.com/sub/login');
assert.match(logout.headers.get('Set-Cookie'), /^session=;.*Max-Age=0; Secure/);
assert.equal(logout.headers.get('Cache-Control'), 'no-store');
assert.equal(deepDb.tables.sessions.length, 0);

// 渲染真实按钮，再执行其 onclick；单引号、引号、实体和换行必须完整往返。
const elements = new Map();
const getElement = id => {
  if (!elements.has(id)) elements.set(id, { innerHTML: '', style: {}, classList: { add() {}, remove() {} }, querySelectorAll() { return []; } });
  return elements.get(id);
};
const oddName = 'O\'Reilly "订阅" <test> & &#39;\nnext';
const oddLink = 'trojan://pass@example.com:443#O\'Reilly%20"节点"&x=1';
const frontend = vm.createContext({ ...globals,
  window: { addEventListener() {}, location: { origin: 'https://example.com' } },
  document: { addEventListener() {}, getElementById: getElement, querySelectorAll() { return []; } },
  localStorage: { getItem() { return null; } },
  fetch: async url => ({ ok: true, json: async () => ({ success: true, data: url.endsWith('/nodes')
    ? [{ id: 1, name: oddName, original_link: oddLink, enabled: 1, node_order: 1 }]
    : [{ name: oddName, path: 'oracle', auto_rename: 1, nodeCount: 1 }] }) }),
});
const html = await (await api.serveAdminPanel({}, 'sub')).text();
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]).runInContext(frontend);
frontend.initSubscriptionSortable = () => {};
frontend.initializeSortable = () => {};
frontend.showToast = message => { throw new Error(message); };
await frontend.loadSubscriptions();
await frontend.loadNodeList('oracle');
const decodeHtml = value => value.replace(/&#(\d+);/g, (_, number) => String.fromCharCode(Number(number)));
function button(fragment, title) {
  const tag = [...fragment.matchAll(/<button\b[^>]*>/g)].map(match => match[0]).find(tag => tag.includes('title="' + title + '"'));
  assert.ok(tag, 'Missing ' + title + ' button');
  const attributes = Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], decodeHtml(match[2])]));
  const dataset = Object.fromEntries(Object.entries(attributes).filter(([key]) => key.startsWith('data-'))
    .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value]));
  return { dataset, handler: attributes.onclick };
}
const settings = button(getElement('subscriptionList').innerHTML, '设置');
let received;
frontend.showEditSubscriptionModal = (...args) => { received = args; };
vm.compileFunction(settings.handler, [], { parsingContext: frontend }).call(settings);
assert.deepEqual(received, ['oracle', oddName, 'sub.xeton.dev', true]);
const edit = button(getElement('node-tbody-oracle').innerHTML, '编辑');
frontend.showEditNodeModal = (...args) => { received = args; };
vm.compileFunction(edit.handler, [], { parsingContext: frontend }).call(edit);
assert.deepEqual(received, ['oracle', '1', oddLink]);
const copy = button(getElement('node-tbody-oracle').innerHTML, '复制');
frontend.copyToClipboard = (...args) => { received = args; };
vm.compileFunction(copy.handler, [], { parsingContext: frontend }).call(copy);
assert.equal(received[0], oddLink);
// 搜索/类型筛选只改变卡片可见性；筛选时禁用拖动，清空后恢复。
const cards = ['oracle', 'surgecombo', 'hkserver'].map(path => ({ dataset: { path }, hidden: false }));
getElement('subscriptionList').querySelectorAll = () => cards;
let dragDisabled;
getElement('subscriptionList').sortableInstance = { option(key, value) { assert.equal(key, 'disabled'); dragDisabled = value; } };
vm.runInContext(`subscriptionsData = [
  { path: 'oracle', name: "O'Reilly", subscription_type: 'standard' },
  { path: 'surgecombo', name: 'Surge 组合', subscription_type: 'combined' },
  { path: 'hkserver', name: '香港', subscription_type: 'standard' }
];`, frontend);
getElement('subscriptionSearch').value = ' 香港 ';
frontend.filterSubscriptions();
assert.deepEqual(cards.map(card => card.hidden), [true, true, false]);
assert.equal(dragDisabled, true);
getElement('subscriptionSearch').value = '';
frontend.setSubscriptionFilter('combined');
assert.deepEqual(cards.map(card => card.hidden), [true, false, true]);
getElement('subscriptionSearch').value = 'no match';
frontend.filterSubscriptions();
assert.equal(getElement('subscriptionNoResults').hidden, false);
getElement('subscriptionSearch').value = '';
frontend.setSubscriptionFilter('all');
assert.ok(cards.every(card => !card.hidden));
assert.equal(dragDisabled, false);
console.log(JSON.stringify({ passed: true, combinationQueryCount: many.queries, sqliteQueries: true,
  orderedDeduplication: true, depthAndCycleChecks: true, logoutCookie: true, renderedButtonClicks: 3, subscriptionFilters: true }));
