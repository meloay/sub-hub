import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let source = fs.readFileSync('./sub-hub-worker.js', 'utf8');
source = source.replace('export default {', 'globalThis.worker = {');
source += '\nglobalThis.turnstileTestApi = { serveLoginPage, verifyTurnstileToken };';

let verificationResult = { success: true, hostname: 'example.com', action: 'login' };
let verificationRequest;
const mockFetch = async (url, init) => {
  verificationRequest = { url, init };
  return new Response(JSON.stringify(verificationResult), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const context = vm.createContext({
  URL, URLSearchParams, TextDecoder, TextEncoder, Headers, Request, Response,
  FormData, Blob, AbortSignal,
  atob, btoa, encodeURIComponent, decodeURIComponent, escape, unescape,
  crypto, console, fetch: mockFetch,
});
new vm.Script(source, { filename: 'sub-hub-worker.js' }).runInContext(context);

const page = context.turnstileTestApi.serveLoginPage('sub', 'public-site-key');
const html = await page.text();
assert.match(html, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/);
assert.match(html, /data-sitekey="public-site-key"/);
assert.match(html, /data-action="login"/);
assert.match(html, /turnstile_token: turnstileToken/);
assert.match(html, /window\.turnstile\.reset\(\)/);

const request = new Request('https://example.com/sub/login', {
  headers: { 'CF-Connecting-IP': '203.0.113.7' },
});
assert.equal(await context.turnstileTestApi.verifyTurnstileToken(request, 'secret', 'token'), true);
assert.equal(verificationRequest.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
assert.equal(verificationRequest.init.body.get('secret'), 'secret');
assert.equal(verificationRequest.init.body.get('response'), 'token');
assert.equal(verificationRequest.init.body.get('remoteip'), '203.0.113.7');

verificationResult = { success: true, hostname: 'other.example', action: 'login' };
assert.equal(await context.turnstileTestApi.verifyTurnstileToken(request, 'secret', 'token'), false);
verificationResult = { success: true, hostname: 'example.com', action: 'other' };
assert.equal(await context.turnstileTestApi.verifyTurnstileToken(request, 'secret', 'token'), false);
assert.equal(await context.turnstileTestApi.verifyTurnstileToken(request, 'secret', ''), false);

// 模板不固定维护者域名：匹配新用户实际访问域名，且可显式限制域名。
const customRequest = new Request('https://my-sub.example.net/admin/login');
verificationResult = { success: true, hostname: 'my-sub.example.net', action: 'login' };
assert.equal(await context.turnstileTestApi.verifyTurnstileToken(customRequest, 'secret', 'token'), true);
assert.equal(await context.turnstileTestApi.verifyTurnstileToken(customRequest, 'secret', 'token', 'locked.example.net'), false);
verificationResult = { success: true, hostname: 'example.com', action: 'login' };
assert.equal(await context.turnstileTestApi.verifyTurnstileToken(customRequest, 'secret', 'token'), false);

// 未配置：页面不加载验证组件，正常密码登录；已配置：不能绕过验证。
const baseEnv = { ADMIN_PATH: 'admin', ADMIN_USERNAME: 'demo', ADMIN_PASSWORD: 'strong-test-password', DB: {
  prepare() { return { bind() { return this; }, async run() {} }; },
  async batch() {},
} };
const loginRequest = (password = baseEnv.ADMIN_PASSWORD, token = '') => new Request('https://example.com/admin/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'demo', password, turnstile_token: token }),
});
const optionalPage = await context.worker.fetch(new Request('https://example.com/admin/login'), baseEnv);
assert.equal(optionalPage.status, 200);
const optionalHtml = await optionalPage.text();
assert.doesNotMatch(optionalHtml, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js|class="cf-turnstile"/);
assert.match(optionalHtml, /if \(false && !turnstileToken\)/);
verificationRequest = undefined;
const login = await context.worker.fetch(loginRequest(), baseEnv);
assert.equal(login.status, 200);
assert.equal((await login.json()).success, true);
assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict;.*Secure/);
assert.equal(verificationRequest, undefined);
assert.equal((await context.worker.fetch(loginRequest('wrong'), baseEnv)).status, 401);
for (const partial of [{ TURNSTILE_SITE_KEY: 'site' }, { TURNSTILE_SECRET_KEY: 'secret' }]) {
  const env = { ...baseEnv, ...partial };
  assert.equal((await context.worker.fetch(new Request('https://example.com/admin/login'), env)).status, 503);
  assert.equal((await context.worker.fetch(loginRequest(), env)).status, 503);
}
const enabledEnv = { ...baseEnv, TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' };
assert.equal((await context.worker.fetch(loginRequest(), enabledEnv)).status, 403);
verificationResult = { success: false };
assert.equal((await context.worker.fetch(loginRequest(baseEnv.ADMIN_PASSWORD, 'token'), enabledEnv)).status, 403);
verificationResult = { success: true, hostname: 'example.com', action: 'login' };
assert.equal((await context.worker.fetch(loginRequest(baseEnv.ADMIN_PASSWORD, 'token'), enabledEnv)).status, 200);
assert.equal((await context.worker.fetch(new Request('https://example.com/admin'), { ...baseEnv, ADMIN_PASSWORD: '' })).status, 503);

console.log(JSON.stringify({ passed: true, htmlBytes: html.length, optionalLogin: true }, null, 2));
