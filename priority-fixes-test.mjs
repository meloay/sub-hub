import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const source = fs.readFileSync('./sub-hub-worker.js', 'utf8')
  .replace('export default {', 'globalThis.worker = {') + `
globalThis.api = { convertToYaml, convertToClash, parseSSToClash, parseSIP002Format,
  extractNodeName, applyAutomaticNodeNames, parseMieruSimpleToClash, serveAdminPanel };`;
const globals = {
  URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, atob, btoa,
  Response, Request, Headers, crypto, console, encodeURIComponent, decodeURIComponent,
  escape, unescape,
};
const context = vm.createContext(globals);
new vm.Script(source, { filename: 'sub-hub-worker.js' }).runInContext(context);
const api = context.api;

// 用独立 YAML 解析器验证真实输出，而非只比较生成的文本。
function parseYaml(yaml) {
  const result = spawnSync('ruby', ['-rjson', '-rpsych', '-e',
    'print JSON.generate(Psych.safe_load(STDIN.read))'], { input: yaml, encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const specialStrings = [
  'HK: 01', 'test # HK', '[HK]', '{HK}', '*alias', '&anchor', '!tag',
  'true', 'null', '1e3', '2026-10-08', '- value', '? value', '---', '',
  'quote" and \\ slash', 'line\nbreak', 'tab\tvalue\rnext', '\u0000\u0007',
  'next\u0085line\u2028separator\u2029paragraph', '🇭🇰 香港 01', ' pass:word ',
];
const roundTripInput = Object.fromEntries(specialStrings.map((value, i) => ['key' + i, value]));
Object.assign(roundTripInput, {
  'key: # [odd]\n': 'value',
  strings: specialStrings,
  proxies: [{ name: 'HK: 01', password: 'pass # word', reserved: [0, 128, 255] }],
  flags: { enabled: true, count: 3, empty: null },
});
assert.deepEqual(parseYaml(api.convertToYaml(roundTripInput)), roundTripInput);

const passwords = ['pass', 'pass:with:colon', ':leading:trailing:', 'pass%3Aword', '密碼:+% #'];
for (const password of passwords) {
  const credentials = 'aes-128-gcm:' + password;
  const representations = [
    Buffer.from(credentials).toString('base64'),
    Buffer.from(credentials).toString('base64url'),
    'aes-128-gcm:' + encodeURIComponent(password),
    encodeURIComponent(credentials),
  ];
  for (const userinfo of representations) {
    const link = 'ss://' + userinfo + '@example.com:443#Test';
    assert.equal(api.parseSSToClash(link)?.password, password);
    assert.equal(api.parseSIP002Format(link),
      'Test = ss, example.com, 443, encrypt-method=aes-128-gcm, password=' + password);
    assert.equal(parseYaml(api.convertToClash(link)).proxies[0].password, password);
  }
}
assert.equal(api.parseSSToClash('ss://invalid@example.com:443#Test'), null);

// 官方标准配置样例中将等长的 default 替换为 HK01___，保持 protobuf 长度字段不变。
const officialPayload = 'CpsBCgdkZWZhdWx0ElgKBWJhb3ppEg1tYW5saWFucGVuZmVuGkA0MGFiYWM0MGY1OWRhNTVkYWQ2YTk5ODMxYTUxMTY1MjJmYmM4MGUzODViYjFhYjE0ZGM1MmRiMzY4ZjczOGE0Gi8SCWxvY2FsaG9zdBoFCIo0EAIaDRACGgk5OTk5LTk5OTkaBQjZMhABGgUIoCYQASD4CioCCAQSB2RlZmF1bHQYnUYguAgwBTgA';
const hkPayload = Buffer.from(Buffer.from(officialPayload, 'base64').toString('latin1')
  .replaceAll('default', 'HK01___'), 'latin1').toString('base64url');
const standardLink = 'mieru://' + hkPayload;
assert.equal(api.extractNodeName(standardLink), 'HK01___');
const renamedStandard = api.applyAutomaticNodeNames(standardLink);
assert.equal(api.extractNodeName(renamedStandard), '🇭🇰 香港 01');
assert.equal(api.extractNodeName(renamedStandard.split('#')[0]), '🇭🇰 香港 01');
const standardNodes = parseYaml(api.convertToClash(renamedStandard)).proxies;
assert.equal(standardNodes.length, 4);
assert.equal(new Set(standardNodes.map(node => node.name)).size, 4);
assert.ok(standardNodes.every(node => node.username === 'baozi' && node.password === 'manlianpenfen'));
assert.equal(api.extractNodeName('mieru://invalid'), 'Mieru 标准配置');

const simple = 'mierus://user:pass%2Bword@example.com?profile=HK01&port=443&port=8443&protocol=TCP&protocol=UDP';
const renamedSimple = api.applyAutomaticNodeNames(simple);
const simpleNodes = api.parseMieruSimpleToClash(renamedSimple);
assert.equal(simpleNodes.length, 2);
assert.notEqual(simpleNodes[0].name, simpleNodes[1].name);
assert.ok(simpleNodes.every(node => node.password === 'pass+word'));
assert.equal(decodeURIComponent(renamedSimple.match(/[?&]profile=([^&#]*)/)[1]), '🇭🇰 香港 01');
const mixedNodes = parseYaml(api.convertToClash([renamedSimple, renamedSimple,
  'ss://' + btoa('aes-128-gcm:pass') + '@example.com:443#' + encodeURIComponent('🇭🇰 香港 01 (3)'),
].join('\n'))).proxies;
assert.equal(mixedNodes.length, 5);
assert.equal(new Set(mixedNodes.map(node => node.name)).size, mixedNodes.length);
assert.equal(mixedNodes[4].name, '🇭🇰 香港 01 (3)');

// 执行管理页脚本，验证其读取标准 Mieru 名称与后台一致。
const html = await api.serveAdminPanel({}, 'sub').text();
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const frontend = vm.createContext({ ...globals,
  window: { addEventListener() {} }, document: { addEventListener() {} },
  localStorage: { getItem() { return null; } },
});
for (const script of scripts) new vm.Script(script).runInContext(frontend);
assert.equal(frontend.extractNodeNameFrontend(standardLink), 'HK01___');
assert.equal(frontend.extractNodeNameFrontend(renamedStandard), '🇭🇰 香港 01');

// 从实际 fetch 入口验证配置下载：正常、空订阅、仅不支持的节点、特殊字符输入。
const hostileName = 'HK\nexternal-controller: 0.0.0.0:9090\nallow-lan: true';
const ss = 'ss://' + btoa('aes-128-gcm:pass:word') + '@example.com:443#';
for (const content of [ss + 'HK01', '', 'unsupported://example.com', ss + encodeURIComponent(hostileName)]) {
  const env = {
    ADMIN_PATH: 'sub', ADMIN_USERNAME: 'test', ADMIN_PASSWORD: 'test',
    TURNSTILE_SITE_KEY: 'test', TURNSTILE_SECRET_KEY: 'test',
    DB: { async batch(statements) { return Promise.all(statements.map(statement => statement.all())); }, prepare(sql) { return { bind() { return { async all() {
      if (sql.includes('SELECT * FROM subscriptions')) return { results: [{ id: 1, auto_rename: 0 }] };
      if (sql.includes('SELECT s.id, s.path FROM subscriptions')) return { results: [{ id: 1, path: 'example' }] };
      if (sql.includes('FROM nodes')) return { results: content ? [{ subscription_id: 1, original_link: content }] : [] };
      if (sql.includes('FROM subscription_members')) return { results: [] };
      throw new Error('Unexpected SQL: ' + sql);
    } }; } }; } },
  };
  const response = await context.worker.fetch(new Request('https://example.com/example/clash'), env);
  assert.equal(response.status, 200);
  const config = parseYaml(await response.text());
  assert.equal(config['allow-lan'], false);
  assert.equal(config['external-controller'], '127.0.0.1:9090');
  assert.equal(config['mixed-port'], 7890);
  assert.equal(config['proxy-groups'].length, 8);
  assert.ok(config.rules.includes('MATCH,节点选择'));
  assert.ok(config['rule-providers'].telegram_ip);
  if (content.startsWith('ss://')) {
    assert.equal(config.proxies.length, 1);
    assert.equal(config.proxies[0].password, 'pass:word');
    assert.ok(config['proxy-groups'][0].proxies.includes(config.proxies[0].name));
  } else {
    assert.equal(config.proxies.length, 0);
  }
}
console.log(JSON.stringify({ passed: true, yamlRoundTrip: true, ssRepresentations: 20,
  mieruStandardAndSimple: true, frontendNameExtraction: true, nativeRouteCases: 4 }));
