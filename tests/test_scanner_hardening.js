// Regressions execute functions from app.js, never mirrored implementations.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
function extract(name) {
    const match = new RegExp('(?:async )?function ' + name + '\\(').exec(source);
    assert(match, `${name} exists`);
    return source.slice(match.index, source.indexOf('\n}', match.index) + 2);
}
function load(names, extras = {}) {
    const context = vm.createContext({ console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, Date, crypto: require('node:crypto').webcrypto, ...extras });
    vm.runInContext(names.map(extract).join('\n'), context);
    return context;
}
test('Saved requires matching retry identity, independent of timestamp', () => {
    const c = load(['classifyExistingScanConflict'], { EXISTING_SCAN_CONFLICT_WINDOW_MS: 60000 });
    assert.equal(c.classifyExistingScanConflict({ existingScan: { idempotency_key: 'mine', created_at: '2000-01-01' }, idempotencyKey: 'mine' }), 'OK');
    assert.equal(c.classifyExistingScanConflict({ existingScan: { idempotency_key: 'other', created_at: new Date().toISOString() }, idempotencyKey: 'mine' }), 'DUPLICATE');
    assert.equal(c.classifyExistingScanConflict({ existingScan: { idempotency_key: 'other', created_at: '2099-01-01' }, idempotencyKey: 'mine' }), 'DUPLICATE');
    assert.equal(c.classifyExistingScanConflict({ existingScan: { idempotency_key: null }, idempotencyKey: 'mine' }), 'DUPLICATE');
    assert.equal(c.classifyExistingScanConflict({ existingScan: null, idempotencyKey: 'mine' }), 'RETRYABLE');
});
test('foreign-key conflict is not a duplicate (must not discard queue)', () => {
    const c = load(['makeSyncResult', 'classifySyncResult']);
    assert.equal(c.classifySyncResult({ httpStatus: 409, errorCode: '23503' }).status, 'BLOCKED');
    assert.equal(c.classifySyncResult({ httpStatus: 409, errorCode: '23505' }).status, 'DUPLICATE');
});
test('local storage failure + offline cannot report Queued', async () => {
    const c = load(['send'], { navigator: { onLine: false }, queueScan: async () => { throw Error('QuotaExceededError'); }, updateQueueUI() {} });
    assert.equal(await c.send({ serial_number: 'TEST', station: 'MAIN' }), 'ERROR');
});
test('local storage failure + failed network cannot report Queued', async () => {
    const c = load(['send'], { navigator: { onLine: true }, queueScan: async () => { throw Error('QuotaExceededError'); },
        updateQueueUI() {}, syncScanToSupabase: async () => ({ status: 'RETRYABLE' }) });
    assert.equal(await c.send({ serial_number: 'TEST', station: 'MAIN' }), 'ERROR');
});
test('storage failure still permits a confirmed network save', async () => {
    const c = load(['send'], { navigator: { onLine: true }, queueScan: async () => { throw Error('QuotaExceededError'); },
        updateQueueUI() {}, syncScanToSupabase: async () => ({ status: 'OK' }), dequeueScan: async () => {}, updateLastSyncTime() {} });
    assert.equal(await c.send({ serial_number: 'TEST', station: 'MAIN' }), 'OK');
});
test('queue acknowledgment waits for transaction commit and rejects abort', async () => {
    let tx;
    const c = load(['queueScan'], { QUEUE_STORE_NAME: 'pendingScans', queueDb: { transaction() {
        tx = { objectStore() { return { put() { const req = {}; queueMicrotask(() => { req.onsuccess?.(); queueMicrotask(() => { tx.error = Error('abort after request'); tx.onabort?.(); }); }); return req; } }; } }; return tx;
    } } });
    await assert.rejects(c.queueScan({}, 'key'), /abort/);
});
test('config timeout must not apply a late partial configuration', async () => {
    const c = load(['withTimeout', 'fetchConfig'], { AbortController, CONFIG_FETCH_TIMEOUT_MS: 5,
        OPERATORS_LIST: ['cached'], STATIONS_LIST: ['MAIN'], PART_NUMBER_MAP: { cached: 'part' }, saveConfigCache() {},
        supabaseClient: { from(table) { const q = { select() { return q; }, eq() { return q; }, order() { return q; }, abortSignal() { return q; },
            then(resolve) { return new Promise(r => setTimeout(() => r({ data: table === 'part_map' ? [{ barcode_prefix: 'new', part_number: 'new' }] : [{ name: 'new' }], error: null }), 15)).then(resolve); } }; return q; } } });
    assert.equal(await c.fetchConfig(), false);
    await new Promise(r => setTimeout(r, 60));
    assert.equal(c.OPERATORS_LIST[0], 'cached');
    assert.equal(c.STATIONS_LIST[0], 'MAIN');
});
