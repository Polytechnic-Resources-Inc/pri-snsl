// LOCAL TEST DOUBLE ONLY. Synthetic records; no proxy, credentials or production network.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 4173);
const origin = `http://127.0.0.1:${port}`;
let records, controls, requests;
const operators = [{ id: 1, name: 'Operator A', active: true }, { id: 2, name: 'Operator B', active: true }];
const stations = [{ name: 'MAIN', active: true }, { name: 'OP1', active: true }];
function reset(options = {}) {
    controls = { outage: false, configDelayMs: 0, failLookup: false, ...options };
    requests = [];
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const noon = Date.parse(`${day}T12:00:00-04:00`);
    records = Array.from({ length: options.count ?? 12 }, (_, i) => ({
        id: i + 1, created_at: new Date(noon - i * 1000).toISOString(),
        part_id: '100760E', serial_number: `FIXTURE${String(i).padStart(6, '0')}`,
        operator_name: 'Operator A', station_id: 'MAIN', batch_comment: '', dashboard_notes: '',
        raw_scan: 'LOCAL-FIXTURE', idempotency_key: `seed-${i}`
    }));
    if (options.rows) records = options.rows;
}
reset();
function json(res, status, data, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(data));
}
async function body(req) {
    let text = '';
    for await (const chunk of req) { text += chunk; if (text.length > 2e6) throw Error('body too large'); }
    return text ? JSON.parse(text) : {};
}
function matching(row, params) {
    for (const [key, value] of params) {
        if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
        const [op, ...rest] = value.split('.'); const operand = rest.join('.');
        const actual = String(row[key] ?? '');
        if (op === 'eq' && actual !== operand) return false;
        if (op === 'gte' && actual < operand) return false;
        if (op === 'lt' && actual >= operand) return false;
        if (op === 'lte' && actual > operand) return false;
        if (op === 'ilike' && !actual.toLowerCase().includes(operand.replace(/[%*]/g, '').toLowerCase())) return false;
        if (op === 'in' && !operand.slice(1, -1).split(',').map(v => v.replace(/^"|"$/g, '')).includes(actual)) return false;
    }
    return true;
}
const allowed = new Set(['index.html', 'app.js', 'scan-cache.js', 'supabase-health.js', 'service-worker.js', 'manifest.json',
    'dashboard.html', 'my-scans.html', 'favicon.ico', 'icon-192.png', 'icon-512.png', 'vendor/supabase.min.js', 'tests/assets/xlsx.full.min.js']);
const server = http.createServer(async (req, res) => {
    try {
        if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return json(res, 403, { error: 'Local preview only' });
        if (req.headers.origin && ![origin, `http://localhost:${port}`].includes(req.headers.origin)) return json(res, 403, { error: 'Cross-origin writes refused' });
        const url = new URL(req.url, origin);
        if (url.pathname === '/__test/reset' && req.method === 'POST') { reset(await body(req)); return json(res, 200, { ok: true }); }
        if (url.pathname === '/__test/control' && req.method === 'POST') { Object.assign(controls, await body(req)); return json(res, 200, { ok: true }); }
        if (url.pathname === '/__test/state') return json(res, 200, { records, requests, controls });
        if (url.pathname.startsWith('/rest/v1/')) {
            const table = url.pathname.split('/').pop();
            requests.push({ method: req.method, table, query: url.search });
            if (controls.outage) return json(res, 503, { code: 'TEST_OUTAGE', message: 'Local test outage' });
            if (table !== 'scans' && controls.configDelayMs) await new Promise(r => setTimeout(r, controls.configDelayMs));
            if (req.method === 'GET' || req.method === 'HEAD') {
                if (table === 'scans' && controls.failLookup && url.searchParams.get('select') === 'idempotency_key') return json(res, 503, { message: 'Local lookup failure' });
                let rows = table === 'scans' ? records : table === 'operators' ? operators : table === 'stations' ? stations : table === 'part_map' ? [{ barcode_prefix: '08717640000000', part_number: '100760E', active: true }] : [];
                rows = rows.filter(row => matching(row, url.searchParams));
                const order = (url.searchParams.get('order') || '').split(',');
                rows = [...rows].sort((a, b) => { for (const spec of order) { const [key, direction] = spec.split('.'); if (a[key] < b[key]) return direction === 'desc' ? 1 : -1; if (a[key] > b[key]) return direction === 'desc' ? -1 : 1; } return 0; });
                const total = rows.length;
                const start = Number(url.searchParams.get('offset') || (req.headers.range || '').split('-')[0] || 0);
                const limit = Math.min(1000, Number(url.searchParams.get('limit') || 1000));
                rows = rows.slice(start, start + limit);
                const select = url.searchParams.get('select');
                if (select && select !== '*') rows = rows.map(row => Object.fromEntries(select.split(',').map(key => [key, row[key]])));
                return json(res, 200, req.method === 'HEAD' ? null : rows, { 'Content-Range': `${start}-${Math.max(start, start + rows.length - 1)}/${total}` });
            }
            if (table !== 'scans') return json(res, 403, { message: 'Read only fixture table' });
            if (req.method === 'POST') {
                const input = await body(req); const row = Array.isArray(input) ? input[0] : input;
                if (!operators.some(op => op.name === row.operator_name) || !stations.some(st => st.name === row.station_id)) return json(res, 409, { code: '23503', message: 'Invalid fixture operator/station' });
                if (records.some(existing => (row.idempotency_key && existing.idempotency_key === row.idempotency_key) || (existing.part_id === row.part_id && existing.serial_number === row.serial_number))) return json(res, 409, { code: '23505', message: 'Unique constraint conflict' });
                const saved = { ...row, id: Math.max(0, ...records.map(r => r.id)) + 1, created_at: row.created_at || new Date().toISOString() };
                records.push(saved);
                if (controls.dropInsertResponse) { req.socket.destroy(); return; }
                return json(res, 201, [saved]);
            }
            if (req.method === 'DELETE') { records = records.filter(row => !matching(row, url.searchParams)); return json(res, 200, []); }
            if (req.method === 'PATCH') { const input = await body(req); records.filter(row => matching(row, url.searchParams)).forEach(row => Object.assign(row, input)); return json(res, 200, []); }
        }
        const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
        if (!allowed.has(relative)) return json(res, 404, { error: 'Not a preview asset' });
        let data = fs.readFileSync(path.join(root, relative));
        const ext = path.extname(relative);
        if (['.html', '.js'].includes(ext)) {
            data = data.toString().replace(/const SUPABASE_URL = '[^']+';/g, `const SUPABASE_URL = '${origin}';`)
                .replace(/const SUPABASE_ANON_KEY = '[^']+';/g, "const SUPABASE_ANON_KEY = 'local-synthetic-key';")
                .replace(/<link[^>]+https:\/\/fonts\.[^>]+>/g, '')
                .replace('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', '/tests/assets/xlsx.full.min.js');
        }
        const type = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' }[ext];
        res.writeHead(200, { 'Content-Type': type || 'application/octet-stream', 'Cache-Control': 'no-store',
            'Content-Security-Policy': "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'" });
        res.end(data);
    } catch (error) { if (!res.headersSent) json(res, 500, { error: error.message }); else res.end(); }
});
server.listen(port, '127.0.0.1', () => console.log(`LOCAL SYNTHETIC PREVIEW ${origin} — production requests impossible through this server`));
