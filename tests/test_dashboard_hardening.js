const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const root = path.join(__dirname, '..');
const hostile = `\"'><img src=x onerror=alert(1)>&`;
function harness(file = 'dashboard.html', responder = () => ({ data: [], error: null })) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const elements = new Map();
    function element(id) {
        if (!elements.has(id)) elements.set(id, { value: '', textContent: '', innerHTML: '', style: {}, disabled: false,
            classList: { add() {}, remove() {}, toggle() {} }, listeners: {},
            addEventListener(k, fn) { this.listeners[k] = fn; }, querySelectorAll() { return []; },
            appendChild() {}, scrollIntoView() {} });
        return elements.get(id);
    }
    const calls = [];
    const client = { from(table) {
        const call = { table, orders: [], filters: [] }; calls.push(call);
        const q = { select(cols) { call.select = cols; return q; }, order(k, opts) { call.orders.push([k, opts]); return q; },
            range(a, b) { call.range = [a, b]; return q; }, limit(n) { call.limit = n; return q; },
            eq(k,v) { call.filters.push([k,v]); return q; }, gte(k,v) { call.filters.push([k,v]); return q; },
            lt(k,v) { call.filters.push([k,v]); return q; }, delete() { return q; },
            then(resolve, reject) { return Promise.resolve(responder(call)).then(resolve, reject); } };
        return q;
    } };
    const context = vm.createContext({ console: { log() {}, error() {}, warn() {} },
        supabase: { createClient: () => client }, alert() {}, setInterval() {}, clearInterval() {},
        localStorage: { getItem() {}, setItem() {} }, sessionStorage: { getItem() {} },
        document: { getElementById: element, querySelectorAll: () => [], querySelector: () => element('query'),
            addEventListener() {}, createElement() { const e = element('created'); Object.defineProperty(e, 'innerHTML', { configurable: true, get() { return e.textContent.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); } }); return e; } } });
    const script = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1].split('        // Initialize')[0];
    vm.runInContext(script, context);
    return { source, element, calls, run: code => vm.runInContext(code, context), context };
}
function rows(n) { return Array.from({ length: n }, (_, i) => ({ id: i + 1, created_at: '2026-09-14T12:00:00Z', serial_number: `S${i}`, operator_name: 'A' })); }
test('quote-safe HTML escaping on both pages', () => {
    for (const file of ['dashboard.html', 'my-scans.html']) {
        const h = harness(file); h.context.payload = hostile;
        assert.equal(h.run('escapeHtml(payload)'), '&quot;&#39;&gt;&lt;img src=x onerror=alert(1)&gt;&amp;');
    }
});
test('complete paged range beyond 5000 and all-time beyond 1000, deterministic ordering', async () => {
    for (const dated of [false, true]) {
        const data = rows(6001);
        const h = harness('dashboard.html', c => ({ data: data.slice(c.range[0], c.range[1] + 1) }));
        if (dated) h.element('filterDateFrom').value = '2026-09-14';
        await h.run('fetchScans()');
        assert.equal(h.run('allScans.length'), 6001);
        assert.deepEqual(h.calls[0].orders.map(o => o[0]), ['created_at', 'id']);
        h.element('searchSerial').value = 'S6000'; h.run('applyFilters()');
        assert.equal(h.run('filteredScans.length'), 1);
        assert.match(h.element('footerInfo').textContent, /complete/i);
    }
});
test('loading, errors, date edits invalidate exports and stale requests cannot win', async () => {
    let release; let count = 0;
    const h = harness('dashboard.html', () => ++count === 1 ? new Promise(r => release = r) : { data: rows(1) });
    h.run('allScans = filteredScans = [{id: 9}];');
    const old = h.run('fetchScans()'); await Promise.resolve(); await Promise.resolve();
    assert.equal(h.run('filteredScans.length'), 0);
    assert.match(h.element('footerInfo').textContent, /loading/i);
    await h.run('fetchScans()'); release({ data: rows(2) }); await old;
    assert.equal(h.run('allScans.length'), 1);
    h.element('filterDateFrom').value = '2026-01-01';
    assert.equal(h.run('canExport()'), false);
    h.element('filterDateFrom').listeners.input();
    assert.equal(h.run('filteredScans.length'), 0);
    assert.equal(typeof h.element('filterDateFrom').listeners.change, 'function');
    const e = harness('dashboard.html', () => ({ error: new Error('fixture') }));
    e.run('allScans = filteredScans = [{id: 8}];'); await e.run('fetchScans()');
    assert.equal(e.run('filteredScans.length'), 0);
    e.run('applyFilters()'); assert.match(e.element('footerInfo').textContent, /error|failed/i);
    assert.equal(e.element('exportXlsxBtn').disabled, true);
    assert.match(e.element('tableBody').innerHTML, /Error|Unable|Could not|failed/i);
});
test('cards use selected range; all render surfaces escape hostile fields and IDs', () => {
    const h = harness(); h.context.payload = hostile;
    h.run(`allScans = filteredScans = [{id: '1);alert(1)', created_at: payload, serial_number: payload, part_id: payload, operator_name: payload, station_id: payload, batch_comment: payload, dashboard_notes: payload}]; renderTable(); updateOperatorCards(); populateFilters();`);
    for (const id of ['tableBody', 'operatorCards', 'operatorDropdown', 'stationDropdown', 'partDropdown']) {
        assert.ok(!h.element(id).innerHTML.includes('<img'), id);
        assert.ok(!h.element(id).innerHTML.includes('1);alert(1)'), id);
    }
    assert.match(h.element('operatorCards').innerHTML, /Scans:/);
    assert.match(h.element('operatorCards').innerHTML, /Usual:/);
    assert.ok(!h.element('operatorCards').innerHTML.includes('class="serial"'));
    h.run('allScans[0].id = 1; openDeleteModal(1)');
    assert.ok(!h.element('deleteInfo').innerHTML.includes('<img'));
});
test('refresh preserves sort and empty pagination remains page one', () => {
    const h = harness();
    h.run(`allScans = [{serial_number:'Z'}, {serial_number:'A'}]; currentSort = {column:'serial_number',direction:'asc'}; applyFilters()`);
    assert.equal(h.run('filteredScans[0].serial_number'), 'A');
    h.run('allScans = []; applyFilters(); changePage("last")');
    assert.equal(h.run('currentPage'), 1); assert.equal(h.run('totalPages'), 1);
    assert.equal(h.element('btnNext').disabled, true);
});
test('delete resets button after success and on reopen', async () => {
    const h = harness(); h.element('deleteRecordId').value = '1';
    await h.run('confirmDelete()'); assert.equal(h.element('confirmDeleteBtn').disabled, false);
    h.element('confirmDeleteBtn').disabled = true;
    h.run('allScans = [{id:1}]; openDeleteModal(1)'); assert.equal(h.element('confirmDeleteBtn').disabled, false);
});
test('empty-day Add uses active configuration and escaped options', async () => {
    const h = harness('dashboard.html', () => ({ data: [{name: hostile}] }));
    await h.run('populateModalDropdowns()');
    assert.deepEqual(h.calls.map(c => c.table), ['operators', 'stations']);
    assert.ok(h.calls.every(c => c.filters.some(([k,v]) => k === 'active' && v === true)));
    for (const id of ['editOperator', 'editStation']) assert.match(h.element(id).innerHTML, /&quot;/);
});
test('My Scans renders safely and discloses latest-1000 scope for every preset', () => {
    const h = harness('my-scans.html'); h.context.payload = hostile;
    h.run(`allScans = [{created_at: new Date().toISOString(), serial_number:payload, part_id:payload}]; currentDateRange='all'; updateDisplay()`);
    assert.ok(!h.element('scansList').innerHTML.includes('<img'));
    assert.match(h.element('dateRangeLabel').textContent, /Recent scans/);
    assert.match(h.source, /latest 1,000 window/);
    assert.ok(!h.source.includes('>All Time<'));
});
test('both pages use vendored Supabase, Today remains dashboard default', () => {
    for (const file of ['dashboard.html','my-scans.html']) {
        const h = harness(file); assert.ok(h.source.includes('src="vendor/supabase.min.js"'));
        assert.ok(!h.source.includes('https://unpkg.com/@supabase'));
    }
    assert.match(harness().source, /initDashboardDates[\s\S]*easternYmdToday/);
});
test('last 5 weekdays skip weekends and usual divides by 5 including quiet days', () => {
    const h = harness();
    assert.equal(h.run('JSON.stringify(previousWeekdayYmds("2026-09-15", 5))'), JSON.stringify(['2026-09-14', '2026-09-11', '2026-09-10', '2026-09-09', '2026-09-08']));
    assert.equal(h.run('JSON.stringify(previousWeekdayYmds("2026-09-14", 5))'), JSON.stringify(['2026-09-11', '2026-09-10', '2026-09-09', '2026-09-08', '2026-09-07']));
    const usual = JSON.parse(h.run(`JSON.stringify(computeUsualByOperator([
        { operator_name: 'A', created_at: '2026-09-14T16:00:00.000Z' },
        { operator_name: 'A', created_at: '2026-09-14T17:00:00.000Z' },
        { operator_name: 'A', created_at: '2026-09-14T18:00:00.000Z' },
        { operator_name: 'A', created_at: '2026-09-14T19:00:00.000Z' },
        { operator_name: 'A', created_at: '2026-09-14T20:00:00.000Z' },
        { operator_name: 'A', created_at: '2026-09-13T16:00:00.000Z' },
        { operator_name: 'B', created_at: '2026-09-11T16:00:00.000Z' }
    ], ['2026-09-14', '2026-09-11', '2026-09-10', '2026-09-09', '2026-09-08']))`));
    assert.equal(usual.A, 1);
    assert.equal(usual.B, 0.2);
    assert.equal(usual.C, undefined);
});
test('usual query is a bounded weekday window and does not replace loaded scans', async () => {
    const h = harness('dashboard.html', c => {
        if (String(c.select || '').includes('operator_name')) {
            return { data: [{ operator_name: 'A', created_at: '2026-09-14T16:00:00.000Z' }] };
        }
        return { data: rows(3) };
    });
    h.element('filterDateFrom').value = '2026-09-15';
    h.element('filterDateTo').value = '2026-09-15';
    await h.run('fetchScans()');
    assert.equal(h.run('allScans.length'), 3);
    const usualCalls = h.calls.filter(c => c.table === 'scans' && String(c.select || '').includes('operator_name'));
    assert.ok(usualCalls.length >= 1);
    assert.ok(usualCalls.every(c => (c.select || '').includes('created_at')));
    assert.match(h.element('operatorCards').innerHTML, /Usual:/);
});
test('failed usual fetch still shows scan cards', async () => {
    const h = harness('dashboard.html', c => {
        if (String(c.select || '').includes('operator_name')) return { error: new Error('usual fixture') };
        return { data: [{ id: 1, created_at: '2026-09-15T16:00:00.000Z', serial_number: 'S1', operator_name: 'A' }] };
    });
    await h.run('fetchScans()');
    assert.equal(h.run('allScans.length'), 1);
    assert.match(h.element('operatorCards').innerHTML, /Scans:/);
    assert.match(h.element('operatorCards').innerHTML, /Usual:/);
});
