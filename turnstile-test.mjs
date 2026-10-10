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

console.log(JSON.stringify({ passed: true, htmlBytes: html.length }, null, 2));
