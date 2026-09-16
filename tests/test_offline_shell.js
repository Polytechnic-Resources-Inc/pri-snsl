const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../service-worker.js'), 'utf8');
test('HTTPS same-origin navigation uses cached shell when offline', async () => {
    const listeners = {};
    let response, reads = 0;
    vm.runInNewContext(source, { console: { log() {}, warn() {}, error() {} }, URL, Response,
        self: { location: { origin: 'https://local.invalid' }, addEventListener: (type, fn) => listeners[type] = fn },
        caches: { open: async () => ({ match: async () => { reads++; return new Response('offline shell'); } }), match: async () => { reads++; return new Response('offline shell'); } },
        fetch: async () => { throw Error('offline'); } });
    listeners.fetch({ request: { url: 'https://local.invalid/index.html', method: 'GET', mode: 'navigate', destination: 'document' }, respondWith: p => response = p, waitUntil() {} });
    assert.equal(await (await response).text(), 'offline shell');
    assert.ok(reads > 0);
});
test('activation does not force-navigate or clear unrelated cache', async () => {
    const listeners = {}, deleted = [];
    let completion, navigated = 0;
    vm.runInNewContext(source, { console: { log() {}, warn() {}, error() {} }, URL, Response,
        self: { location: { origin: 'https://local.invalid' }, addEventListener: (type, fn) => listeners[type] = fn,
            clients: { claim: async () => {}, matchAll: async () => [{ navigate() { navigated++; }, postMessage() {} }] } },
        caches: { keys: async () => ['unrelated-app', 'seescan-v8.8.7-offline'], delete: async key => { deleted.push(key); } } });
    listeners.activate({ waitUntil: p => completion = p });
    await completion;
    assert.equal(navigated, 0);
    assert.ok(!deleted.includes('unrelated-app'));
});
