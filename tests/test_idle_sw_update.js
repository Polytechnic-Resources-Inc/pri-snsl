// Idle-only service worker reload helpers from app.js.
// Run: node tests/test_idle_sw_update.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadHelpers() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const start = src.indexOf('function scannerIsIdleForUpdate');
    const end = src.indexOf('function showUpdateNotification');
    if (start < 0 || end < 0 || end <= start) throw new Error('Could not slice idle SW helpers from app.js');
    const context = { console };
    vm.runInNewContext(src.slice(start, end), context);
    return context;
}

const tests = [];
function test(desc, fn) { tests.push({ desc, fn }); }

test('idle when pending is 0, scan box empty, not processing', () => {
    const h = loadHelpers();
    if (!h.scannerIsIdleForUpdate({ pendingCount: 0, scanValue: '', isProcessing: false, isFlushingQueue: false })) {
        throw new Error('expected idle');
    }
});

test('not idle while a scan is processing', () => {
    const h = loadHelpers();
    if (h.scannerIsIdleForUpdate({ pendingCount: 0, scanValue: '', isProcessing: true, isFlushingQueue: false })) {
        throw new Error('processing should block reload');
    }
});

test('not idle while scans are pending', () => {
    const h = loadHelpers();
    if (h.scannerIsIdleForUpdate({ pendingCount: 1, scanValue: '', isProcessing: false, isFlushingQueue: false })) {
        throw new Error('pending scans should block reload');
    }
});

test('not idle while scan box has a barcode', () => {
    const h = loadHelpers();
    if (h.scannerIsIdleForUpdate({ pendingCount: 0, scanValue: '+B446757WM1', isProcessing: false, isFlushingQueue: false })) {
        throw new Error('scan box content should block reload');
    }
});

test('not idle while queue is flushing', () => {
    const h = loadHelpers();
    if (h.scannerIsIdleForUpdate({ pendingCount: 0, scanValue: '', isProcessing: false, isFlushingQueue: true })) {
        throw new Error('flush should block reload');
    }
});

test('reload runs only when idle; otherwise caller should retry', () => {
    const h = loadHelpers();
    let reloads = 0;
    const reload = () => { reloads++; };
    if (h.applyServiceWorkerUpdateWhenIdle({ pendingCount: 1, scanValue: '', isProcessing: false, isFlushingQueue: false }, reload)) {
        throw new Error('should not reload while pending');
    }
    if (reloads !== 0) throw new Error('reload called while busy');
    if (!h.applyServiceWorkerUpdateWhenIdle({ pendingCount: 0, scanValue: '  ', isProcessing: false, isFlushingQueue: false }, reload)) {
        throw new Error('should reload when idle');
    }
    if (reloads !== 1) throw new Error('expected one reload');
});

let passed = 0;
let failed = 0;
for (const t of tests) {
    try {
        t.fn();
        passed++;
        console.log('PASS', t.desc);
    } catch (e) {
        failed++;
        console.log('FAIL', t.desc, e.message);
    }
}
console.log(`RESULT ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
