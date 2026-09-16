const { test, expect } = require('@playwright/test');
const XLSX = require('../assets/xlsx.full.min.js');
async function dashboard(page) {
    await page.addInitScript(() => sessionStorage.setItem('dashboardUnlocked', 'true'));
    await page.goto('/dashboard.html');
}
async function fullCount(page, count) {
    await expect.poll(async () => Number((await page.locator('#totalCount').textContent()).replace(/,/g, ''))).toBe(count);
}
test.beforeEach(async ({ request }) => { await request.post('/__test/reset', { data: {} }); });
test('dated and All Time results include every page; old serial remains searchable; export is complete', async ({ page, request }) => {
    await request.post('/__test/reset', { data: { count: 6005 } });
    await dashboard(page); await fullCount(page, 6005);
    await page.getByRole('button', { name: 'All Time', exact: true }).click();
    await fullCount(page, 6005);
    await page.locator('#searchSerial').fill('FIXTURE006004');
    await expect(page.locator('#filteredCount')).toHaveText('1');
    await expect(page.locator('#tableBody')).toContainText('FIXTURE006004');
    await page.locator('#searchSerial').fill('');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export XLSX/ }).click();
    const download = await downloaded;
    const stream = await download.createReadStream(); const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const workbook = XLSX.read(Buffer.concat(chunks), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Scans);
    expect(rows).toHaveLength(6005);
    expect(rows.some(row => row['Serial Number'] === 'FIXTURE006004')).toBe(true);
});
test('historical cards describe selected period, not false no-scans-today', async ({ page }) => {
    await dashboard(page); await fullCount(page, 12);
    await expect(page.locator('#operatorCards')).toContainText('Usual:');
    await page.getByRole('button', { name: 'Yesterday', exact: true }).click();
    await fullCount(page, 0);
    await expect(page.locator('#operatorCardsContainer')).not.toContainText('No scans yet today');
    await expect(page.locator('.operator-cards-header')).not.toContainText('(Today)');
    await expect(page.locator('#btnNext')).toBeDisabled();
    await expect(page.locator('#btnLast')).toBeDisabled();
});
test('two successive deletes both work without reload', async ({ page, request }) => {
    await dashboard(page); await fullCount(page, 12);
    for (const expected of [11, 10]) {
        await page.locator('.action-btn.delete').first().click();
        await expect(page.locator('#confirmDeleteBtn')).toBeEnabled();
        await page.locator('#confirmDeleteBtn').click();
        await expect(page.locator('#deleteModal')).not.toBeVisible();
        await fullCount(page, expected);
    }
    expect((await (await request.get('/__test/state')).json()).records).toHaveLength(10);
});
test('untrusted comments and serials stay text in table, cards, delete and My Scans', async ({ page, request }) => {
    const payload = '<img src=x onerror="window.__injected=true">';
    const created = new Date().toISOString();
    await request.post('/__test/reset', { data: { rows: [{ id: 1, created_at: created, serial_number: payload,
        part_id: payload, batch_comment: payload, dashboard_notes: payload, operator_name: 'Operator A', station_id: 'MAIN' }] } });
    await dashboard(page); await fullCount(page, 1);
    await expect(page.locator('#tableBody')).toContainText(payload);
    expect(await page.locator('#tableBody img, #operatorCards img').count()).toBe(0);
    await page.locator('.action-btn.delete').click();
    expect(await page.locator('#deleteInfo img').count()).toBe(0);
    expect(await page.evaluate(() => window.__injected || false)).toBe(false);
    await page.goto('/my-scans.html');
    await page.selectOption('#operatorSelect', 'Operator A');
    await expect(page.locator('#scansList')).toContainText(payload);
    expect(await page.locator('#scansList img').count()).toBe(0);
    expect(await page.evaluate(() => window.__injected || false)).toBe(false);
});
test('empty-day Add Record still offers active operators and stations', async ({ page, request }) => {
    await request.post('/__test/reset', { data: { count: 0 } });
    await dashboard(page); await fullCount(page, 0);
    await page.getByRole('button', { name: /Add Record/ }).click();
    await expect(page.locator('#editOperator option')).toHaveCount(3);
    await expect(page.locator('#editStation option')).toHaveCount(3);
    await page.locator('#editSerial').fill('LOCAL-MANUAL-TEST');
    await page.locator('#editPart').fill('100760E');
    await page.selectOption('#editOperator', 'Operator A');
    await page.selectOption('#editStation', 'MAIN');
    await page.locator('#saveRecordBtn').click();
    await expect(page.locator('#recordModal')).not.toBeVisible();
    await fullCount(page, 1);
});
test('My Scans labels its 1000-row window honestly', async ({ page, request }) => {
    await request.post('/__test/reset', { data: { count: 1100 } });
    await page.goto('/my-scans.html');
    await page.selectOption('#operatorSelect', 'Operator A');
    await expect(page.locator('#todayCount')).toHaveText('1000');
    await expect(page.getByRole('button', { name: 'Recent scans', exact: true })).toBeVisible();
    await expect(page.locator('body')).toContainText(/1,?000/);
    await expect(page.locator('body')).toContainText(/latest|recent|limited/i);
});
test('failed refresh cannot export previous results as current data', async ({ page, request }) => {
    await dashboard(page); await fullCount(page, 12);
    await request.post('/__test/control', { data: { outage: true } });
    await page.getByRole('button', { name: /Apply/ }).click();
    await expect(page.getByRole('button', { name: /Export XLSX/ })).toBeDisabled();
    await expect(page.locator('#tableBody')).toContainText(/Error|Unable|Could not|failed/i);
    const dialogs = []; page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });
    await page.evaluate(() => exportXLSX());
    expect(dialogs.join(' ')).toMatch(/load|complete|export|data/i);
});
