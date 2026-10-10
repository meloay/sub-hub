import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let source = fs.readFileSync('./sub-hub-worker.js', 'utf8');
source = source.replace('export default {', 'globalThis.worker = {');
source += '\nglobalThis.combinationTestApi = { generateSubscriptionContent };';

const context = vm.createContext({
  URL,
  URLSearchParams,
  TextDecoder,
  TextEncoder,
  atob,
  btoa,
  encodeURIComponent,
  decodeURIComponent,
  escape,
  unescape,
  Response,
  crypto,
  console,
});
new vm.Script(source, { filename: 'sub-hub-worker.js' }).runInContext(context);

const subscriptions = new Map([
  ['combo', 1],
  ['hongkong', 2],
  ['america', 3],
]);
const nodes = new Map([
  [1, ['ss://own#Own']],
  [2, ['ss://hk1#HK1', 'ss://hk2#HK2']],
  [3, ['ss://us1#US1']],
]);
const members = new Map([
  [1, ['hongkong', 'america']],
  [3, ['combo']], // 模拟异常循环引用，生成器必须安全停止。
]);

const env = {
  DB: {
    async batch(statements) { return Promise.all(statements.map(statement => statement.all())); },
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async all() {
              if (sql.includes('SELECT s.id, s.path FROM subscriptions')) {
                return { results: [...subscriptions].map(([path, id]) => ({ path, id })) };
              }
              if (sql.includes('FROM nodes')) {
                return { results: [...nodes].flatMap(([subscription_id, links]) => links.map(original_link => ({ subscription_id, original_link }))) };
              }
              if (sql.includes('FROM subscription_members')) {
                return { results: [...members].flatMap(([parent_subscription_id, paths]) => paths.map(path => ({ parent_subscription_id, child_subscription_id: subscriptions.get(path) }))) };
              }
              throw new Error(`Unexpected SQL: ${sql}`);
            },
          };
        },
      };
    },
  },
};

const result = await context.combinationTestApi.generateSubscriptionContent(env, 'combo');
assert.equal(result, [
  'ss://own#Own',
  'ss://hk1#HK1',
  'ss://hk2#HK2',
  'ss://us1#US1',
].join('\n'));

assert.equal(await context.combinationTestApi.generateSubscriptionContent(env, 'missing'), '');
console.log(JSON.stringify({ passed: true, lines: result.split('\n') }, null, 2));
