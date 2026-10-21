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
    // Hang only the first table-range query; the parallel activity query answers immediately.
    const h = harness('dashboard.html', c => c.select !== '*' ? { data: [] } : ++count === 1 ? new Promise(r => release = r) : { data: rows(1) });
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
test('cards come from the activity summary; all render surfaces escape hostile fields and IDs', () => {
    const h = harness(); h.context.payload = hostile;
    h.run(`allScans = filteredScans = [{id: '1);alert(1)', created_at: payload, serial_number: payload, part_id: payload, operator_name: payload, station_id: payload, batch_comment: payload, dashboard_notes: payload}]; renderTable(); populateFilters();`);
    h.run(`activityStatus = 'ready'; activitySummary = computeOperatorActivity([{ operator_name: payload, created_at: '2026-09-15T16:00:00.000Z' }], '2026-09-15'); updateOperatorCards();`);
    for (const id of ['tableBody', 'operatorCards', 'operatorDropdown', 'stationDropdown', 'partDropdown']) {
        assert.ok(!h.element(id).innerHTML.includes('<img'), id);
        assert.ok(!h.element(id).innerHTML.includes('1);alert(1)'), id);
    }
    assert.match(h.element('operatorCards').innerHTML, /&lt;img/);
    assert.match(h.element('operatorCards').innerHTML, /Today:/);
    assert.ok(!h.element('operatorCards').innerHTML.includes('Scans:'));
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
const ACTIVITY_SELECT = 'operator_name,created_at';
const isActivity = c => c.table === 'scans' && c.select === ACTIVITY_SELECT;
function filterValue(call, key, index) { return call.filters.filter(([k]) => k === key)[index ?? 0]?.[1]; }
test('activity query selects only operator and time, pages, and does not replace loaded scans', async () => {
    const h = harness('dashboard.html', c => isActivity(c)
        ? { data: [{ operator_name: 'A', created_at: '2026-09-14T16:00:00.000Z' }] }
        : { data: rows(3) });
    h.run('easternYmdToday = () => "2026-09-15"');
    h.element('filterDateFrom').value = '2026-09-15';
    h.element('filterDateTo').value = '2026-09-15';
    await h.run('fetchScans()');
    assert.equal(h.run('allScans.length'), 3);
    const activityCalls = h.calls.filter(isActivity);
    assert.equal(activityCalls.length, 1);
    assert.deepEqual(activityCalls[0].orders.map(o => o[0]), ['created_at', 'id']);
    assert.deepEqual(activityCalls[0].range, [0, 999]);
    assert.ok(h.calls.filter(c => c.table === 'scans').every(c => c.select === '*' || c.select === ACTIVITY_SELECT));
    assert.match(h.element('operatorCards').innerHTML, /Usual:/);
    assert.match(h.element('operatorCards').innerHTML, /Today:/);
});
test('30-day window: Eastern-midnight cutoff 29 days before today, inclusive, DST-correct', () => {
    const h = harness();
    // EDT cutoff (2026-10-22 00:00 ET = 04:00Z); today in EST.
    assert.equal(h.run('JSON.stringify(activityWindow("2026-11-20"))'),
        JSON.stringify({ cutoffYmd: '2026-10-22', gte: '2026-10-22T04:00:00.000Z', lt: '2026-11-21T05:00:00.000Z' }));
    // EST cutoff (2026-02-19 00:00 ET = 05:00Z); today in EDT.
    assert.equal(h.run('activityWindow("2026-03-20").gte'), '2026-02-19T05:00:00.000Z');
    const summary = JSON.parse(h.run(`JSON.stringify(computeOperatorActivity([
        { operator_name: 'AtCutoff', created_at: '2026-10-22T04:00:00.000Z' },
        { operator_name: 'JustBefore', created_at: '2026-10-22T03:59:59.999Z' },
        { operator_name: 'Old', created_at: '2026-09-01T16:00:00.000Z' },
        { operator_name: 'Recent', created_at: '2026-11-19T16:00:00.000Z' }
    ], '2026-11-20'))`));
    assert.deepEqual(Object.keys(summary.byOperator).sort(), ['AtCutoff', 'Recent']);
    assert.equal(summary.byOperator.AtCutoff.lastScan, Date.parse('2026-10-22T04:00:00.000Z'));
});
test('Today counts use the Eastern day boundary, not UTC', () => {
    const h = harness();
    const s = JSON.parse(h.run(`JSON.stringify(computeOperatorActivity([
        { operator_name: 'A', created_at: '2026-09-15T03:59:59.000Z' },
        { operator_name: 'A', created_at: '2026-09-15T04:00:00.000Z' },
        { operator_name: 'A', created_at: '2026-09-16T03:59:59.000Z' },
        { operator_name: 'B', created_at: '2026-09-14T20:00:00.000Z' },
        { operator_name: 'B', created_at: 'not-a-date' }
    ], '2026-09-15'))`));
    assert.equal(s.byOperator.A.today, 2);
    assert.equal(s.byOperator.B.today, 0);
    assert.equal(s.byOperator.B.lastScan, Date.parse('2026-09-14T20:00:00.000Z'));
});
test('Usual stays the prior five weekdays, excluding today, divided by five', () => {
    const h = harness();
    const s = JSON.parse(h.run(`JSON.stringify(computeOperatorActivity([
        ...Array.from({ length: 9 }, () => ({ operator_name: 'A', created_at: '2026-09-15T16:00:00.000Z' })),
        { operator_name: 'A', created_at: '2026-09-14T16:00:00.000Z' },
        { operator_name: 'A', created_at: '2026-09-11T16:00:00.000Z' },
        { operator_name: 'A', created_at: '2026-09-13T16:00:00.000Z' },
        { operator_name: 'A', created_at: '2026-09-07T16:00:00.000Z' }
    ], '2026-09-15'))`));
    assert.deepEqual(s.usualYmds, ['2026-09-14', '2026-09-11', '2026-09-10', '2026-09-09', '2026-09-08']);
    assert.equal(s.byOperator.A.today, 9);
    assert.equal(s.usual.A, 0.4); // 2 weekday scans / 5; today, Sunday and the 6th weekday back excluded
    h.run(`activityStatus = 'ready'; activitySummary = computeOperatorActivity([{ operator_name: 'A', created_at: '2026-09-15T16:00:00.000Z' }], '2026-09-15'); updateOperatorCards();`);
    const html = h.element('operatorCards').innerHTML;
    assert.match(html, /Usual: <strong>0<\/strong>/);
    assert.match(html, /previous 5 weekdays/i);
    assert.match(html, /not (counting|including) today/i);
    assert.match(h.source, /Recent operator activity — last 30 days/);
});
test('activity summary ignores the table date filters', async () => {
    const h = harness('dashboard.html', c => isActivity(c)
        ? { data: [{ operator_name: 'Current Op', created_at: '2026-09-15T16:00:00.000Z' }] }
        : { data: [] });
    h.run('easternYmdToday = () => "2026-09-15"');
    h.element('filterDateFrom').value = '2025-01-01';
    h.element('filterDateTo').value = '2025-01-02';
    await h.run('fetchScans()');
    const table = h.calls.find(c => c.table === 'scans' && c.select === '*');
    assert.equal(filterValue(table, 'created_at', 0), '2025-01-01T05:00:00.000Z');
    const activity = h.calls.find(isActivity);
    assert.equal(filterValue(activity, 'created_at', 0), '2026-08-17T04:00:00.000Z');
    assert.equal(filterValue(activity, 'created_at', 1), '2026-09-16T04:00:00.000Z');
    assert.match(h.element('operatorCards').innerHTML, /Current Op/);
    assert.match(h.element('operatorCards').innerHTML, /Today: <strong>1<\/strong>/);
    // Editing the table dates does not wipe the cards.
    h.element('filterDateFrom').listeners.input();
    assert.match(h.element('operatorCards').innerHTML, /Current Op/);
});
test('empty, loading and error states are explicit; table and summary fail independently', async () => {
    const empty = harness('dashboard.html', () => ({ data: [] }));
    await empty.run('fetchScans()');
    assert.match(empty.element('operatorCards').innerHTML, /No operator scans in the last 30 days/);
    const loading = harness();
    loading.run(`activityStatus = 'loading'; activitySummary = null; updateOperatorCards();`);
    assert.match(loading.element('operatorCards').innerHTML, /Loading recent operator activity/);
    // Summary fails, table succeeds.
    const summaryDown = harness('dashboard.html', c => isActivity(c)
        ? { error: new Error('summary fixture') }
        : { data: [{ id: 1, created_at: '2026-09-15T16:00:00.000Z', serial_number: 'S1', operator_name: 'A' }] });
    await summaryDown.run('fetchScans()');
    assert.equal(summaryDown.run('allScans.length'), 1);
    assert.equal(summaryDown.run('loadState'), 'complete');
    assert.match(summaryDown.element('tableBody').innerHTML, /S1/);
    const downHtml = summaryDown.element('operatorCards').innerHTML;
    assert.match(downHtml, /unavailable/i);
    assert.ok(!/No operator scans/.test(downHtml));
    assert.ok(!/class="operator-card[ "]/.test(downHtml));
    // Previously loaded cards are not left on screen as if current after a failed refresh.
    summaryDown.run(`activitySummary = computeOperatorActivity([{ operator_name: 'Stale', created_at: new Date().toISOString() }], easternYmdToday()); activityStatus = 'ready';`);
    await summaryDown.run('fetchOperatorActivity()');
    assert.ok(!summaryDown.element('operatorCards').innerHTML.includes('Stale'));
    // Table fails, summary still loads.
    const tableDown = harness('dashboard.html', c => isActivity(c)
        ? { data: [{ operator_name: 'A', created_at: new Date().toISOString() }] }
        : { error: new Error('table fixture') });
    await tableDown.run('fetchScans()');
    assert.equal(tableDown.run('loadState'), 'error');
    assert.match(tableDown.element('operatorCards').innerHTML, /Today: <strong>1<\/strong>/);
});
test('recency shows days for older operators instead of hundreds of hours', () => {
    const h = harness();
    h.run(`activityStatus = 'ready'; activitySummary = { byOperator: { A: { today: 0, lastScan: Date.now() - 3 * 86400000 - 60000 }, B: { today: 1, lastScan: Date.now() - 90 * 60000 } }, usual: {}, usualYmds: [] }; updateOperatorCards();`);
    const html = h.element('operatorCards').innerHTML;
    assert.match(html, /3 days ago/);
    assert.match(html, /1 hr 30 min ago/);
    assert.ok(!/\d{3} hr/.test(html));
});
test('activity summary pages past 1,000 rows and later-page rows count', async () => {
    // 1,500 rows newest-first: page 1 = 1,000 "A" scans today; page 2 = 499 more "A" today + 1 "Later" scan on a prior weekday.
    const today = '2026-09-15';
    const activityRows = [
        ...Array.from({ length: 1499 }, (_, i) => ({ operator_name: 'A', created_at: new Date(Date.parse('2026-09-15T20:00:00Z') - i * 1000).toISOString() })),
        { operator_name: 'Later', created_at: '2026-09-14T16:00:00.000Z' }
    ];
    const h = harness('dashboard.html', c => isActivity(c)
        ? { data: activityRows.slice(c.range[0], c.range[1] + 1) }
        : { data: [] });
    h.run(`easternYmdToday = () => "${today}"`);
    await h.run('fetchScans()');
    assert.deepEqual(h.calls.filter(isActivity).map(c => c.range), [[0, 999], [1000, 1999]]);
    const html = h.element('operatorCards').innerHTML;
    assert.match(html, /Later/);
    assert.match(html, /A<\/div>\s*<div class="operator-card-stats">Today: <strong>1499<\/strong>/);
    assert.match(html, /Later<\/div>\s*<div class="operator-card-stats">Today: <strong>0<\/strong>[\s\S]*?Usual: <strong>0\.2<\/strong>/);
});
test('activity cards load in parallel and do not wait for the full table range', async () => {
    let releaseTable;
    const h = harness('dashboard.html', c => isActivity(c)
        ? { data: [{ operator_name: 'Fast Op', created_at: new Date().toISOString() }] }
        : new Promise(r => { releaseTable = r; }));
    h.element('filterDateFrom').value = '';
    h.element('filterDateTo').value = '';
    const pending = h.run('fetchScans()');
    for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
    assert.equal(h.run('loadState'), 'loading');
    assert.match(h.element('operatorCards').innerHTML, /Fast Op/);
    assert.match(h.element('operatorCards').innerHTML, /Today: <strong>1<\/strong>/);
    releaseTable({ data: rows(2) });
    await pending;
    assert.equal(h.run('loadState'), 'complete');
    assert.equal(h.calls.filter(isActivity).length, 1);
});
test('hidden former operators do not render operator cards', () => {
    const h = harness();
    h.run(`activityStatus = 'ready'; activitySummary = { usual: {}, byOperator: {
        Terekea: { today: 1, lastScan: '2026-09-15T16:00:00.000Z' },
        ' SARAH ': { today: 1, lastScan: '2026-09-15T16:00:00.000Z' },
        Brenda: { today: 1, lastScan: '2026-09-15T16:00:00.000Z' }
    }}; updateOperatorCards()`);
    assert.ok(!h.element('operatorCards').innerHTML.includes('Terekea'));
    assert.ok(!h.element('operatorCards').innerHTML.includes('SARAH'));
    assert.match(h.element('operatorCards').innerHTML, /Brenda/);
});
