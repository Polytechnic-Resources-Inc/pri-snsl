/**
 * Unit tests for dashboard Eastern-day UTC range helper.
 * Run with: node tests/test_dashboard_query.js
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
        extractFunction(source, 'addDaysYmd'),
        extractFunction(source, 'instantForEasternMidnight'),
        extractFunction(source, 'utcRangeForEasternYmd'),
        'this.addDaysYmd = addDaysYmd;',
        'this.instantForEasternMidnight = instantForEasternMidnight;',
        'this.utcRangeForEasternYmd = utcRangeForEasternYmd;'
    ].join('\n');
    const sandbox = {};
    vm.runInNewContext(script, sandbox);
    return sandbox;
}

function runTests() {
    const { utcRangeForEasternYmd, addDaysYmd } = loadDashboardFns();
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

    console.log('Running dashboard query tests...\n');

    check('Sep 15 2026 EDT range is 04:00Z to next 04:00Z', () => {
        const range = utcRangeForEasternYmd('2026-09-15');
        assert.strictEqual(range.gte, '2026-09-15T04:00:00.000Z');
        assert.strictEqual(range.lt, '2026-09-16T04:00:00.000Z');
    });

    check('Jan 15 2026 EST range is 05:00Z to next 05:00Z', () => {
        const range = utcRangeForEasternYmd('2026-01-15');
        assert.strictEqual(range.gte, '2026-01-15T05:00:00.000Z');
        assert.strictEqual(range.lt, '2026-01-16T05:00:00.000Z');
    });

    check('invalid date returns null', () => {
        assert.strictEqual(utcRangeForEasternYmd(''), null);
        assert.strictEqual(utcRangeForEasternYmd('nope'), null);
    });

    check('addDaysYmd rolls the calendar', () => {
        assert.strictEqual(addDaysYmd('2026-09-30', 1), '2026-10-01');
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
