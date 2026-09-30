/**
 * Unit tests for dashboard Edit Record modal helpers.
 * Run with: node tests/test_dashboard_edit_modal.js
 *
 * Bug: Edit opens with Operator/Station on "Select …". Save then writes
 * empty strings over the existing operator_name and station_id.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function extractFunction(source, name) {
    const token = `function ${name}`;
    const start = source.indexOf(token);
    assert(start !== -1, `${name} is defined in dashboard.html`);

    const openParen = source.indexOf('(', start);
    const openBrace = source.indexOf('{', source.indexOf(')', openParen));
    let depth = 0;
    for (let i = openBrace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') depth--;
        if (depth === 0) {
            return source.slice(start, i + 1);
        }
    }
    throw new Error(`${name} function body was not closed`);
}

function loadDashboardFns() {
    const dashPath = path.join(__dirname, '..', 'dashboard.html');
    const source = fs.readFileSync(dashPath, 'utf8');
    const script = [
        extractFunction(source, 'findScanById'),
        extractFunction(source, 'namesForEditSelect'),
        extractFunction(source, 'buildScanWritePayload'),
        extractFunction(source, 'mergeScanRecord'),
        'this.findScanById = findScanById;',
        'this.namesForEditSelect = namesForEditSelect;',
        'this.buildScanWritePayload = buildScanWritePayload;',
        'this.mergeScanRecord = mergeScanRecord;'
    ].join('\n');
    const sandbox = {};
    vm.runInNewContext(script, sandbox);
    return { ...sandbox, source };
}

function runTests() {
    const { findScanById, namesForEditSelect, buildScanWritePayload, mergeScanRecord, source } = loadDashboardFns();
    let passed = 0;
    let failed = 0;

    function check(name, fn) {
        try {
            fn();
            console.log(`PASS: ${name}`);
            passed++;
        } catch (error) {
            console.error(`FAIL: ${name}`);
            console.error(`  ${error.message}`);
            failed++;
        }
    }

    console.log('Running dashboard edit modal tests...\n');

    check('findScanById matches number id from string click handler', () => {
        const scans = [{ id: 41261, operator_name: 'Yubery', serial_number: 'PUL9000K33736' }];
        const found = findScanById(scans, '41261');
        assert.strictEqual(found.serial_number, 'PUL9000K33736');
        assert.strictEqual(found.operator_name, 'Yubery');
    });

    check('findScanById matches string id from numeric click handler', () => {
        const scans = [{ id: '41261', operator_name: 'Yubery', station_id: 'MAIN' }];
        const found = findScanById(scans, 41261);
        assert.strictEqual(found.station_id, 'MAIN');
    });

    check('namesForEditSelect keeps current operator even if missing from loaded list', () => {
        const names = namesForEditSelect(['Amanda', 'Debbie M'], 'Yubery');
        assert.ok(names.includes('Yubery'));
        assert.ok(names.includes('Amanda'));
    });

    check('namesForEditSelect does not duplicate current operator', () => {
        const names = namesForEditSelect(['Yubery', 'Amanda'], 'Yubery');
        assert.strictEqual(names.filter(n => n === 'Yubery').length, 1);
    });

    check('edit save with blank operator/station keeps existing values', () => {
        const payload = buildScanWritePayload({
            serial_number: 'PUL9000K33736',
            part_id: 'PUL9000K',
            operator_name: '',
            station_id: '',
            batch_comment: 'TW',
            dashboard_notes: ''
        }, {
            isEdit: true,
            existingScan: { operator_name: 'Yubery', station_id: 'MAIN' }
        });
        assert.strictEqual(payload.operator_name, 'Yubery');
        assert.strictEqual(payload.station_id, 'MAIN');
        assert.strictEqual(payload.batch_comment, 'TW');
    });

    check('add save with blank operator stays blank', () => {
        const payload = buildScanWritePayload({
            serial_number: 'PUL9000K33736',
            part_id: 'PUL9000K',
            operator_name: '',
            station_id: '',
            batch_comment: '',
            dashboard_notes: ''
        }, { isEdit: false });
        assert.strictEqual(payload.operator_name, '');
        assert.strictEqual(payload.station_id, '');
    });

    check('edit save keeps an operator the user actually selected', () => {
        const payload = buildScanWritePayload({
            serial_number: 'PUL9000K33736',
            part_id: 'PUL9000K',
            operator_name: 'Amanda',
            station_id: 'MAIN',
            batch_comment: 'TW',
            dashboard_notes: ''
        }, {
            isEdit: true,
            existingScan: { operator_name: 'Yubery', station_id: 'MAIN' }
        });
        assert.strictEqual(payload.operator_name, 'Amanda');
    });

    check('openEditModal uses findScanById so mixed id types still load the row', () => {
        assert.ok(source.includes('findScanById(allScans, scanId)'));
        assert.ok(source.includes('await populateModalDropdowns'));
    });

    check('saveRecord uses buildScanWritePayload so blank dropdowns cannot wipe operator/station', () => {
        assert.ok(source.includes('buildScanWritePayload('));
        assert.ok(source.includes('existingScan'));
    });

    check('edit modal fills selects with current operator/station in escaped options', () => {
        assert.ok(source.includes('namesForEditSelect('));
        assert.ok(source.includes('fillNamedSelect('));
        assert.ok(source.includes('escapeHtml(name)'));
    });

    check('mergeScanRecord updates the matching scan in place', () => {
        const scans = [{
            id: 41261,
            serial_number: 'PUL9000K33736',
            operator_name: 'Yubery',
            station_id: 'MAIN',
            batch_comment: 'TW'
        }];
        const updated = mergeScanRecord(scans, '41261', { batch_comment: 'TW2', operator_name: 'Yubery', station_id: 'MAIN' });
        assert.strictEqual(updated.batch_comment, 'TW2');
        assert.strictEqual(scans[0].batch_comment, 'TW2');
        assert.strictEqual(scans[0].operator_name, 'Yubery');
    });

    check('mergeScanRecord returns null when the scan is missing', () => {
        assert.strictEqual(mergeScanRecord([{ id: 1 }], 2, { batch_comment: 'x' }), null);
    });

    check('edit save updates locally and does not refetch the whole range', () => {
        const saveStart = source.indexOf('async function saveRecord');
        const saveFn = source.slice(saveStart, source.indexOf('// ===== DELETE MODAL'));
        assert.ok(saveFn.includes('mergeScanRecord('));
        assert.ok(saveFn.includes('applyFilters(false)'));
        assert.ok(saveFn.includes('await fetchScans()'));
    });

    console.log('\n' + '='.repeat(50));
    console.log(`Tests Passed: ${passed}`);
    console.log(`Tests Failed: ${failed}`);
    console.log('='.repeat(50));
    return failed === 0 ? 0 : 1;
}

if (require.main === module) {
    process.exit(runTests());
}

module.exports = { runTests };
