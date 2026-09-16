const { test, expect } = require('@playwright/test');
const BARCODE = '+B446100760E1/$+760E132864';
async function setup(page) {
    await page.goto('/');
    await expect(page.locator('#operator option')).toHaveCount(3);
    await page.selectOption('#operator', 'Operator A');
    await page.selectOption('#station', 'MAIN');
    await page.evaluate(() => forceHealthCheck());
    await expect(page.locator('#scan')).toBeEnabled();
}
async function scan(page, raw = BARCODE) {
    await page.locator('#scan').fill(raw);
    await page.locator('#scan').press('Enter');
}
test.beforeEach(async ({ request }) => { await request.post('/__test/reset', { data: {} }); });
test('selection guard: no name/station means not Ready, no insert or queue', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.locator('#operator option')).toHaveCount(3);
    await expect(page.locator('#scan')).toBeDisabled();
    await expect(page.locator('#scan')).not.toHaveAttribute('placeholder', '✅ Ready to scan');
    await page.evaluate(raw => { const el = document.querySelector('#scan'); el.value = raw; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); }, BARCODE);
    expect((await (await request.get('/__test/state')).json()).requests.filter(r => r.method === 'POST')).toHaveLength(0);
    expect(await page.evaluate(() => getPendingCount())).toBe(0);
});
test('normal scan then genuine repeat stays duplicate; history says Saved', async ({ page, request }) => {
    await setup(page); await scan(page);
    await expect(page.locator('#status')).toContainText('SAVED');
    await expect(page.locator('#lastScanStatus')).toHaveText('Saved');
    await expect(page.locator('.history-status').first()).toHaveText('Saved');
    await page.waitForTimeout(5100);
    await scan(page); await expect(page.locator('#status')).toContainText('DUPLICATE');
    expect((await (await request.get('/__test/state')).json()).records.filter(r => r.serial_number === '760E13286')).toHaveLength(1);
});
test('same-key retry remains Saved even for old database record', async ({ page, request }) => {
    await setup(page);
    const data = { operator: 'Operator A', station: 'MAIN', raw_scan: BARCODE, part_number: '100760E', serial_number: 'RETRY-LOCAL' };
    expect(await page.evaluate(payload => send(payload, 'same-key'), data)).toBe('OK');
    await request.patch('/rest/v1/scans?idempotency_key=eq.same-key', { data: { created_at: '2000-01-01T12:00:00Z' } });
    expect(await page.evaluate(payload => send(payload, 'same-key'), data)).toBe('OK');
    expect(await page.evaluate(payload => send(payload, 'different-key'), data)).toBe('DUPLICATE');
});
test('offline queue survives reload then reconciles visible status after sync', async ({ page, context, request }) => {
    await setup(page);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await context.setOffline(true); await scan(page);
    await expect(page.locator('#status')).toContainText('QUEUED');
    expect(await page.evaluate(() => getPendingCount())).toBe(1);
    await page.reload();
    await expect(page.locator('#scan')).toBeEnabled();
    await expect(page.locator('#lastScanStatus')).toHaveText('Queued');
    expect(await page.evaluate(() => getPendingCount())).toBe(1);
    await context.setOffline(false);
    await page.evaluate(async () => { await forceHealthCheck(); await flushQueue(); });
    await expect(page.locator('#lastScanStatus')).toHaveText('Saved');
    await expect(page.locator('.history-status').first()).toHaveText('Saved');
    expect(await page.evaluate(() => getPendingCount())).toBe(0);
    expect((await (await request.get('/__test/state')).json()).records.filter(r => r.serial_number === '760E13286')).toHaveLength(1);
});
test('storage failure and offline visibly report Not saved, never Queued', async ({ page, context }) => {
    await setup(page);
    await page.evaluate(() => { queueScan = async () => { throw Error('QuotaExceededError'); }; });
    await context.setOffline(true); await scan(page);
    await expect(page.locator('#status')).toContainText('NOT SAVED');
    await expect(page.locator('#lastScanStatus')).toHaveText('Not saved');
    expect(await page.evaluate(() => getPendingCount())).toBe(0);
});
test('uncached configuration timeout recovers without reload', async ({ page, request }) => {
    await request.post('/__test/control', { data: { configDelayMs: 10000 } });
    await page.goto('/');
    await expect(page.locator('#scan')).toBeDisabled();
    await page.waitForTimeout(8500);
    await request.post('/__test/control', { data: { configDelayMs: 0 } });
    await expect(page.locator('#operator option')).toHaveCount(3, { timeout: 25000 });
    await page.selectOption('#operator', 'Operator A');
    await page.selectOption('#station', 'MAIN');
    await expect(page.locator('#scan')).toBeEnabled();
});
test('ambiguous unique lookup failure retains pending scan for retry', async ({ page, request }) => {
    await setup(page);
    const payload = { operator: 'Operator A', station: 'MAIN', raw_scan: BARCODE, part_number: '100760E', serial_number: 'CONFLICT-LOCAL' };
    expect(await page.evaluate(p => send(p, 'initial-key'), payload)).toBe('OK');
    await request.post('/__test/control', { data: { failLookup: true } });
    expect(await page.evaluate(p => send(p, 'next-key'), payload)).toBe('QUEUED');
    expect(await page.evaluate(() => getPendingCount())).toBe(1);
});
test('page never attempts production API requests and has no startup JS exceptions', async ({ page }) => {
    const external = [], errors = [];
    page.on('request', req => { if (/supabase\.co/.test(req.url())) external.push(req.url()); });
    page.on('pageerror', error => errors.push(error.message));
    await setup(page); await scan(page); await expect(page.locator('#status')).toContainText('SAVED');
    expect(external).toEqual([]); expect(errors).toEqual([]);
});
