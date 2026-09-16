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
    assertStatus({ httpStatus: 409 }, 'BLOCKED', 'unclassified conflict cannot discard a queued scan');
    assertStatus({ httpStatus: 400, errorCode: '23505' }, 'DUPLICATE', 'Postgres 23505 requires identity verification');
    assertStatus({ httpStatus: 401 }, 'BLOCKED', '401 response is blocked');
    assertStatus({ httpStatus: 403 }, 'BLOCKED', '403 response is blocked');
    assertStatus({ httpStatus: 403, errorCode: '42501' }, 'BLOCKED', 'Postgres 42501 is blocked');
    assertStatus({ httpStatus: 403, errorMessage: 'new row violates row-level security policy' }, 'BLOCKED', 'RLS policy message is blocked');
    assertStatus({ httpStatus: 400 }, 'BLOCKED', '400 response is blocked');
    assertStatus({ httpStatus: 422 }, 'BLOCKED', '422 response is blocked');
    assertStatus({ httpStatus: 500 }, 'RETRYABLE', '500 response is retryable');
    assertStatus({ timedOut: true, errorMessage: 'The operation was aborted' }, 'RETRYABLE', 'timeout is retryable');
    assertStatus({ networkError: true, errorMessage: 'Failed to fetch' }, 'RETRYABLE', 'network failure is retryable');

    assertConflict({ existingScan: { idempotency_key: 'same' }, idempotencyKey: 'same' }, 'OK', 'same durable submission is saved');
    assertConflict({ existingScan: { idempotency_key: 'other' }, idempotencyKey: 'mine' }, 'DUPLICATE', 'different submission is duplicate');
    assertConflict({ existingScan: { idempotency_key: null }, idempotencyKey: 'mine' }, 'DUPLICATE', 'legacy existing record remains duplicate');
    assertConflict({ existingScan: null, idempotencyKey: 'mine' }, 'RETRYABLE', 'unverified conflict remains queued');

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
