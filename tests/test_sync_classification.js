/**
 * Unit tests for Supabase scan sync result classification.
 * Run with: node tests/test_sync_classification.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function extractFunction(source, name) {
    const token = `function ${name}`;
    const start = source.indexOf(token);
    assert(start !== -1, `${name} is defined in app.js`);

    const openParen = source.indexOf('(', start);
    assert(openParen !== -1, `${name} has a parameter list`);

    let parenDepth = 0;
    let closeParen = -1;
    for (let i = openParen; i < source.length; i++) {
        if (source[i] === '(') parenDepth++;
        if (source[i] === ')') parenDepth--;
        if (parenDepth === 0) {
            closeParen = i;
            break;
        }
    }

    assert(closeParen !== -1, `${name} parameter list was closed`);

    const openBrace = source.indexOf('{', closeParen);
    assert(openBrace !== -1, `${name} has a function body`);

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

function loadAppFns() {
    const appPath = path.join(__dirname, '..', 'app.js');
    const source = fs.readFileSync(appPath, 'utf8');
    const script = [
        extractFunction(source, 'makeSyncResult'),
        extractFunction(source, 'classifySyncResult'),
        extractFunction(source, 'classifyExistingScanConflict'),
        'this.classifySyncResult = classifySyncResult;',
        'this.classifyExistingScanConflict = classifyExistingScanConflict;'
    ].join('\n');

    const sandbox = {};
    vm.runInNewContext(script, sandbox);
    return sandbox;
}

async function runTests() {
    const { classifySyncResult, classifyExistingScanConflict } = loadAppFns();
    let passed = 0;
    let failed = 0;

    function assertStatus(input, expected, testName) {
        try {
            const result = classifySyncResult(input);
            assert(result && typeof result === 'object', 'result is a structured object');
            assert.strictEqual(result.status, expected);
            console.log(`PASS: ${testName}`);
            passed++;
        } catch (error) {
            console.error(`FAIL: ${testName}`);
            console.error(`  ${error.message}`);
            failed++;
        }
    }

    function assertConflict(input, expected, testName) {
        try {
            const result = classifyExistingScanConflict(input);
            assert.strictEqual(result, expected);
            console.log(`PASS: ${testName}`);
            passed++;
        } catch (error) {
            console.error(`FAIL: ${testName}`);
            console.error(`  ${error.message}`);
            failed++;
        }
    }

    console.log('Running sync classification tests...\n');

    assertStatus({ httpStatus: 200 }, 'OK', '200 response is OK');
    assertStatus({ httpStatus: 409 }, 'DUPLICATE', '409 response is duplicate until age is checked');
    assertStatus({ httpStatus: 400, errorCode: '23505' }, 'DUPLICATE', 'Postgres 23505 is duplicate until age is checked');
    assertStatus({ httpStatus: 401 }, 'BLOCKED', '401 response is blocked');
    assertStatus({ httpStatus: 403 }, 'BLOCKED', '403 response is blocked');
    assertStatus({ httpStatus: 403, errorCode: '42501' }, 'BLOCKED', 'Postgres 42501 is blocked');
    assertStatus({ httpStatus: 403, errorMessage: 'new row violates row-level security policy' }, 'BLOCKED', 'RLS policy message is blocked');
    assertStatus({ httpStatus: 400 }, 'BLOCKED', '400 response is blocked');
    assertStatus({ httpStatus: 422 }, 'BLOCKED', '422 response is blocked');
    assertStatus({ httpStatus: 500 }, 'RETRYABLE', '500 response is retryable');
    assertStatus({ timedOut: true, errorMessage: 'The operation was aborted' }, 'RETRYABLE', 'timeout is retryable');
    assertStatus({ networkError: true, errorMessage: 'Failed to fetch' }, 'RETRYABLE', 'network failure is retryable');

    const now = Date.parse('2026-09-15T18:17:17.000Z');
    const windowMs = 60000;

    assertConflict(
        { createdAt: '2026-09-15T18:17:13.925Z', nowMs: now, windowMs },
        'OK',
        'unique hit on a scan from 4s ago is already saved'
    );
    assertConflict(
        { createdAt: '2026-09-15T17:17:11.210Z', nowMs: now, windowMs },
        'DUPLICATE',
        'unique hit on a scan from an hour ago stays duplicate'
    );
    assertConflict(
        { createdAt: null, nowMs: now, windowMs },
        'DUPLICATE',
        'unique hit with no created_at stays duplicate'
    );
    assertConflict(
        { createdAt: 'not-a-date', nowMs: now, windowMs },
        'DUPLICATE',
        'unique hit with unparsable created_at stays duplicate'
    );
    assertConflict(
        { createdAt: '2026-09-15T18:16:17.000Z', nowMs: now, windowMs },
        'OK',
        'unique hit exactly at the 60s window is already saved'
    );
    assertConflict(
        { createdAt: '2026-09-15T18:16:16.999Z', nowMs: now, windowMs },
        'DUPLICATE',
        'unique hit just outside the 60s window stays duplicate'
    );

    console.log('\n' + '='.repeat(50));
    console.log(`Tests Passed: ${passed}`);
    console.log(`Tests Failed: ${failed}`);
    console.log('='.repeat(50));

    return failed === 0 ? 0 : 1;
}

if (require.main === module) {
    runTests().then(exitCode => process.exit(exitCode));
}

module.exports = { runTests };
