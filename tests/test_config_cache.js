/**
 * Unit tests for config cache helpers and withTimeout.
 * Run with: node tests/test_config_cache.js
 *
 * Mirrors serialize/parse/withTimeout used by saveConfigCache, applyConfigCache,
 * and fetchConfig in app.js. Does not load app.js (needs a browser supabase global).
 */

const CONFIG_CACHE_KEY = 'snsl-config-v1';

function serializeConfigCache({ operators, stations, partMap }) {
    if (!Array.isArray(operators) || operators.length === 0) return null;
    if (!Array.isArray(stations) || stations.length === 0) return null;
    if (!partMap || typeof partMap !== 'object') return null;
    return JSON.stringify({
        operators,
        stations,
        partMap,
        savedAt: '2026-09-14T00:00:00.000Z'
    });
}

function parseConfigCache(raw) {
    if (!raw) return null;
    try {
        const data = JSON.parse(raw);
        if (!Array.isArray(data.operators) || data.operators.length === 0) return null;
        if (!Array.isArray(data.stations) || data.stations.length === 0) return null;
        if (!data.partMap || typeof data.partMap !== 'object') return null;
        return data;
    } catch (e) {
        return null;
    }
}

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const id = setTimeout(() => {
            const err = new Error('timeout');
            err.name = 'AbortError';
            reject(err);
        }, ms);
        promise.then(
            (value) => { clearTimeout(id); resolve(value); },
            (err) => { clearTimeout(id); reject(err); }
        );
    });
}

async function runTests() {
    let passed = 0;
    let failed = 0;

    function assert(condition, testName) {
        if (condition) {
            console.log(`✅ PASS: ${testName}`);
            passed++;
        } else {
            console.error(`❌ FAIL: ${testName}`);
            failed++;
        }
    }

    console.log('🧪 Running Config Cache Tests...\n');

    const valid = {
        operators: ['Ada'],
        stations: ['MAIN'],
        partMap: { '01': '100756E2' }
    };
    const serialized = serializeConfigCache(valid);
    const parsed = parseConfigCache(serialized);
    assert(parsed !== null, 'Valid payload parses');
    assert(
        JSON.stringify(parsed.operators) === JSON.stringify(valid.operators)
        && JSON.stringify(parsed.stations) === JSON.stringify(valid.stations)
        && JSON.stringify(parsed.partMap) === JSON.stringify(valid.partMap),
        'Valid payload round-trips operators/stations/partMap'
    );
    assert(CONFIG_CACHE_KEY === 'snsl-config-v1', 'Cache key is snsl-config-v1');

    assert(
        serializeConfigCache({ operators: [], stations: ['MAIN'], partMap: {} }) === null,
        'Empty operators → serializeConfigCache returns null'
    );
    assert(
        serializeConfigCache({ operators: ['Ada'], stations: [], partMap: {} }) === null,
        'Empty stations → serializeConfigCache returns null'
    );
    assert(parseConfigCache('{not-json') === null, 'Garbage JSON → parseConfigCache returns null');
    assert(parseConfigCache('') === null, 'Empty string → parseConfigCache returns null');

    let timeoutName = null;
    try {
        await withTimeout(new Promise(() => {}), 5);
    } catch (e) {
        timeoutName = e.name;
    }
    assert(timeoutName === 'AbortError', 'withTimeout of a hang rejects with name === AbortError');

    const ok = await withTimeout(Promise.resolve('ok'), 50);
    assert(ok === 'ok', "withTimeout of Promise.resolve('ok') resolves 'ok'");

    console.log('\n' + '='.repeat(50));
    console.log(`Tests Passed: ${passed}`);
    console.log(`Tests Failed: ${failed}`);
    console.log('='.repeat(50));

    return failed === 0 ? 0 : 1;
}

if (require.main === module) {
    runTests().then(exitCode => process.exit(exitCode));
}

module.exports = { runTests, serializeConfigCache, parseConfigCache, withTimeout };
