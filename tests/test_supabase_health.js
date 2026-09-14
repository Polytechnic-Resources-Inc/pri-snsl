/**
 * Unit Tests for Supabase Health Check Module
 * Run with: node tests/test_supabase_health.js
 *
 * Keep HEALTH_CHECK_CONFIG and checkSupabaseHealth in sync with supabase-health.js.
 */

// Mock the global fetch and AbortController for testing
let lastFetch = { url: null, method: null, headers: null };

global.fetch = async function(url, options) {
    const mockUrl = url.toString();
    lastFetch = {
        url: mockUrl,
        method: options?.method || 'GET',
        headers: options?.headers || {}
    };

    // Simulate timeout
    if (options?.signal?.aborted) {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        throw error;
    }

    // Simulate various responses
    if (mockUrl.includes('timeout')) {
        // Simulate timeout by not responding
        return new Promise((_, reject) => {
            setTimeout(() => {
                const error = new Error('Aborted');
                error.name = 'AbortError';
                reject(error);
            }, 100);
        });
    }

    if (mockUrl.includes('server-error')) {
        return {
            ok: false,
            status: 500,
            statusText: 'Internal Server Error'
        };
    }

    if (mockUrl.includes('auth-required')) {
        return {
            ok: false,
            status: 401,
            statusText: 'Unauthorized'
        };
    }

    if (mockUrl.includes('network-error')) {
        throw new Error('Network request failed');
    }

    // Default: success
    return {
        ok: true,
        status: 200,
        statusText: 'OK'
    };
};

global.AbortController = class {
    constructor() {
        this.signal = { aborted: false };
        this._timeout = null;
    }
    abort() {
        this.signal.aborted = true;
        if (this._timeout) clearTimeout(this._timeout);
    }
};

// Mock performance.now()
let mockTime = 0;
global.performance = {
    now: () => mockTime++
};

// Mock console to avoid clutter
const originalConsole = global.console;
global.console = {
    log: () => {},
    error: () => {},
    warn: () => {},
    info: () => {}
};

const HEALTH_CHECK_CONFIG = {
    timeout: 8000,
    checkInterval: 15000,
    failureThreshold: 2,
    degradationLatency: 4000,
    backoffMultiplier: 1.5,
    maxBackoffInterval: 60000
};

const HEALTH_PROBE_PATH = '/rest/v1/operators?select=id&limit=1';

async function checkSupabaseHealth(url = 'https://test.supabase.co') {
    const startTime = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_CONFIG.timeout);

    try {
        const response = await fetch(`${url}${HEALTH_PROBE_PATH}`, {
            method: 'GET',
            headers: {
                'apikey': 'test-key',
                'Authorization': 'Bearer test-key',
                'Accept': 'application/json'
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        const latency = performance.now() - startTime;
        const isReachable = response.status >= 200 && response.status < 500;

        return {
            reachable: isReachable,
            latency: Math.round(latency),
            error: null
        };
    } catch (error) {
        clearTimeout(timeoutId);
        const latency = performance.now() - startTime;
        if (error.name === 'AbortError') {
            return {
                reachable: false,
                latency: HEALTH_CHECK_CONFIG.timeout,
                error: 'timeout'
            };
        }
        return {
            reachable: false,
            latency: Math.round(latency),
            error: error.message || 'network_error'
        };
    }
}

// ===== TEST CASES =====

async function runTests() {
    let passed = 0;
    let failed = 0;

    function assert(condition, testName) {
        if (condition) {
            originalConsole.log(`✅ PASS: ${testName}`);
            passed++;
        } else {
            originalConsole.error(`❌ FAIL: ${testName}`);
            failed++;
        }
    }

    originalConsole.log('🧪 Running Supabase Health Check Tests...\n');

    assert(HEALTH_CHECK_CONFIG.timeout === 8000, 'Health timeout is 8000ms');
    assert(HEALTH_CHECK_CONFIG.degradationLatency === 4000, 'Degradation latency is 4000ms');

    // Test 1: Successful health check
    mockTime = 0;
    lastFetch = { url: null, method: null, headers: null };
    const result1 = await checkSupabaseHealth('https://test.supabase.co');
    assert(result1.reachable === true, 'Successful health check returns reachable: true');
    assert(result1.latency >= 0, 'Latency is measured in milliseconds');
    assert(result1.error === null, 'No error on successful check');
    assert(
        lastFetch.url && lastFetch.url.includes('operators?select=id&limit=1'),
        'Probe URL includes operators?select=id&limit=1'
    );
    assert(lastFetch.method === 'GET', 'Probe method is GET, not HEAD');

    // Test 2: Server error (5xx) is treated as unreachable
    mockTime = 0;
    const result2 = await checkSupabaseHealth('https://test.supabase.co/server-error');
    assert(result2.reachable === false, 'Server error (500) returns reachable: false');

    // Test 3: Auth required (401) is treated as reachable (server is up)
    mockTime = 0;
    const result3 = await checkSupabaseHealth('https://test.supabase.co/auth-required');
    assert(result3.reachable === true, 'Auth error (401) returns reachable: true (server is up)');

    // Test 4: Timeout scenario
    mockTime = 0;
    const result4 = await checkSupabaseHealth('https://test.supabase.co/timeout');
    assert(result4.reachable === false, 'Timeout returns reachable: false');
    assert(result4.error === 'timeout', 'Timeout error is correctly identified');

    // Test 5: Network error
    mockTime = 0;
    const result5 = await checkSupabaseHealth('https://test.supabase.co/network-error');
    assert(result5.reachable === false, 'Network error returns reachable: false');
    assert(result5.error === 'Network request failed', 'Network error is captured');

    // Summary
    originalConsole.log('\n' + '='.repeat(50));
    originalConsole.log(`Tests Passed: ${passed}`);
    originalConsole.log(`Tests Failed: ${failed}`);
    originalConsole.log('='.repeat(50));

    // Restore console
    global.console = originalConsole;

    return failed === 0 ? 0 : 1;
}

// Run tests
if (require.main === module) {
    runTests().then(exitCode => process.exit(exitCode));
}

module.exports = { runTests };
