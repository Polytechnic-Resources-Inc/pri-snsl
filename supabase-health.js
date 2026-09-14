// ===== SUPABASE HEALTH CHECK MODULE =====
// v8.8.2: Accurate Supabase reachability detection
// Distinguishes between "internet online" and "Supabase reachable"

/**
 * Health check configuration
 */
const HEALTH_CHECK_CONFIG = {
    timeout: 8000,           // 8 second timeout for health check
    checkInterval: 15000,    // Check every 15 seconds
    failureThreshold: 2,     // 2 consecutive failures = DOWN
    degradationLatency: 4000,// Latency > 4s = DEGRADED
    backoffMultiplier: 1.5,  // Exponential backoff when down
    maxBackoffInterval: 60000 // Max 60 seconds between checks when down
};

const HEALTH_PROBE_PATH = '/rest/v1/operators?select=id&limit=1';

/**
 * Connectivity state
 */
const connectivityState = {
    internetOnline: navigator.onLine,
    supabaseReachable: null,    // null = unknown, true = reachable, false = unreachable
    supabaseDegraded: false,     // true = slow but working
    lastCheckedAt: null,
    lastLatencyMs: null,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    currentInterval: HEALTH_CHECK_CONFIG.checkInterval
};

/**
 * Perform a lightweight Supabase health check with timeout
 * Uses a GET on a real table so anon keys are accepted
 *
 * @returns {Promise<{ reachable: boolean, latency: number, error: string|null }> }
 */
async function checkSupabaseHealth() {
    const startTime = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_CONFIG.timeout);

    try {
        const response = await fetch(`${SUPABASE_URL}${HEALTH_PROBE_PATH}`, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Accept': 'application/json'
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        const latency = performance.now() - startTime;

        // Consider 200-299 and 401 (auth required) as reachable
        // 401 means the server is up, just needs auth
        const isReachable = response.status >= 200 && response.status < 500;

        return {
            reachable: isReachable,
            latency: Math.round(latency),
            error: null
        };
    } catch (error) {
        clearTimeout(timeoutId);
        const latency = performance.now() - startTime;

        // AbortError = timeout, treat as unreachable
        if (error.name === 'AbortError') {
            return {
                reachable: false,
                latency: HEALTH_CHECK_CONFIG.timeout,
                error: 'timeout'
            };
        }

        // Other network errors
        return {
            reachable: false,
            latency: Math.round(latency),
            error: error.message || 'network_error'
        };
    }
}

/**
 * Update connectivity state and trigger UI updates
 */
async function updateConnectivityState() {
    const result = await checkSupabaseHealth();

    connectivityState.lastCheckedAt = new Date().toISOString();
    connectivityState.lastLatencyMs = result.latency;

    if (result.reachable) {
        // Success - reset failures
        connectivityState.consecutiveFailures = 0;
        connectivityState.consecutiveSuccesses++;
        connectivityState.supabaseReachable = true;

        // Check if degraded (slow but working)
        connectivityState.supabaseDegraded = result.latency > HEALTH_CHECK_CONFIG.degradationLatency;

        // Reset interval on success
        connectivityState.currentInterval = HEALTH_CHECK_CONFIG.checkInterval;
    } else {
        // Failure - increment counter
        connectivityState.consecutiveFailures++;
        connectivityState.consecutiveSuccesses = 0;

        // Only mark as DOWN after threshold
        if (connectivityState.consecutiveFailures >= HEALTH_CHECK_CONFIG.failureThreshold) {
            connectivityState.supabaseReachable = false;
        }

        // Exponential backoff
        connectivityState.currentInterval = Math.min(
            connectivityState.currentInterval * HEALTH_CHECK_CONFIG.backoffMultiplier,
            HEALTH_CHECK_CONFIG.maxBackoffInterval
        );
    }

    // Update UI
    updateConnectivityUI();

    // Log state changes
    console.log(`🔍 Health Check: ${result.reachable ? 'OK' : 'FAIL'} (${result.latency}ms) | State: ${connectivityState.supabaseReachable ? 'REACHABLE' : 'UNREACHABLE'}${connectivityState.supabaseDegraded ? ' (DEGRADED)' : ''}`);
}

/**
 * Update UI elements to reflect current connectivity state
 */
