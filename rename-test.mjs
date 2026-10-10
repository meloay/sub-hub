import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let source = fs.readFileSync('./sub-hub-worker.js', 'utf8');
source = source.replace('export default {', 'globalThis.worker = {');
source += '\nglobalThis.renameTestApi = { applyAutomaticNodeNames, detectAutoRenameRegion, extractNodeName, createSubscriptionPath, convertToSurge, parseMieruSimpleToClash, parseMieruStandardToClash };';

const context = vm.createContext({
  URL,
  URLSearchParams,
  TextDecoder,
  TextEncoder,
  Uint8Array,
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

const { applyAutomaticNodeNames, extractNodeName, createSubscriptionPath, convertToSurge, parseMieruSimpleToClash, parseMieruStandardToClash } = context.renameTestApi;
const vmess = 'vmess://' + btoa(JSON.stringify({ add: 'example.com', port: '443', id: '00000000-0000-0000-0000-000000000000', ps: 'US Los Angeles' }));
const input = [
  'ss://YWVzLTEyOC1nY206cGFzcw@example.com:443#香港-A',
  'trojan://password@example.com:443#Hong%20Kong-B',
  vmess,
  'vless://00000000-0000-0000-0000-000000000000@example.com:443#Unknown',
  'mieru://ZmFrZQ#Japan-Tokyo',
].join('\n');

const output = applyAutomaticNodeNames(input);
const lines = output.split('\n');
assert.equal(extractNodeName(lines[0]), '🇭🇰 香港 01');
assert.equal(extractNodeName(lines[1]), '🇭🇰 香港 02');
assert.equal(extractNodeName(lines[2]), '🇺🇸 美国 01');
assert.equal(extractNodeName(lines[3]), '🌐 其他 01');
assert.equal(extractNodeName(lines[4]), '🇯🇵 日本 01');
assert.equal(lines.length, 5);

const mieruSimple = 'mierus://user:password@hk.example.com?port=443&profile=HK01&protocol=TCP';
const renamedMieruSimple = applyAutomaticNodeNames(mieruSimple);
const renamedMieruSimpleUrl = new URL(renamedMieruSimple);
assert.equal(renamedMieruSimpleUrl.searchParams.get('profile'), '🇭🇰 香港 01');
assert.equal(extractNodeName(renamedMieruSimple), '🇭🇰 香港 01');
assert.equal(parseMieruSimpleToClash(renamedMieruSimple)[0].name, '🇭🇰 香港 01');
// 同时覆盖只做百分号解码的客户端，避免 URLSearchParams 自动解码 + 掩盖兼容性问题。
const renamedMieruThird = applyAutomaticNodeNames(Array(3).fill(mieruSimple).join('\n')).split('\n')[2];
const rawProfile = renamedMieruThird.match(/[?&]profile=([^&#]*)/)[1];
assert.equal(decodeURIComponent(rawProfile), '🇭🇰 香港 03');
assert.ok(!rawProfile.includes('+'));
const mieruWithLiteralPlus = mieruSimple.replace('password@', 'pass%2Bword@') + '&traffic-pattern=ab%2Bcd%3D';
const renamedMieruWithLiteralPlus = new URL(applyAutomaticNodeNames(mieruWithLiteralPlus));
assert.equal(decodeURIComponent(renamedMieruWithLiteralPlus.password), 'pass+word');
assert.equal(renamedMieruWithLiteralPlus.searchParams.get('traffic-pattern'), 'ab+cd=');
assert.equal(applyAutomaticNodeNames(renamedMieruSimple), renamedMieruSimple);

const mieruStandard = 'mieru://CpsBCgdkZWZhdWx0ElgKBWJhb3ppEg1tYW5saWFucGVuZmVuGkA0MGFiYWM0MGY1OWRhNTVkYWQ2YTk5ODMxYTUxMTY1MjJmYmM4MGUzODViYjFhYjE0ZGM1MmRiMzY4ZjczOGE0Gi8SCWxvY2FsaG9zdBoFCIo0EAIaDRACGgk5OTk5LTk5OTkaBQjZMhABGgUIoCYQASD4CioCCAQSB2RlZmF1bHQYnUYguAgwBTgA#Japan';
const renamedMieruStandard = applyAutomaticNodeNames(mieruStandard);
assert.equal(extractNodeName(renamedMieruStandard), '🇯🇵 日本 01');
const renamedMieruStandardNodes = parseMieruStandardToClash(renamedMieruStandard);
assert.ok(renamedMieruStandardNodes?.length > 0);
assert.equal(renamedMieruStandardNodes[0].name, '🇯🇵 日本 01');
assert.equal(new Set(renamedMieruStandardNodes.map(node => node.name)).size, renamedMieruStandardNodes.length);
assert.equal(extractNodeName(renamedMieruStandard.split('#')[0]), '🇯🇵 日本 01');
const snellInput = [
  'HK01 = snell, hk.example.com, 443, psk=password, version=3',
  'HK02 = snell, hk2.example.com, 443, psk=password, version=3',
  'US01 = snell, us.example.com, 443, psk=password, version=3',
  'UK-03 = snell, uk.example.com, 443, psk=password, version=3',
].join('\n');
const renamedSnell = applyAutomaticNodeNames(snellInput);
assert.deepEqual(renamedSnell.split('\n').map(extractNodeName), [
  '🇭🇰 香港 01',
  '🇭🇰 香港 02',
  '🇺🇸 美国 01',
  '🇬🇧 英国 01',
]);
const surgeSnell = convertToSurge(renamedSnell);
assert.match(surgeSnell, /^🇭🇰 香港 01 = snell, hk\.example\.com, 443/m);
assert.match(surgeSnell, /^🇺🇸 美国 01 = snell, us\.example\.com, 443/m);
assert.match(surgeSnell, /^🇬🇧 英国 01 = snell, uk\.example\.com, 443/m);
const generatedPaths = Array.from({ length: 1000 }, () => createSubscriptionPath('Surge'));
assert.ok(generatedPaths.every(path => /^surge[a-z0-9]{6}$/.test(path)));
assert.equal(new Set(generatedPaths).size, generatedPaths.length);
assert.match(createSubscriptionPath('中文订阅'), /^sub[a-z0-9]{6}$/);
assert.match(createSubscriptionPath('My Subscription'), /^mysubscription[a-z0-9]{6}$/);

const groupedInput = [
  'ss://YWVzLTEyOC1nY206cGFzcw@example.com:443#香港-A',
  'ss://YWVzLTEyOC1nY206cGFzcw@example.com:443#美国-A',
  'ss://YWVzLTEyOC1nY206cGFzcw@example.com:443#香港-B',
  'ss://YWVzLTEyOC1nY206cGFzcw@example.com:443#台湾-A',
  'ss://YWVzLTEyOC1nY206cGFzcw@example.com:443#美国-B',
].join('\n');
assert.deepEqual(applyAutomaticNodeNames(groupedInput).split('\n').map(extractNodeName), [
  '🇭🇰 香港 01',
  '🇭🇰 香港 02',
  '🇺🇸 美国 01',
  '🇺🇸 美国 02',
  '🇨🇳 台湾 01',
]);
console.log(JSON.stringify({ passed: true, names: lines.map(extractNodeName), surgeSnell: surgeSnell.split('\n'), samplePath: generatedPaths[0] }, null, 2));