async function updateConnectivityUI() {
    // Update internet status badge
    const internetBadge = document.getElementById('internetStatus');
    if (internetBadge) {
        if (connectivityState.internetOnline) {
            internetBadge.textContent = '🌐 ONLINE';
            internetBadge.style.background = '#10b981';
        } else {
            internetBadge.textContent = '🌐 OFFLINE';
            internetBadge.style.background = '#ef4444';
        }
    }

    // Update Supabase status badge
    const supabaseBadge = document.getElementById('supabaseStatus');
    if (supabaseBadge) {
        if (connectivityState.supabaseReachable === null) {
            // Unknown / checking
            supabaseBadge.textContent = '☁️ CHECKING...';
            supabaseBadge.style.background = '#6b7280';
        } else if (connectivityState.supabaseReachable) {
            if (connectivityState.supabaseDegraded) {
                // Slow but working
                supabaseBadge.textContent = `☁️ SLOW (${connectivityState.lastLatencyMs}ms)`;
                supabaseBadge.style.background = '#f59e0b';
            } else {
                // All good
                supabaseBadge.textContent = `☁️ OK (${connectivityState.lastLatencyMs}ms)`;
                supabaseBadge.style.background = '#10b981';
            }
        } else {
            // Down
            supabaseBadge.textContent = '☁️ DOWN';
            supabaseBadge.style.background = '#ef4444';
        }
    }

    // Update offline warning
    const offlineWarning = document.getElementById('offlineWarning');
    if (offlineWarning) {
        if (!connectivityState.internetOnline) {
            offlineWarning.textContent = '⚠️ NO INTERNET - Scans will queue automatically';
            offlineWarning.classList.add('show');
        } else if (connectivityState.supabaseReachable === false) {
            offlineWarning.textContent = '⚠️ SUPABASE UNREACHABLE - Scans will queue automatically';
            offlineWarning.classList.add('show');
        } else {
            offlineWarning.classList.remove('show');
        }
    }

    // Update queue warning based on both internet and Supabase status
    const queueWarning = document.getElementById('queueWarning');
    if (queueWarning && typeof getPendingCount === 'function') {
        const pendingCount = await getPendingCount();
        if (pendingCount > 0 && connectivityState.supabaseReachable === false) {
            queueWarning.textContent = `⚠️ ${pendingCount} scan(s) waiting - will sync when Supabase is reachable`;
            queueWarning.style.display = 'block';
        } else if (pendingCount > 0) {
            queueWarning.textContent = `⚠️ ${pendingCount} scan(s) waiting - syncing in background...`;
            queueWarning.style.display = 'block';
        } else {
            queueWarning.style.display = 'none';
        }
    }
}

/**
 * Get current connectivity status
 * @returns {Object} Current state
 */
function getConnectivityStatus() {
    return {
        internetOnline: connectivityState.internetOnline,
        supabaseReachable: connectivityState.supabaseReachable,
        supabaseDegraded: connectivityState.supabaseDegraded,
        lastLatencyMs: connectivityState.lastLatencyMs,
        lastCheckedAt: connectivityState.lastCheckedAt
    };
}

/**
 * Start periodic health checks
 */
let healthCheckTimer = null;

function scheduleNextHealthCheck() {
    if (healthCheckTimer) {
        clearTimeout(healthCheckTimer);
    }
    healthCheckTimer = setTimeout(async () => {
        await updateConnectivityState();
        scheduleNextHealthCheck();
    }, connectivityState.currentInterval);
}

function startHealthChecks() {
    if (healthCheckTimer) {
        clearTimeout(healthCheckTimer);
        healthCheckTimer = null;
    }
    updateConnectivityState().finally(scheduleNextHealthCheck);
    console.log('🔍 Supabase health checks started');
}

/**
 * Stop health checks
 */
function stopHealthChecks() {
    if (healthCheckTimer) {
        clearTimeout(healthCheckTimer);
        healthCheckTimer = null;
    }
}

/**
 * Force an immediate health check (e.g., after flush)
 */
async function forceHealthCheck() {
    await updateConnectivityState();
}

// ===== EVENT LISTENERS =====

// Listen for online/offline events (internet connectivity)
window.addEventListener('online', () => {
    connectivityState.internetOnline = true;
    updateConnectivityUI();
    // Trigger immediate health check when internet comes back
    forceHealthCheck();
});

window.addEventListener('offline', () => {
    connectivityState.internetOnline = false;
    connectivityState.supabaseReachable = false; // Definitely not reachable
    updateConnectivityUI();
});

// Listen for visibility changes (tab gains focus)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        // Check connectivity when user returns to tab
        forceHealthCheck();
    }
});

// Export for use in app.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getConnectivityStatus,
        forceHealthCheck,
        startHealthChecks,
        stopHealthChecks,
        checkSupabaseHealth,
        HEALTH_CHECK_CONFIG,
        HEALTH_PROBE_PATH
    };
}
