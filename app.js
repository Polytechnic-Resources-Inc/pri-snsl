// Copied from original app.js
// ===== SeeScan Supa1.0.1 - Supabase Migration =====
// Supa1.0.1: Replaced Flask/Google Sheets backend with Supabase.
//         Ported Python parsing logic (MGC, R756, etc.) to client-side JavaScript (`app.js`).
// v8.8.8: Keep all-numeric HIBC serial digits when check char is missing; recover 01-prefixed chopped GS1
// v8.8.7: Larger operator type + landscape 960px wrap / Last Scan 3-col
// v8.8.6: Unique part+serial retry within 60s shows Saved, not Duplicate
// v8.8.5: Non-blocking config load + 8s health/config timeouts + local config cache
// v8.8.4: Reject UNKNOWN / recover truncated GS1-128 (missing leading 01) before insert
// v8.8.3: Hotfix - Added '757E2' to HIBC_MAX_TRAILING_BEFORE_STRIP (5-digit serial preservation)
// v8.8.2: Hotfix - Fixed VALIDATION_CONFIG undefined reference
//         - Changed VALIDATION_CONFIG to BARCODE_VALIDATION (line 1374)
//         - Fixes critical bug preventing HIBC barcodes from processing
// v8.8.1: Hotfix - Non-blocking Last Scan load
//         - Fixed scan input blocking issue caused by await loadLastScan()
//         - Scan input now enabled immediately, Last Scan loads in background
//         - Barcodes process without delay on app load
// v8.8.0: Offline-first scanning with accurate Supabase health detection
//         - Added supabase-health.js for distinct internet/Supabase status
//         - Scan submit timeout (3s) prevents freezing on Supabase outage
//         - Queued scans persist across refreshes, auto-flush on recovery
//         - Client-side duplicate cache (last 100 serials per operator)
//         - All barcode validation happens BEFORE queuing (fail-fast v8.6.0)
//         - Enhanced Last Scan: pulls from localStorage + queued + Supabase
//         - History panel expanded by default (no toggle button needed)
//         - Last Scan persists across refresh and operator changes
// v8.7.4: HIBC part-aware strip — 759E2 (7 digits) and 756E2/757E2/758E2 (6 digits) no longer drop last serial digit
// v8.7.2: Added 100760E rule (5-digit serials) - fixes end-cap character being included in serial number
// v8.7.1: CRITICAL FIX - Corrected all 66 broken regex patterns in PRODUCT_SERIAL_RULES (removed invalid escape sequences)
// v8.7.0: PRODUCT_SERIAL_RULES updated with 44 MASTER TRUTH rules from serial_numbers.db (31,188 verified records)
// v8.6.6: PUL9000K serial extraction includes part prefix (PUL9000K29689, not just 29689)
// v8.6.5: Product-specific serial extraction rules (PUL9000K = 5 digits, ignores trailing check digits/padding)
// v8.6.4: Fixed HIBC check digit stripping for mixed barcode formats (6-digit serials + check digit ambiguity)
// v8.6.3: HIBC check digit validation and MGC S/C assignment fixes
// v8.6.2: Fixed service worker dashboard timeout (API calls now bypass cache)
// v8.6.1: Fixed 100780W parsing (legacy label fix for +B4461007801 barcodes)
// v8.6.0: Client-side barcode validation - rejects malformed scans BEFORE they reach the database (fail-fast)
// v8.5.4: HIBC check digit stripped ONLY if 6+ trailing digits (5 digit min safety net for misconfigured barcodes)
// v8.5.3: (superseded by v8.5.4)
// v8.5.2: (superseded by v8.5.3)
// v8.5.1: Scan field now locked until Part Number Map loads - prevents UNKNOWN entries from premature scanning
// v8.5.0: Operators and Stations now managed via Google Sheet CONFIG tab - clients can add/remove without code updates
// v8.4.3: Fixed edge case where serials without end caps had last digit incorrectly stripped - now uses trailing digit count (6+ = check digit, ≤5 = keep all)
// v8.4.0: Migrated Part Number Map to Google Sheet PART_MAP tab with enhanced logging
// v8.3.8: Multi-Tablet Fix

// ===== SUPABASE CONFIGURATION =====
// Instructions: Replace these values with your actual Supabase URL and Anon Key.
// ===== SUPABASE CONFIGURATION =====
// Instructions: Replace these values with your actual Supabase URL and Anon Key.
// NOTE: We use the global 'supabase' object provided by the script tag in index.html
const SUPABASE_URL = 'https://ospedluufxgpfvqtznej.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zcGVkbHV1ZnhncGZ2cXR6bmVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5ODgyMTUsImV4cCI6MjA4MTU2NDIxNX0.1AhtuANYs-eVrQIdW9gqt_KLhBxF4Vm0j6pqtrrJAag'; // <--- PASTE YOUR KEY HERE

// Initialize Client (Global variable from CDN)
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Endpoint usage is replaced by Client usage in send()
// But we keep the constant if needed or refactor send() below.
const ENDPOINT = `${SUPABASE_URL}/rest/v1/scans`;

// Legacy fallbacks (kept for reference or reverting)
const SHARED_SECRET = 'qk92X3vE7LrT8c59H1zUM4Bn0ySDFwGp';

// Stores
let PART_NUMBER_MAP = {};
let OPERATORS_LIST = [];
let STATIONS_LIST = [];

const CONFIG_CACHE_KEY = 'snsl-config-v1';
const CONFIG_FETCH_TIMEOUT_MS = 8000;

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

function saveConfigCache() {
    if (!OPERATORS_LIST.length || !STATIONS_LIST.length) return;
    if (!PART_NUMBER_MAP || typeof PART_NUMBER_MAP !== 'object') return;
    try {
        localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({
            operators: OPERATORS_LIST,
            stations: STATIONS_LIST,
            partMap: PART_NUMBER_MAP,
            savedAt: new Date().toISOString()
        }));
    } catch (e) {
        console.warn('Config cache save failed:', e);
    }
}

function applyConfigCache() {
    try {
        const raw = localStorage.getItem(CONFIG_CACHE_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (!Array.isArray(data.operators) || !data.operators.length) return false;
        if (!Array.isArray(data.stations) || !data.stations.length) return false;
        if (!data.partMap || typeof data.partMap !== 'object') return false;
        OPERATORS_LIST = data.operators;
        STATIONS_LIST = data.stations;
        PART_NUMBER_MAP = data.partMap;
        return true;
    } catch (e) {
        console.warn('Config cache read failed:', e);
        return false;
    }
}

// ===== BARCODE VALIDATION CONFIG =====
// Client-side validation to reject malformed scans BEFORE they reach the database
const BARCODE_VALIDATION = {
    MIN_RAW_LENGTH: 20,      // Minimum raw scan length (matches server-side flag)
    FORMATS: {
        GS1_128: {
            minLength: 28,    // 16-char prefix + 12+ char serial
            pattern: /^01[0-9]{14}/  // Starts with 01 + 14 digits
        },
        HIBC: {
            minLength: 12,    // Minimum HIBC format
            pattern: /\/\$\+/  // Must contain /$+ delimiter
        }
    },
    // Suspicious characters that indicate scanner errors
    // NOTE: % is VALID for HIBC check digits (Mod 43), so it's excluded
    // Valid HIBC check chars: 0-9, A-Z, and special chars: - . $ / + %
    // Part-specific: do NOT strip trailing digit when "chars after last letter" <= this (avoids dropping serial digit)
    HIBC_MAX_TRAILING_BEFORE_STRIP: {
        '100756E2': 6, '100757E2': 6, '100758E2': 6,  // 756E/757E/758E + 6 digits
        '100759E2': 7,  // 759E + 7 digits
        '757E2': 6      // Fix: 757E2 has 6 trailing chars after last letter (v8.8.3)
    },
    SUSPICIOUS_CHARS: /[*#@!~`^&()={}|[\]<>;:'"]/
};

// ===== PRODUCT-SPECIFIC SERIAL EXTRACTION RULES =====
// Maps product codes to specific serial number extraction patterns
// This allows targeted handling of problematic barcodes with check digits, padding, etc.
// Generated from MASTER TRUTH (serial_numbers.db - 31,188 records)
const PRODUCT_SERIAL_RULES = {
    '100756E2': {
        pattern: /^(756E\d{6}).*$/,
        extractGroup: 1,
        description: 'Extract full 756E + 6 digits (5 records), ignore trailing check digits/padding'
    },
    '100756EL': {
        pattern: /^(756EL\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 756EL + 5 digits (3 records), ignore trailing check digits/padding'
    },
    '100756EW': {
        pattern: /^(756EW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 756EW + 5 digits (739 records), ignore trailing check digits/padding'
    },
    '100756NKNW': {
        pattern: /^(756NKNW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 756NKNW + 5 digits (2 records), ignore trailing check digits/padding'
    },
    '100756NW': {
        pattern: /^(756NW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 756NW + 5 digits (659 records), ignore trailing check digits/padding'
    },
    '100757E2': {
        pattern: /^(757E\d{6}).*$/,
        extractGroup: 1,
        description: 'Extract full 757E + 6 digits (27 records), ignore trailing check digits/padding'
    },
    '100757EL': {
        pattern: /^(757EL\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 757EL + 5 digits (30 records), ignore trailing check digits/padding'
    },
    '100757EN': {
        pattern: /^(757EN\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 757EN + 5 digits (11 records), ignore trailing check digits/padding'
    },
    '100757EW': {
        pattern: /^(757EW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 757EW + 5 digits (79 records), ignore trailing check digits/padding'
    },
    '100757NKNW': {
        pattern: /^(757NKNW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 757NKNW + 5 digits (1 record), ignore trailing check digits/padding'
    },
    '100757NW': {
        pattern: /^(757NW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 757NW + 5 digits (8 records), ignore trailing check digits/padding'
    },
    '100758E2': {
        pattern: /^(758E\d{6}).*$/,
        extractGroup: 1,
        description: 'Extract full 758E + 6 digits (24 records), ignore trailing check digits/padding'
    },
    '100758EL': {
        pattern: /^(758EL\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 758EL + 5 digits (13 records), ignore trailing check digits/padding'
    },
    '100758EW': {
        pattern: /^(758EW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 758EW + 5 digits (10 records), ignore trailing check digits/padding'
    },
    '100758NKNW': {
        pattern: /^(758NKNW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 758NKNW + 5 digits (1 record), ignore trailing check digits/padding'
    },
    '100758NW': {
        pattern: /^(758NW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 758NW + 5 digits (9 records), ignore trailing check digits/padding'
    },
    '100759E2': {
        pattern: /^(759E\d{7}).*$/,
        extractGroup: 1,
        description: 'Extract full 759E + 7 digits (37 records), ignore trailing check digits/padding'
    },
    '100759EL': {
        pattern: /^(759EL\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 759EL + 5 digits (6 records), ignore trailing check digits/padding'
    },
    '100759ELRN': {
        pattern: /^(100759ELRN\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 100759ELRN + 5 digits (1 record), ignore trailing check digits/padding'
    },
    '100759EW': {
        pattern: /^(759EW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 759EW + 5 digits (10 records), ignore trailing check digits/padding'
    },
    '100759NW': {
        pattern: /^(759NW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 759NW + 5 digits (2 records), ignore trailing check digits/padding'
    },
    '100759WC': {
        pattern: /^(759WC\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 759WC + 5 digits (1 record), ignore trailing check digits/padding'
    },
    '100759WN': {
        pattern: /^(759WN\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 759WN + 5 digits (1 record), ignore trailing check digits/padding'
    },
    '100760E': {
        pattern: /^(760E\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 760E + 5 digits, ignore trailing check digits/padding (end-cap fix 2026-01-20)'
    },
    '100760EL': {
        pattern: /^(760EL\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 760EL + 5 digits (15 records), ignore trailing check digits/padding'
    },
    '100760ELN': {
        pattern: /^(760ELN\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 760ELN + 5 digits (11 records), ignore trailing check digits/padding'
    },
    '100760KN': {
        pattern: /^(760KN\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 760KN + 5 digits (6 records), ignore trailing check digits/padding'
    },
    '100760WN': {
        pattern: /^(760WN\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 760WN + 5 digits (1 record), ignore trailing check digits/padding'
    },
    '100780EW': {
        pattern: /^(780EW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 780EW + 5 digits (12 records), ignore trailing check digits/padding'
    },
    '100780NKNW': {
        pattern: /^(780NKNW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 780NKNW + 5 digits (1 record), ignore trailing check digits/padding'
    },
    '100780W': {
        pattern: /^(780W\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 780W + 5 digits (3 records), ignore trailing check digits/padding'
    },
    '100790EL': {
        pattern: /^(790EL\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 790EL + 5 digits (20 records), ignore trailing check digits/padding'
    },
    '100790EW': {
        pattern: /^(790EW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 790EW + 5 digits (20 records), ignore trailing check digits/padding'
    },
    '536719-001S': {
        pattern: /^(\MGCK1S\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full MGCK1S + 5 digits (7 records), ignore trailing check digits/padding'
    },
    '536723-001S': {
        pattern: /^(\MGCK2S\d{7}).*$/,
        extractGroup: 1,
        description: 'Extract full MGCK2S + 7 digits (1,805 records), ignore trailing check digits/padding'
    },
    '536723-004S': {
        pattern: /^(\MGCK4S\d{6}).*$/,
        extractGroup: 1,
        description: 'Extract full MGCK4S + 6 digits (7 records), ignore trailing check digits/padding'
    },
    '6W': {
        pattern: /^(\PFR6W\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full PFR6W + 5 digits (9 records), ignore trailing check digits/padding'
    },
    '6WE2': {
        pattern: /^(\PFR6WE\d{6}).*$/,
        extractGroup: 1,
        description: 'Extract full PFR6WE + 6 digits (1 record), ignore trailing check digits/padding'
    },
    '6WKN': {
        pattern: /^(\PFR6WKN\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full PFR6WKN + 5 digits (1 record), ignore trailing check digits/padding'
    },
    'EBS756EW': {
        pattern: /^(\EBS756EW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full EBS756EW + 5 digits (11 records), ignore trailing check digits/padding'
    },
    'EBS756NW': {
        pattern: /^(\EBS756NW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full EBS756NW + 5 digits (38 records), ignore trailing check digits/padding'
    },
    'EBS757EW': {
        pattern: /^(\EBS757EW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full EBS757EW + 5 digits (138 records), ignore trailing check digits/padding'
    },
    'EBS757NKNW': {
        pattern: /^(\EBS757NKNW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full EBS757NKNW + 5 digits (1 record), ignore trailing check digits/padding'
    },
    'EBS757NW': {
        pattern: /^(\EBS757NW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full EBS757NW + 5 digits (56 records), ignore trailing check digits/padding'
    },
    'EBS758NNK': {
        pattern: /^(\EBS758NNK\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full EBS758NNK + 5 digits (1 record), ignore trailing check digits/padding'
    },
    'EBS758NW': {
        pattern: /^(\EBS758NW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full EBS758NW + 5 digits (1 record), ignore trailing check digits/padding'
    },
    'EBS759EL': {
        pattern: /^(\EBS759EL\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full EBS759EL + 5 digits (56 records), ignore trailing check digits/padding'
    },
    'EBS759WC': {
        pattern: /^(\EBS759WC\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full EBS759WC + 5 digits (1 record), ignore trailing check digits/padding'
    },
    'EBS780NW': {
        pattern: /^(\EBS780NW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full EBS780NW + 5 digits (65 records), ignore trailing check digits/padding'
    },
    'FIL5050EL': {
        pattern: /^(\FIL5050EL\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full FIL5050EL + 5 digits (1 record), ignore trailing check digits/padding'
    },
    'FIL7958': {
        pattern: /^(\FIL\d{9}).*$/,
        extractGroup: 1,
        description: 'Extract full FIL + 9 digits (793 records), ignore trailing check digits/padding'
    },
    'FIL9000': {
        pattern: /^(\FIL\d{9}).*$/,
        extractGroup: 1,
        description: 'Extract full FIL + 9 digits (868 records), ignore trailing check digits/padding'
    },
    'P5551100E': {
        pattern: /^(1100E\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 1100E + 5 digits (1 record), ignore trailing check digits/padding'
    },
    'P5553100E': {
        pattern: /^(3100E\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 3100E + 5 digits (1 record), ignore trailing check digits/padding'
    },
    'P5554100E': {
        pattern: /^(4100E\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 4100E + 5 digits (58 records), ignore trailing check digits/padding'
    },
    'P5556100E': {
        pattern: /^(6100E\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 6100E + 5 digits (36 records), ignore trailing check digits/padding'
    },
    'P5557100': {
        pattern: /^(7100\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract 7100 + 5 digits (9-char serial). Guns often omit the HIBC check char; do not treat last serial digit as check.'
    },
    'P5557100E': {
        pattern: /^(7100E\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 7100E + 5 digits (138 records), ignore trailing check digits/padding'
    },
    'P5551100': {
        pattern: /^(1100\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract 1100 + 5 digits (9-char serial)'
    },
    'P5553100': {
        pattern: /^(3100\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract 3100 + 5 digits (9-char serial)'
    },
    'P5554100': {
        pattern: /^(4100\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract 4100 + 5 digits (9-char serial)'
    },
    'P5556100': {
        pattern: /^(6100\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract 6100 + 5 digits (9-char serial)'
    },
    'P5559100': {
        pattern: /^(9100\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract 9100 + 5 digits (9-char serial)'
    },
    'P5559100E': {
        pattern: /^(9100E\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full 9100E + 5 digits (72 records), ignore trailing check digits/padding'
    },
    'PUL9000K': {
        pattern: /^(\PUL9000K\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full PUL9000K + 5 digits (4,540 records), ignore trailing check digits/padding'
    },
    'R756E2': {
        pattern: /^(\R756E\d{6}).*$/,
        extractGroup: 1,
        description: 'Extract full R756E + 6 digits (2 records), ignore trailing check digits/padding'
    },
    'R756EL': {
        pattern: /^(\R756EL\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full R756EL + 5 digits (166 records), ignore trailing check digits/padding'
    },
    'R756ELMN': {
        pattern: /^(\R756ELMN\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full R756ELMN + 5 digits (19 records), ignore trailing check digits/padding'
    },
    'R756EW': {
        pattern: /^(\R756EW\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full R756EW + 5 digits (226 records), ignore trailing check digits/padding'
    },
    'R756W': {
        pattern: /^(\R756W\d{5}).*$/,
        extractGroup: 1,
        description: 'Extract full R756W + 5 digits (181 records), ignore trailing check digits/padding'
    },
    'TNN101': {
        pattern: /^(\TNN\d{9}).*$/,
        extractGroup: 1,
        description: 'Extract full TNN + 9 digits (8 records), ignore trailing check digits/padding'
    },
    'TNN102': {
        pattern: /^(\TNN\d{8}).*$/,
        extractGroup: 1,
        description: 'Extract full TNN + 8 digits (28 records), ignore trailing check digits/padding'
    },
    'TNN103': {
        pattern: /^(\TNN\d{8}).*$/,
        extractGroup: 1,
        description: 'Extract full TNN + 8 digits (1 record), ignore trailing check digits/padding'
    }
};

// ===== SUMMARY =====
// Total rules: 44 rules from MASTER TRUTH (31,188 records)
// All serial patterns verified against historical data

// ===== OFFLINE QUEUE (IndexedDB) =====
// Stores scans locally when offline, syncs when connectivity returns
const QUEUE_DB_NAME = 'sosv2-offline';
const QUEUE_DB_VERSION = 1;
const QUEUE_STORE_NAME = 'pendingScans';
let queueDb = null;

function makeSyncResult(status, details = {}) {
    return {
        status,
        httpStatus: Number.isFinite(details.httpStatus) ? details.httpStatus : null,
        errorCode: details.errorCode ? String(details.errorCode) : null,
        errorMessage: details.errorMessage ? String(details.errorMessage) : ''
    };
}

function classifySyncResult(details = {}) {
    const rawHttpStatus = details.httpStatus ?? details.status;
    const httpStatus = Number.isFinite(Number(rawHttpStatus)) ? Number(rawHttpStatus) : null;
    const errorCode = details.errorCode || details.code || null;
    const errorMessage = details.errorMessage || details.message || '';
    const normalizedCode = String(errorCode || '').toUpperCase();
    const normalizedMessage = String(errorMessage || '').toLowerCase();
    const resultDetails = { httpStatus, errorCode, errorMessage };

    if (details.timedOut || details.networkError) {
        return makeSyncResult('RETRYABLE', resultDetails);
    }

    if (httpStatus >= 200 && httpStatus <= 299) {
        return makeSyncResult('OK', resultDetails);
    }

    if (httpStatus === 409 || normalizedCode === '23505') {
        return makeSyncResult('DUPLICATE', resultDetails);
    }

    if (
        httpStatus === 401 ||
        httpStatus === 403 ||
        httpStatus === 400 ||
        httpStatus === 422 ||
        normalizedCode === '42501' ||
        normalizedMessage.includes('row-level security') ||
        normalizedMessage.includes('rls') ||
        normalizedMessage.includes('policy') ||
        normalizedMessage.includes('permission') ||
        normalizedMessage.includes('unauthorized') ||
        normalizedMessage.includes('forbidden')
    ) {
        return makeSyncResult('BLOCKED', resultDetails);
    }

    if (httpStatus === 408 || httpStatus === 429 || (httpStatus >= 500 && httpStatus <= 599)) {
        return makeSyncResult('RETRYABLE', resultDetails);
    }

    if (httpStatus >= 400 && httpStatus <= 499) {
        return makeSyncResult('BLOCKED', resultDetails);
    }

    return makeSyncResult('RETRYABLE', resultDetails);
}

const EXISTING_SCAN_CONFLICT_WINDOW_MS = 60000;

function classifyExistingScanConflict(details = {}) {
    const windowMs = Number.isFinite(details.windowMs) ? details.windowMs : EXISTING_SCAN_CONFLICT_WINDOW_MS;
    const nowMs = Number.isFinite(details.nowMs) ? details.nowMs : Date.now();
    const createdMs = Date.parse(details.createdAt);
    if (!Number.isFinite(createdMs)) {
        return 'DUPLICATE';
    }
    if ((nowMs - createdMs) <= windowMs) {
        return 'OK';
    }
    return 'DUPLICATE';
}

/**
 * Initialize IndexedDB for offline queue
 */
async function initOfflineQueue() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(QUEUE_DB_NAME, QUEUE_DB_VERSION);

        request.onerror = () => {
            console.error('❌ IndexedDB failed to open:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            queueDb = request.result;
            console.log('📦 Offline queue initialized');
            resolve(queueDb);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(QUEUE_STORE_NAME)) {
                const store = db.createObjectStore(QUEUE_STORE_NAME, { keyPath: 'idempotencyKey' });
                store.createIndex('timestamp', 'timestamp', { unique: false });
                store.createIndex('status', 'status', { unique: false });
                console.log('📦 Created offline queue store');
            }
        };
    });
}

/**
 * Add a scan to the offline queue
 */
async function queueScan(payload, idempotencyKey) {
    if (!queueDb) await initOfflineQueue();

    return new Promise((resolve, reject) => {
        const tx = queueDb.transaction(QUEUE_STORE_NAME, 'readwrite');
        const store = tx.objectStore(QUEUE_STORE_NAME);

        const record = {
            idempotencyKey,
            payload,
            timestamp: Date.now(),
            status: 'pending',
            retries: 0,
            lastAttemptAt: null,
            lastResult: null,
            lastHttpStatus: null,
            lastErrorCode: null,
            lastErrorMessage: ''
        };

        const request = store.put(record);
        request.onsuccess = () => resolve(record);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Remove a scan from the queue (after successful sync)
 */
async function dequeueScan(idempotencyKey) {
    if (!queueDb) return;

    return new Promise((resolve, reject) => {
        const tx = queueDb.transaction(QUEUE_STORE_NAME, 'readwrite');
        const store = tx.objectStore(QUEUE_STORE_NAME);
        const request = store.delete(idempotencyKey);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Update metadata on an existing queued scan.
 */
async function updateQueuedScan(idempotencyKey, updates) {
    if (!queueDb) await initOfflineQueue();

    return new Promise((resolve, reject) => {
        const tx = queueDb.transaction(QUEUE_STORE_NAME, 'readwrite');
        const store = tx.objectStore(QUEUE_STORE_NAME);
        const getRequest = store.get(idempotencyKey);

        getRequest.onsuccess = () => {
            const existing = getRequest.result;
            if (!existing) {
                resolve(null);
                return;
            }

            const updated = { ...existing, ...updates };
            const putRequest = store.put(updated);
            putRequest.onsuccess = () => resolve(updated);
            putRequest.onerror = () => reject(putRequest.error);
        };

        getRequest.onerror = () => reject(getRequest.error);
    });
}

function buildQueueAttemptUpdates(record, result) {
    const retries = Number(record?.retries || 0) + 1;
    return {
        status: 'pending',
        retries,
        lastAttemptAt: new Date().toISOString(),
        lastResult: result.status,
        lastHttpStatus: result.httpStatus,
        lastErrorCode: result.errorCode,
        lastErrorMessage: result.errorMessage
    };
}

/**
 * Get all pending scans from queue
 */
async function getPendingScans() {
    if (!queueDb) await initOfflineQueue();

    return new Promise((resolve, reject) => {
        const tx = queueDb.transaction(QUEUE_STORE_NAME, 'readonly');
        const store = tx.objectStore(QUEUE_STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get count of pending scans
 */
async function getPendingCount() {
    if (!queueDb) return 0;

    return new Promise((resolve) => {
        const tx = queueDb.transaction(QUEUE_STORE_NAME, 'readonly');
        const store = tx.objectStore(QUEUE_STORE_NAME);
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(0);
    });
}

/**
 * Flush queue - attempt to sync all pending scans to Supabase
 * v8.8.2: Health-check aware - only flushes when Supabase is reachable
 */
let isFlushingQueue = false;
async function flushQueue() {
    if (isFlushingQueue) return;

    // Check internet connectivity
    if (!navigator.onLine) {
        console.log('📶 No internet - skipping queue flush');
        return;
    }

    // Check Supabase reachability (if available)
    if (typeof getConnectivityStatus === 'function') {
        const status = getConnectivityStatus();
        if (status.supabaseReachable === false) {
            console.log('☁️ Supabase unreachable - skipping queue flush');
            return;
        }
    }

    isFlushingQueue = true;
    console.log('🔄 Flushing offline queue...');

    try {
        const pending = await getPendingScans();
        if (pending.length === 0) {
            console.log('✅ Queue empty, nothing to flush');
            updateQueueUI();
            return;
        }

        console.log(`📤 Syncing ${pending.length} queued scan(s)...`);

        let successCount = 0;
        let failureCount = 0;

        for (const record of pending) {
            try {
                const result = await syncScanToSupabase(record.payload, record.idempotencyKey);
                if (result.status === 'OK' || result.status === 'DUPLICATE') {
                    await dequeueScan(record.idempotencyKey);
                    updateLastSyncTime(); // Track successful sync
                    successCount++;
                    console.log(`✅ Synced: ${record.payload.serial_number}`);
                } else {
                    await updateQueuedScan(record.idempotencyKey, buildQueueAttemptUpdates(record, result));
                    failureCount++;
                    console.warn(`⚠️ Sync not complete (${result.status}): ${record.payload.serial_number}`);
                    if (result.status === 'RETRYABLE') {
                        // Stop on retryable failures to avoid spamming the same outage.
                        break;
                    }
                }
            } catch (e) {
                const retryableResult = classifySyncResult({ networkError: true, errorMessage: e.message || 'Sync error' });
                await updateQueuedScan(record.idempotencyKey, buildQueueAttemptUpdates(record, retryableResult));
                failureCount++;
                console.error('Sync error:', e);
                break;
            }
        }

        // Trigger health check after flush attempt
        if (typeof forceHealthCheck === 'function') {
            forceHealthCheck();
        }

        updateQueueUI();

        // Log summary
        console.log(`📊 Flush complete: ${successCount} synced, ${failureCount} failed`);
    } finally {
        isFlushingQueue = false;
    }
}

/**
 * Direct sync to Supabase (used by queue flush)
 * Now with explicit timeout to prevent hanging
 */
async function lookupExistingScanCreatedAt(partId, serialNumber) {
    if (!partId || !serialNumber) return null;
    const params = new URLSearchParams({
        select: 'created_at',
        part_id: `eq.${partId}`,
        serial_number: `eq.${serialNumber}`,
        limit: '1'
    });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/scans?${params.toString()}`, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            signal: controller.signal
        });
        if (!response.ok) return null;
        const rows = await response.json().catch(() => []);
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return rows[0].created_at || null;
    } catch (e) {
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function syncScanToSupabase(payload, idempotencyKey) {
    const supabasePayload = {
        operator_name: payload.operator,
        station_id: payload.station,
        raw_scan: payload.raw_scan,
        part_id: payload.part_number,
        serial_number: payload.serial_number,
        batch_comment: payload.batch_comment,
        idempotency_key: idempotencyKey
    };

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout for sync

    try {
        // Use fetch directly for timeout control
        const response = await fetch(`${SUPABASE_URL}/rest/v1/scans`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify([supabasePayload]),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            return classifySyncResult({ httpStatus: response.status });
        }

        const errorData = await response.json().catch(() => ({}));
        const classified = classifySyncResult({
            httpStatus: response.status,
            errorCode: errorData.code,
            errorMessage: errorData.message || errorData.details || errorData.hint || response.statusText
        });

        if (classified.status === 'DUPLICATE') {
            const existingCreatedAt = await lookupExistingScanCreatedAt(
                payload.part_number,
                payload.serial_number
            );
            const ageStatus = classifyExistingScanConflict({ createdAt: existingCreatedAt });
            return makeSyncResult(ageStatus, classified);
        }

        return classified;
    } catch (e) {
        clearTimeout(timeoutId);

        // AbortError = timeout
        if (e.name === 'AbortError') {
            console.warn('Sync timeout - will retry later');
            return classifySyncResult({ timedOut: true, errorMessage: e.message || 'Sync timeout' });
        }

        console.error('Sync error:', e);
        return classifySyncResult({ networkError: true, errorMessage: e.message || 'Network error' });
    }
}

// Track last successful sync time
let lastSyncTime = localStorage.getItem('lastSyncTime') ? new Date(localStorage.getItem('lastSyncTime')) : null;

/**
 * Update sync time after successful sync
 */
function updateLastSyncTime() {
    lastSyncTime = new Date();
    localStorage.setItem('lastSyncTime', lastSyncTime.toISOString());
    updateSyncStatusUI();
}

/**
 * Format time as relative or absolute
 */
function formatSyncTime(date) {
    if (!date) return '—';
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);

    if (diffSec < 10) return 'Just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffMin < 60) return `${diffMin}m ago`;
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * Update UI to show pending queue count and sync status
 */
async function updateSyncStatusUI() {
    const count = await getPendingCount();
    const pendingDisplay = document.getElementById('pendingCountDisplay');
    const lastSyncedEl = document.getElementById('lastSyncedTime');
    const queueWarning = document.getElementById('queueWarning');
    const syncCard = document.getElementById('syncStatusCard');

    // Update pending count display
    if (pendingDisplay) {
        pendingDisplay.textContent = count;
        if (count > 0) {
            pendingDisplay.style.color = '#f59e0b'; // Orange/warning
        } else {
            pendingDisplay.style.color = '#10b981'; // Green/success
        }
    }

    // Update last synced time
    if (lastSyncedEl) {
        lastSyncedEl.textContent = formatSyncTime(lastSyncTime);
    }

    // Show/hide warning
    if (queueWarning) {
        queueWarning.style.display = count > 0 ? 'block' : 'none';
    }

    // Highlight card if pending
    if (syncCard) {
        if (count > 0) {
            syncCard.style.background = 'linear-gradient(135deg, #fef3c7, #fde68a)';
            syncCard.style.border = '2px solid #f59e0b';
        } else {
            syncCard.style.background = 'linear-gradient(135deg, #f0f9ff, #e0f2fe)';
            syncCard.style.border = '1px solid var(--border)';
        }
    }
}

/**
 * Legacy updateQueueUI - now calls updateSyncStatusUI
 */
async function updateQueueUI() {
    await updateSyncStatusUI();

    // Also update the old queueInfo element if it exists (backwards compat)
    const count = await getPendingCount();
    const queueInfo = document.getElementById('queueInfo');
    if (queueInfo) {
        queueInfo.innerHTML = ''; // Hidden, we use new sync card now
    }
}

// ===== BATTERY MONITORING =====
async function initBattery() {
    const batEl = document.getElementById('batteryStatus');
    if (!batEl) return;

    if ('getBattery' in navigator) {
        try {
            const battery = await navigator.getBattery();

            const updateBat = () => {
                const level = Math.round(battery.level * 100);
                const charging = battery.charging ? '⚡' : '🔋';
                batEl.textContent = `${charging} ${level}%`;

                // Color coding
                if (level <= 20) batEl.style.backgroundColor = '#ef4444'; // Red
                else if (level <= 50) batEl.style.backgroundColor = '#f59e0b'; // Orange
                else batEl.style.backgroundColor = '#6b7280'; // Gray
            };

            updateBat();
            battery.addEventListener('levelchange', updateBat);
            battery.addEventListener('chargingchange', updateBat);
        } catch (e) {
            console.warn('Battery API error:', e);
            batEl.textContent = '🔋 --%';
        }
    } else {
        batEl.textContent = '🔋 --%'; // Not supported
    }
}

// ===== LIVE CLOCK =====
function initClock() {
    const clockEl = document.getElementById('clockStatus');
    if (!clockEl) return;

    function update() {
        const now = new Date();
        // 12-hour format with AM/PM
        const timeString = now.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        clockEl.textContent = timeString;
    }

    update(); // Initial call
    setInterval(update, 1000); // Update every second
}

/**
 * Fetches Config (Operators, Stations, Part Map) from Supabase.
 */
async function fetchConfig() {
    console.log('🔄 Fetching config from Supabase...');
    try {
        await withTimeout((async () => {
            const { data: opsData, error: opsError } = await supabaseClient
                .from('operators')
                .select('name')
                .eq('active', true)
                .order('name');
            if (opsError) throw opsError;
            if (opsData) OPERATORS_LIST = opsData.map(o => o.name);

            const { data: stData, error: stError } = await supabaseClient
                .from('stations')
                .select('name')
                .eq('active', true)
                .order('name');
            if (stError) throw stError;
            if (stData) STATIONS_LIST = stData.map(s => s.name);

            const { data: pmData, error: pmError } = await supabaseClient
                .from('part_map')
                .select('barcode_prefix, part_number')
                .eq('active', true);
            if (pmError) throw pmError;
            if (pmData) {
                PART_NUMBER_MAP = {};
                pmData.forEach(row => {
                    PART_NUMBER_MAP[row.barcode_prefix] = row.part_number;
                });
            }
        })(), CONFIG_FETCH_TIMEOUT_MS);

        saveConfigCache();
        console.log(`✅ Loaded ${OPERATORS_LIST.length} operators, ${STATIONS_LIST.length} stations, ${Object.keys(PART_NUMBER_MAP).length} part mappings`);
        return true;
    } catch (e) {
        console.error('Config fetch error:', e);
        return false;
    }
}

// Alias for compatibility with initApp
const fetchPartNumberMap = fetchConfig;

function populateOperators() {
    const operatorSelect = $('#operator');
    if (!operatorSelect) return;
    const savedOperator = localStorage.getItem('operator');
    operatorSelect.innerHTML = '<option value="" disabled selected>Select Operator</option>';

    OPERATORS_LIST.forEach(op => {
        const option = document.createElement('option');
        option.value = op;
        option.textContent = op;
        operatorSelect.appendChild(option);
    });

    // Restore saved operator if it exists in the list
    if (savedOperator && OPERATORS_LIST.includes(savedOperator)) {
        operatorSelect.value = savedOperator;
    }
}

function populateStations() {
    const stationSelect = $('#station');
    if (!stationSelect) return;
    const savedStation = localStorage.getItem('station');
    stationSelect.innerHTML = '';

    STATIONS_LIST.forEach(station => {
        const option = document.createElement('option');
        option.value = station;
        option.textContent = station;
        stationSelect.appendChild(option);
    });

    // Restore saved station if it exists in the list
    if (savedStation && STATIONS_LIST.includes(savedStation)) {
        stationSelect.value = savedStation;
    } else {
        stationSelect.value = 'MAIN';
    }
}

// ===== DATE/TIME FORMATTING HELPERS =====
function formatDateMMDDYY(date) {
    const d = new Date(date);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return `${month}/${day}/${year}`;
}

function formatTimestamp(date) {
    const d = new Date(date);
    const dateStr = formatDateMMDDYY(d);
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `${dateStr} ${timeStr}`;
}

function getRelativeTime(date) {
    const now = new Date();
    const then = new Date(date);
    const diffMs = now - then;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);

    if (diffSec < 10) return 'Just now';
    if (diffSec < 60) return `${diffSec} secs ago`;
    if (diffMin === 1) return '1 min ago';
    if (diffMin < 60) return `${diffMin} mins ago`;
    if (diffHr === 1) return '1 hour ago';
    if (diffHr < 24) return `${diffHr} hours ago`;
    return formatDateMMDDYY(then);
}

// ===== HELPERS =====
let audioUnlocked = false;
function unlockAudioOnFirstTap() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    initAudio();
    document.body.removeEventListener('touchstart', unlockAudioOnFirstTap);
}

// ===== DOM Elements =====
const $ = s => document.querySelector(s);
const statusBox = $('#status'), lastSerial = $('#lastSerial'), lastPart = $('#lastPart');
const scanInput = $('#scan'), operatorInput = $('#operator'), stationSel = $('#station');
const clearBtn = $('#clearBtn');
const historyPanel = $('#historyPanel'); // v8.8.2: historyToggle removed - always expanded
const lastScanStatus = $('#lastScanStatus');
const lastScanTime = $('#lastScanTime');
const lastScanRelative = $('#lastScanRelative');
const lockBtn = $('#lockBtn'), unlockBtn = $('#unlockBtn')
const correctionModal = $('#correctionModal');
const modalContext = $('#modalContext');
const correctionText = $('#correctionText');
const btnCancelCorrection = $('#cancelCorrection');
const btnSaveCorrection = $('#saveCorrection');
// Batch Comment Elements
const generalNote = $('#generalNote');
const lockBatchBtn = $('#lockBatchBtn');
const clearNoteBtn = $('#clearNoteBtn');
let currentEditItem = null;

// Audio
let audioContext;
function initAudio() {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
}

function playBeep(freq, type = 'sine') {
    try {
        initAudio();
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain); gain.connect(audioContext.destination);
        osc.frequency.value = freq; osc.type = type;
        gain.gain.setValueAtTime(0.3, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
        osc.start(); osc.stop(audioContext.currentTime + 0.1);
    } catch (e) { }
}

function playSoundSuccess() {
    playBeep(880, 'sine');
    document.body.style.transition = 'background-color 0.3s';
    document.body.style.backgroundColor = '#10b981';
    setTimeout(() => { document.body.style.backgroundColor = ''; }, 300);
}

function playSoundDuplicate() {
    playBeep(440, 'sine');
    document.body.style.transition = 'background-color 0.3s';
    document.body.style.backgroundColor = '#f59e0b';
    setTimeout(() => { document.body.style.backgroundColor = ''; }, 300);
}

function playSoundError() {
    playBeep(220, 'sawtooth');
    document.body.style.transition = 'background-color 0.3s';
    document.body.style.backgroundColor = '#ef4444';
    setTimeout(() => { document.body.style.backgroundColor = ''; }, 300);
}

/**
 * Show validation rejection error with enhanced feedback
 * Used for client-side barcode validation failures
 */
function showValidationError(reason, rawBarcode = '') {
    // Visual: Extended red flash for emphasis
    document.body.style.transition = 'background-color 0.5s';
    document.body.style.backgroundColor = '#ef4444';

    // Audio: Error beep
    playSoundError();

    // Haptic: Error vibration pattern if available (SOS pattern)
    if (navigator.vibrate) {
        navigator.vibrate([100, 50, 100, 50, 100]);
    }

    // UI: Show error with specific message and barcode for troubleshooting
    const truncatedBarcode = rawBarcode.length > 30 ? rawBarcode.substring(0, 30) + '...' : rawBarcode;
    const errorMessage = rawBarcode
        ? `❌ SCAN REJECTED: ${reason}\n📋 Barcode: ${truncatedBarcode}`
        : `❌ INVALID SCAN: ${reason}`;

    show(errorMessage, 'err');

    // Extended red background for emphasis
    setTimeout(() => {
        document.body.style.backgroundColor = '';
    }, 800);

    // Log for analytics/debugging
    console.warn(`[VALIDATION REJECTED] ${reason}`, rawBarcode ? `Barcode: ${rawBarcode}` : '');
}

function show(msg, cls) {
    statusBox.textContent = msg;
    statusBox.className = 'status show ' + cls;
    setTimeout(() => statusBox.classList.remove('show'), 2500);
}

function savePrefs() {
    localStorage.setItem('operator', operatorInput.value.trim());
    localStorage.setItem('station', stationSel.value);
}

function loadPrefs() {
    // Load preferences after dropdowns are populated
    const savedOperator = localStorage.getItem('operator');
    const savedStation = localStorage.getItem('station');

    if (savedOperator) {
        operatorInput.value = savedOperator;
    }
    if (savedStation) {
        stationSel.value = savedStation;
    } else {
        stationSel.value = 'MAIN';
    }
}

// Save and restore lock states
function saveLockStates() {
    localStorage.setItem('operatorLocked', operatorInput.disabled ? 'true' : 'false');
    localStorage.setItem('batchLocked', generalNote.disabled ? 'true' : 'false');
    localStorage.setItem('batchComment', generalNote.value);
}

function restoreLockStates() {
    const operatorLocked = localStorage.getItem('operatorLocked') === 'true';
    const batchLocked = localStorage.getItem('batchLocked') === 'true';
    const savedBatchComment = localStorage.getItem('batchComment') || '';

    // Restore batch comment text
    if (generalNote) {
        generalNote.value = savedBatchComment;
    }

    // Restore operator/station lock state
    if (operatorLocked) {
        operatorInput.disabled = true;
        stationSel.disabled = true;
        lockBtn.style.display = 'none';
        unlockBtn.style.display = 'inline-flex';
    }

    // Restore batch comment lock state
    if (batchLocked && generalNote) {
        generalNote.disabled = true;
        lockBatchBtn.innerHTML = '🔓 Unlock Comment';
        lockBatchBtn.style.background = '#f59e0b';
        clearNoteBtn.disabled = true;
        clearNoteBtn.style.opacity = '0.5';
    }
}

// =======================================================
// PORTED PARSING LOGIC (from scripts/scan_api.py)
// =======================================================

/**
 * Clean serial number using Python-equivalent regex logic.
 * Handles delimiters like $ and + and preserves 5+ digit endings.
 */
function cleanSerialNumber(rawSerial) {
    if (!rawSerial) return "";
    let cleaned = String(rawSerial).trim();

    if (cleaned.startsWith("'")) cleaned = cleaned.substring(1);

    // Remove content after '$' or '+' (they are delimiters)
    if (cleaned.includes('$')) cleaned = cleaned.split('$')[0];
    if (cleaned.includes('+')) cleaned = cleaned.split('+')[0];

    // Regex: Capture prefix up until the last block of digits that has at least 5 digits.
    // This preserves serials like MGC1S17754 but strips trailing non-digit junk.
    const match = cleaned.match(/^(.*?)(\d{5,})[^0-9]*$/);

    if (match) {
        // Reconstruct: prefix + trailing 5+ digits
        // match[1] is prefix, match[2] is digits
        return (match[1] + match[2]).trim();
    } else {
        // Fallback: strip trailing non-digits
        return cleaned.replace(/[^0-9]+$/, '').trim();
    }
}

/**
 * Validates raw barcode data BEFORE parsing.
 * This is the fail-fast gate that prevents malformed scans from reaching the database.
 * @param {string} rawScan - The raw barcode string from the scanner
 * @returns {{ valid: boolean, reason?: string }} - Validation result
 */
function validateRawBarcode(rawScan) {
    if (!rawScan || typeof rawScan !== 'string') {
        return { valid: false, reason: 'Empty scan' };
    }

    const cleaned = rawScan.trim().replace(/[\x00-\x1F\x7F]/g, '');

    // Check minimum length
    if (cleaned.length < BARCODE_VALIDATION.MIN_RAW_LENGTH) {
        return {
            valid: false,
            reason: `Too short: ${cleaned.length} chars (need ${BARCODE_VALIDATION.MIN_RAW_LENGTH}+)`
        };
    }

    // Check for suspicious characters (scanner errors)
    if (BARCODE_VALIDATION.SUSPICIOUS_CHARS.test(cleaned)) {
        return {
            valid: false,
            reason: 'Contains invalid characters - possible scanner error'
        };
    }

    // Detect format
    const isGS1 = cleaned.startsWith('01');
    const isHIBC = cleaned.includes('/$+');

    if (!isGS1 && !isHIBC) {
        // Could be a custom format serial (MGC, R756, etc.) - allow if long enough
        if (cleaned.length >= BARCODE_VALIDATION.MIN_RAW_LENGTH) {
            return { valid: true };  // Custom format, passes length check
        }
        return { valid: false, reason: 'Unknown barcode format' };
    }


    // Format-specific validation
    if (isGS1 && cleaned.length < BARCODE_VALIDATION.FORMATS.GS1_128.minLength) {
        return {
            valid: false,
            reason: `GS1-128 too short: ${cleaned.length} chars (need ${BARCODE_VALIDATION.FORMATS.GS1_128.minLength}+)`
        };
    }

    if (isHIBC && cleaned.length < BARCODE_VALIDATION.FORMATS.HIBC.minLength) {
        return {
            valid: false,
            reason: `HIBC too short: ${cleaned.length} chars (need ${BARCODE_VALIDATION.FORMATS.HIBC.minLength}+)`
        };
    }

    return { valid: true };
}

function looksLikeTruncatedGs1(raw) {
    if (!raw || typeof raw !== 'string') return false;
    const s = raw.toUpperCase().trim();
    if (s.includes('/$+')) return false;
    if (/(?:11|17|13)\d{6}21[A-Z0-9]/.test(s) || /21(?:MGCK|MGC|PUL|R756|EBS|FIL)/.test(s)) {
        if (!s.startsWith('01')) return true;
        // 01-prefixed but internally chopped (GTIN digits missing) still needs recovery.
        const prefix = s.substring(0, 16);
        if (!PART_NUMBER_MAP[prefix]) return true;
    }
    return false;
}

function recoverTruncatedGs1(raw, partMap) {
    if (!raw) return null;
    const s = String(raw).toUpperCase().trim();
    if (s.includes('/$+')) return null;

    const serialMatch = s.match(/(?:11|17|13)\d{6}21([A-Z0-9]+)$/)
        || s.match(/21((?:MGCK|MGC|PUL|R756|EBS|FIL)[A-Z0-9]+)$/);
    const serial = serialMatch ? serialMatch[1] : '';

    let part = null;
    let bestLen = 0;
    const map = partMap || {};
    for (const prefix of Object.keys(map)) {
        const gtin = prefix.startsWith('01') ? prefix.slice(2) : prefix;
        const needles = [gtin, gtin.slice(1), gtin.slice(2), gtin.replace(/^0+/, '')];
        for (const needle of needles) {
            if (needle && needle.length >= 6 && s.includes(needle) && needle.length > bestLen) {
                part = map[prefix];
                bestLen = needle.length;
            }
        }
    }

    if (!part && serial) {
        part = extractPartFromSerial(serial);
        if (part === 'MGC' && /^MGC2\d/.test(serial)) part = '536713-002';
        if (part === 'MGC' && /^MGCK1\d/.test(serial)) part = '536719-001';
    }

    if (!part || !serial || part === 'UNKNOWN') return null;
    return { part, serial };
}

/**
 * Auto-detect part number from serial prefix.
 * Ported from extract_part_from_serial in python.
 */
function extractPartFromSerial(serial) {
    if (!serial) return null;
    const s = serial.toUpperCase();

    // MGC patterns (Medgraphics)
    if (s.startsWith('MGC1S')) return '536713-001S';
    if (s.startsWith('MGC2S')) return '536713-002S';
    if (s.startsWith('MGC1C')) return '536713-001C';
    if (s.startsWith('MGC2C')) return '536713-002C';
    if (s.startsWith('MGCK1S')) return '536719-001S';
    if (s.startsWith('MGCK')) return '536719-001';
    if (s.startsWith('MGC')) return 'MGC';

    // Respitech R756 patterns
    if (s.startsWith('R756EL')) return 'R756EL';
    if (s.startsWith('R756EW')) return 'R756EW';
    if (s.startsWith('R756E2')) return 'R756E2';
    if (s.startsWith('R756W')) return 'R756W';
    if (s.startsWith('R756')) return 'R756';

    // Standard 756 patterns
    if (s.startsWith('756EL')) return '100756EL';
    if (s.startsWith('756EW')) return '100756EW';
    if (s.startsWith('756E2')) return '100756E2';
    if (s.startsWith('756NW')) return '100756NW';
    if (s.startsWith('756NKNW')) return '100756NKNW';
    if (s.startsWith('756')) return '100756';

    // PFT Diagnostics patterns
    if (s.startsWith('1100E')) return 'P5551100E';
    if (s.startsWith('1100')) return 'P5551100';
    if (s.startsWith('3100E')) return 'P5553100E';
    if (s.startsWith('3100')) return 'P5553100';
    if (s.startsWith('4100E')) return 'P5554100E';
    if (s.startsWith('4100')) return 'P5554100';
    if (s.startsWith('6100E')) return 'P5556100E';
    if (s.startsWith('6100')) return 'P5556100';
    if (s.startsWith('7100E')) return 'P5557100E';
    if (s.startsWith('7100')) return 'P5557100';
    if (s.startsWith('9100E')) return 'P5559100E';
    if (s.startsWith('9100')) return 'P5559100';

    // PulmOne patterns
    if (s.startsWith('PUL9000N')) return 'PUL9000N';
    if (s.startsWith('PUL9000E2')) return 'PUL9000E2';
    if (s.startsWith('PUL9000K')) return 'PUL9000K';
    if (s.startsWith('LPUL9000K')) return 'LPUL9000K';
    if (s.startsWith('PUL')) return 'PUL9000';

    // EBS patterns
    if (s.startsWith('EBS756')) return 'EBS756';
    if (s.startsWith('EBS757')) return 'EBS757';
    if (s.startsWith('EBS758')) return 'EBS758';
    if (s.startsWith('EBS759')) return 'EBS759';
    if (s.startsWith('EBS780')) return 'EBS780';
    if (s.startsWith('EBS')) return 'EBS';

    // Morgan FIL patterns
    if (s.startsWith('FIL7958')) return 'FIL7958';
    if (s.startsWith('FIL9000')) return 'FIL9000';
    if (s.startsWith('FIL5050EL')) return 'FIL5050EL';
    if (s.startsWith('FIL')) return 'FIL';

    return null;
}

/**
 * Apply product-specific serial number extraction rules.
 * This handles cases where certain products have specific patterns (e.g., fixed digit count after prefix).
 * @param {string} partCode - The part number code (e.g., 'PUL9000K')
 * @param {string} serial - The serial number extracted from barcode
 * @returns {string} - The extracted serial number (or original if no rule applies)
 */
function applyProductSpecificSerialExtraction(partCode, serial) {
    if (!partCode || !serial) return serial;

    const rule = PRODUCT_SERIAL_RULES[partCode];
    if (!rule) return serial;

    const match = serial.match(rule.pattern);
    if (match && match[rule.extractGroup]) {
        const extracted = match[rule.extractGroup];
        console.log(`📋 Product Rule Applied: ${partCode} → "${serial}" → "${extracted}"`);
        return extracted;
    }

    return serial;
}

function parsePN_SN(s) {
    const raw = String(s).toUpperCase().trim();

    // GS1-128 FORMAT (Starts with 01)
    if (raw.startsWith('01')) {
        const prefix = raw.substring(0, 16);
        let part = PART_NUMBER_MAP[prefix];
        let remainder = raw.substring(16);
        let serial = '';

        if (remainder.startsWith('11') || remainder.startsWith('17') || remainder.startsWith('13')) {
            remainder = remainder.substring(8);
        }
        if (remainder.startsWith('21')) {
            serial = remainder.substring(2);
        } else {
            serial = remainder;
        }

        if (!part && serial) {
            // Try to find part inside the serial using PFR logic
            const pfrMatch = serial.match(/^(PFR[A-Z0-9]{3,10})/i);
            if (pfrMatch) {
                const identifiedPartId = pfrMatch[1].toUpperCase();
                part = identifiedPartId;
                serial = serial.substring(identifiedPartId.length);
                if (!serial) {
                    serial = identifiedPartId;
                } else {
                    serial = serial.replace(/^[^A-Z0-9]+/, '');
                }
                return { part, serial };
            }
        }
        return sectionResult(part, serial);
    }

    // HIBC FORMAT (Contains /$+)
    if (raw.includes('/$+')) {
        const parts = raw.split('/$+');
        if (parts.length < 2) return { part: '', serial: '' };
        let p = parts[0], sNum = parts[1];

        if (p.startsWith('+B')) {
            p = p.substring(1);
            if (p.startsWith('B')) p = p.substring(1);
            if (sNum.startsWith('+')) sNum = sNum.substring(1);
        } else {
            if (sNum.startsWith('+')) sNum = sNum.substring(1);
        }

        // Resolve part id before stripping so we can use part-specific strip threshold (v8.6.6)
        let partForStrip = p;
        if (p.startsWith('446') && p.length > 4) {
            if (p === '4461007801') partForStrip = '100780W';
            else if (p.includes('PUL') || p.endsWith('1') || p.endsWith('0')) partForStrip = p.substring(3, p.length - 1);
        }

        // HIBC Check Digit Stripping (v8.6.4 / v8.6.6 part-aware):
        // HIBC standard: Serial format is PART_PREFIX + N-DIGIT-SERIAL + optional CHECK_DIGIT
        // Rule: Strip the last character ONLY IF:
        //   1. Last char is a LETTER or SPECIAL CHAR (unambiguous check digit), OR
        //   2. Last char is DIGIT AND there are >maxTrailing chars after the last letter (part-specific)
        // Parts like 100759E2 (759E+7 digits) use maxTrailing=7 so we don't strip the final serial digit
        if (sNum.length > 1) {
            const lastChar = sNum.charAt(sNum.length - 1);
            const isLetter = /^[A-Z]$/i.test(lastChar);
            const isSpecialChar = /^[\-\.\$\/\+\%]$/.test(lastChar);

            if (isLetter || isSpecialChar) {
                sNum = sNum.substring(0, sNum.length - 1);
            } else {
                const letterMatches = sNum.match(/[A-Z]/gi);
                if (letterMatches) {
                    const lastLetter = letterMatches[letterMatches.length - 1];
                    const lastLetterPos = sNum.lastIndexOf(lastLetter);
                    const trailingChars = sNum.substring(lastLetterPos + 1);
                    const maxTrailing = (BARCODE_VALIDATION.HIBC_MAX_TRAILING_BEFORE_STRIP && BARCODE_VALIDATION.HIBC_MAX_TRAILING_BEFORE_STRIP[partForStrip]) ?? 5;
                    if (trailingChars.length > maxTrailing) {
                        sNum = sNum.substring(0, sNum.length - 1);
                    }
                }
                // All-numeric serial: keep the last digit. HIBC check chars that
                // actually arrived are letters or -. $/+% and were stripped above.
                // Stripping here deleted real serial digits when the gun omitted `$`.
            }
        }

        // Apply 446 → part id for downstream
        if (p.startsWith('446') && p.length > 4) {
            if (p === '4461007801') p = '100780W';
            else if (p.includes('PUL') || p.endsWith('1') || p.endsWith('0')) p = p.substring(3, p.length - 1);
        }

        // Apply product-specific serial extraction rules (v8.6.6)
        // This handles cases like PUL9000K where we need to extract exactly N digits after prefix
        const extractedSerial = applyProductSpecificSerialExtraction(p, sNum);

        return sectionResult(p, extractedSerial);
    }

    return { part: '', serial: '' };
}

function sectionResult(part, serial) {
    return part ? { part, serial } : { part: 'UNKNOWN', serial };
}

// History and Status helpers
function getLastScanKey() {
    const op = operatorInput.value.trim() || 'UNNAMED';
    const st = stationSel.value || 'MAIN';
    return `lastScan_${op}_${st}`;
}

function saveLastScan(part, serial, status) {
    const key = getLastScanKey();
    const scanData = { part, serial, status, timestamp: new Date().toISOString() };
    localStorage.setItem(key, JSON.stringify(scanData));
    updateLastScanDisplay(scanData);
}

function updateLastScanDisplay(data) {
    if (!data) {
        lastPart.textContent = '—';
        lastSerial.textContent = '—';
        lastScanStatus.textContent = '';
        if (lastScanTime) lastScanTime.textContent = '';
        if (lastScanRelative) lastScanRelative.textContent = '';
        return;
    }

    lastPart.textContent = data.part || '—';
    lastSerial.textContent = data.serial || '—';
    lastScanStatus.textContent = data.status || '';

    // Status styling
    if (data.status === 'OK') {
        lastScanStatus.style.cssText = 'background:#d1fae5; color:#065f46;';
    } else if (data.status === 'DUPLICATE') {
        lastScanStatus.style.cssText = 'background:#fef3c7; color:#92400e;';
    } else if (data.status === 'QUEUED') {
        lastScanStatus.style.cssText = 'background:#dbeafe; color:#1e40af;';
    } else {
        lastScanStatus.style.cssText = 'background:#fee2e2; color:#991b1b;';
    }

    if (data.timestamp) {
        if (lastScanTime) lastScanTime.textContent = formatTimestamp(data.timestamp);
        if (lastScanRelative) lastScanRelative.textContent = getRelativeTime(data.timestamp);
    }
}

/**
 * Load last scan from multiple sources (v8.8.2 enhanced)
 * Sources checked in order:
 * 1. localStorage (fastest, previous sessions)
 * 2. Queued scans (offline scans not yet synced)
 * 3. Supabase (cloud database, if online)
 * Uses the most recent across all sources
 */
async function loadLastScan() {
    const key = getLastScanKey();
    let mostRecent = null;
    let mostRecentTime = 0;

    // Source 1: localStorage (previous sessions)
    const stored = localStorage.getItem(key);
    if (stored) {
        try {
            const data = JSON.parse(stored);
            if (data.timestamp) {
                const storedTime = new Date(data.timestamp).getTime();
                if (storedTime > mostRecentTime) {
                    mostRecent = data;
                    mostRecentTime = storedTime;
                }
            }
        } catch (e) {
            console.warn('Failed to parse stored last scan:', e);
        }
    }

    // Source 2: Queued scans (offline scans)
    try {
        const pending = await getPendingScans();
        const currentOp = operatorInput.value || 'UNNAMED';
        const currentSt = stationSel.value || 'MAIN';

        // Filter queued scans for current operator/station
        const myQueuedScans = pending.filter(q =>
            q.payload.operator === currentOp && q.payload.station === currentSt
        );

        if (myQueuedScans.length > 0) {
            // Get the most recent queued scan
            const latestQueued = myQueuedScans[myQueuedScans.length - 1]; // Last in array = most recent
            const queuedTime = latestQueued.timestamp || Date.now();

            if (queuedTime > mostRecentTime) {
                mostRecent = {
                    part: latestQueued.payload.part_number,
                    serial: latestQueued.payload.serial_number,
                    status: 'QUEUED',
                    timestamp: new Date(queuedTime).toISOString()
                };
                mostRecentTime = queuedTime;
            }
        }
    } catch (e) {
        console.warn('Failed to check queued scans for last scan:', e);
    }

    // Source 3: Supabase (cloud database) - only if online
    if (navigator.onLine && typeof getConnectivityStatus === 'function') {
        const connectivity = getConnectivityStatus();
        if (connectivity.supabaseReachable !== false) {
            try {
                const currentOp = operatorInput.value || 'UNNAMED';
                const currentSt = stationSel.value || 'MAIN';

                const { data, error } = await supabaseClient
                    .from('scans')
                    .select('part_id, serial_number, created_at')
                    .eq('operator_name', currentOp)
                    .eq('station_id', currentSt)
                    .order('created_at', { ascending: false })
                    .limit(1);

                if (!error && data && data.length > 0) {
                    const dbScan = data[0];
                    const dbTime = new Date(dbScan.created_at).getTime();

                    if (dbTime > mostRecentTime) {
                        mostRecent = {
                            part: dbScan.part_id,
                            serial: dbScan.serial_number,
                            status: 'OK', // From database = synced
                            timestamp: dbScan.created_at
                        };
                        mostRecentTime = dbTime;
                    }
                }
            } catch (e) {
                console.warn('Failed to fetch last scan from Supabase:', e);
            }
        }
    }

    // Update display with the most recent across all sources
    updateLastScanDisplay(mostRecent);

    // Save to localStorage for next time
    if (mostRecent) {
        localStorage.setItem(key, JSON.stringify(mostRecent));
    }
}

// Update relative time every 30 seconds
let relativeTimeInterval;
function startRelativeTimeUpdates() {
    if (relativeTimeInterval) clearInterval(relativeTimeInterval);
    relativeTimeInterval = setInterval(() => {
        const key = getLastScanKey();
        const stored = localStorage.getItem(key);
        if (stored && lastScanRelative) {
            try {
                const data = JSON.parse(stored);
                if (data.timestamp) {
                    lastScanRelative.textContent = getRelativeTime(data.timestamp);
                }
            } catch (e) { }
        }
    }, 30000);
}
startRelativeTimeUpdates();

// ===== REMOTE HISTORY (Supabase) =====
let currentHistory = [];

async function fetchHistory() {
    const op = operatorInput.value;
    const st = stationSel.value;

    if (!op || !st) {
        historyPanel.innerHTML = '<div style="padding:12px;color:#888">Select Operator and Station to view history.</div>';
        return;
    }

    // Loading indicator
    const loadLabel = document.createElement('div');
    loadLabel.textContent = 'Refreshing history...';
    loadLabel.style.padding = '12px';
    loadLabel.style.color = '#aa';
    historyPanel.innerHTML = '';
    historyPanel.appendChild(loadLabel);

    try {
        const { data, error } = await supabaseClient
            .from('scans')
            .select('*')
            .eq('operator_name', op)
            .eq('station_id', st)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;

        if (data) {
            currentHistory = data.map(row => ({
                part: row.part_id,
                serial: row.serial_number,
                status: 'OK', // Records in DB are by definition successful
                timestamp: row.created_at
            }));
            renderHistory();
        }
    } catch (e) {
        console.error('History Error:', e);
        historyPanel.innerHTML = '<div style="padding:12px;color:var(--error)">Error loading history.</div>';
    }
}

// Just updates the local view optimistically (for immediate feedback)
// The actual source of truth is Supabase, which we can refresh.
function addToHistory(item) {
    currentHistory.unshift(item);
    renderHistory();
}

function renderHistory() {
    historyPanel.innerHTML = '';
    if (!currentHistory.length) {
        historyPanel.innerHTML = '<div style="padding:12px;color:#888">No scans found for this operator/station.</div>';
        return;
    }

    currentHistory.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';

        // Status Logic
        let statusClass = (item.status || 'OK').toLowerCase();
        if (statusClass.includes('dup')) statusClass = 'dup';
        else if (statusClass.includes('err') || statusClass.includes('off') || statusClass.includes('queued')) statusClass = 'queued';
        else statusClass = 'ok';

        let badgeStyle = '';
        if (statusClass === 'ok') badgeStyle = 'background:#d1fae5; color:#065f46;';
        if (statusClass === 'dup') badgeStyle = 'background:#fef3c7; color:#92400e;';
        if (statusClass === 'queued') badgeStyle = 'background:#dbeafe; color:#1e40af;';

        const partCol = document.createElement('div');
        partCol.className = 'scan-data-col';
        partCol.innerHTML = '<div class="data-label">Ref</div><div class="history-part-num"></div>';
        partCol.querySelector('.history-part-num').textContent = item.part;

        const serialCol = document.createElement('div');
        serialCol.className = 'scan-data-col';
        serialCol.innerHTML = '<div class="data-label">Serial</div><div class="history-serial-num"></div>';
        serialCol.querySelector('.history-serial-num').textContent = item.serial;

        const statusCol = document.createElement('div');
        statusCol.className = 'scan-data-col';
        statusCol.innerHTML = '<div class="data-label">Status</div><div class="history-status"></div><div class="history-time"></div>';
        const statusEl = statusCol.querySelector('.history-status');
        statusEl.textContent = item.status || 'OK';
        statusEl.style.cssText = badgeStyle;
        statusCol.querySelector('.history-time').textContent = formatTimestamp(item.timestamp);

        div.appendChild(partCol);
        div.appendChild(serialCol);
        div.appendChild(statusCol);

        historyPanel.appendChild(div);
    });
}

// ===== CONNECTIVITY =====
// NOTE: Network status is now managed by supabase-health.js
// This section is kept for backwards compatibility but is largely superseded

// Legacy function - now delegated to supabase-health.js
function updateNetworkStatus(online) {
    // This is now handled by supabase-health.js
    // Kept for backwards compatibility
    console.warn('updateNetworkStatus() is deprecated - use supabase-health.js');
}

// Legacy event listeners - now in supabase-health.js
// These are kept as backup in case supabase-health.js fails to load
window.addEventListener('online', () => {
    // Trigger immediate health check and flush
    if (typeof forceHealthCheck === 'function') {
        forceHealthCheck();
    }
    setTimeout(flushQueue, 1000);
});

window.addEventListener('offline', () => {
    if (typeof updateConnectivityUI === 'function') {
        updateConnectivityUI();
    }
});

// === Send Function - OFFLINE-FIRST v8.8.2 ===
// 1. Check Supabase reachability (if available)
// 2. Queue locally FIRST (guaranteed persistence)
// 3. Attempt immediate sync ONLY if Supabase is reachable
// 4. Return status for UI feedback
async function send(payload) {
    // Generate idempotency key: serial + station + timestamp
    const idempotencyKey = `${payload.serial_number}-${payload.station}-${Date.now()}`;
    let queuedRecord = null;

    // Always queue locally first (guarantees no scan loss)
    try {
        queuedRecord = await queueScan(payload, idempotencyKey);
        console.log(`📦 Queued: ${payload.serial_number}`);
    } catch (e) {
        console.error('Queue error:', e);
        // Even if queue fails, try network
    }

    // Update queue UI
    updateQueueUI();

    // Check internet connectivity
    if (!navigator.onLine) {
        console.log('📶 No internet - scan queued');
        return 'QUEUED';
    }

    // Check Supabase reachability (if health check is available)
    let supabaseReachable = true; // Default to true if health check not loaded
    if (typeof getConnectivityStatus === 'function') {
        const status = getConnectivityStatus();
        if (status.supabaseReachable === false) {
            console.log('☁️ Supabase unreachable - scan queued');
            return 'QUEUED';
        }
        supabaseReachable = status.supabaseReachable;
    }

    // Attempt immediate sync if reachable
    if (supabaseReachable === true) {
        try {
            const result = await syncScanToSupabase(payload, idempotencyKey);

            if (result.status === 'OK' || result.status === 'DUPLICATE') {
                // Successfully synced - remove from queue
                await dequeueScan(idempotencyKey);
                updateQueueUI();
                updateLastSyncTime(); // Track successful sync

                // Trigger health check update on success
                if (typeof forceHealthCheck === 'function') {
                    forceHealthCheck();
                }

                return result.status;
            } else {
                // Failed to sync - stays in queue for later
                if (queuedRecord) {
                    await updateQueuedScan(idempotencyKey, buildQueueAttemptUpdates(queuedRecord, result));
                    updateQueueUI();
                }
                console.warn('⚠️ Sync failed - scan queued');
                return 'QUEUED';
            }
        } catch (e) {
            if (queuedRecord) {
                const retryableResult = classifySyncResult({ networkError: true, errorMessage: e.message || 'Sync error' });
                await updateQueuedScan(idempotencyKey, buildQueueAttemptUpdates(queuedRecord, retryableResult));
                updateQueueUI();
            }
            console.error('Sync error:', e);
            return 'QUEUED';
        }
    }

    // Supabase not reachable - scan is queued
    return 'QUEUED';
}

// Scan lock to prevent double-scanning
let isProcessing = false;
let processingTimeout = null;

function unlockScanner() {
    if (processingTimeout) {
        clearTimeout(processingTimeout);
        processingTimeout = null;
    }
    isProcessing = false;
    scanInput.disabled = false;
    scanInput.style.opacity = '1';
    scanInput.focus();
}

scanInput.addEventListener('keydown', async (ev) => {
    if (ev.key !== 'Enter') return;
    if (isProcessing) {
        console.log('⚠️ Scan blocked: Already processing');
        playSoundError();
        return;
    }

    let raw = scanInput.value.trim();
    if (!raw) return;

    console.log('📥 Scan received:', raw); // Debug: log raw scan

    // Sanitize
    raw = raw.replace(/[\x00-\x1F\x7F]/g, '');
    if (raw.startsWith("'")) raw = raw.substring(1);

    // ===== VALIDATION GATE (v8.6.0) =====
    // Fail-fast: Reject malformed barcodes BEFORE they reach the database
    const validation = validateRawBarcode(raw);
    if (!validation.valid) {
        console.log('❌ Validation failed:', validation.reason); // Debug: log validation failure
        showValidationError(validation.reason, raw);
        scanInput.value = '';  // Clear for immediate rescan
        scanInput.focus();
        return;  // FAIL FAST - never reaches database
    }
    console.log('✅ Validation passed'); // Debug: validation OK
    // ===== END VALIDATION GATE =====

    // 1. Try GS1 / HIBC Parsing
    let parsed = parsePN_SN(raw);
    console.log('📋 Parsed result:', parsed); // Debug: log parsed result

    // 2. Fallback / Custom Logic Parsing
    // If no part detected or empty serial, try to treat raw as the serial and extract part
    if (!parsed.part || parsed.part === 'UNKNOWN' || !parsed.serial) {
        // If GS1/HIBC didn't give us a clear serial, use the raw input as the potential serial
        const candidateSerial = parsed.serial || cleanSerialNumber(raw);

        // Try to extract part from this candidate serial (MGC, R756, etc.)
        const extractedPart = extractPartFromSerial(candidateSerial);

        if (extractedPart) {
            parsed.part = extractedPart;
            parsed.serial = candidateSerial;
        } else {
            parsed.serial = candidateSerial;
        }
    }

    if (!parsed.part || parsed.part === 'UNKNOWN') {
        const recovered = recoverTruncatedGs1(raw, PART_NUMBER_MAP);
        if (recovered) {
            console.log('🔧 Recovered truncated GS1:', recovered);
            parsed.part = recovered.part;
            parsed.serial = recovered.serial;
        }
    }

    // Final Clean
    const cleanedSerial = cleanSerialNumber(parsed.serial); // Apply final robust cleaning
    const cleanedPart = parsed.part || 'UNKNOWN';

    if (!cleanedSerial) {
        show('INVALID FORMAT', 'err');
        playSoundError();
        return;
    }

    if (!cleanedPart || cleanedPart === 'UNKNOWN') {
        const reason = looksLikeTruncatedGs1(raw)
            ? 'Incomplete barcode — rescan the full label'
            : 'Unknown part number — rescan the full label';
        console.log('❌ UNKNOWN part blocked:', reason, raw);
        showValidationError(reason, raw);
        scanInput.value = '';
        scanInput.focus();
        return;
    }

    // ===== CLIENT-SIDE DUPLICATE CHECK (v8.8.2) =====
    // Check if this serial was recently scanned by the same operator
    // Works both online AND offline - prevents double-scans in a session
    const currentOperator = operatorInput.value || 'UNNAMED';
    console.log('🔍 Checking duplicate for operator:', currentOperator, 'serial:', cleanedSerial); // Debug
    if (typeof isDuplicateScan === 'function' && isDuplicateScan(currentOperator, cleanedSerial)) {
        console.log('⚠️ Duplicate detected - blocking scan'); // Debug
        show('⚠️ DUPLICATE (recent scan)', 'dup');
        playSoundDuplicate();
        scanInput.value = '';
        scanInput.focus();
        return;  // DUPLICATE - stop here, don't queue or sync
    }
    console.log('✅ Not a duplicate - proceeding'); // Debug
    // ===== END DUPLICATE CHECK =====

    // LOCK scanner
    scanInput.value = '';
    clearBtn.style.display = 'none';
    isProcessing = true;
    scanInput.disabled = true;
    scanInput.style.opacity = '0.5';

    // SAFETY TIMEOUT
    processingTimeout = setTimeout(() => {
        show('⚠️ Timeout - Please retry scan', 'dup');
        playSoundError();
        unlockScanner();
    }, 35000);

    try {
        show('⏳ Sending...', 'queued');

        lastPart.textContent = cleanedPart || 'N/A';
        lastSerial.textContent = cleanedSerial;
        lastScanStatus.textContent = 'SENDING';
        lastScanStatus.style.cssText = 'background:#dbeafe; color:#1e40af;';
        if (lastScanTime) lastScanTime.textContent = 'Sending...';
        if (lastScanRelative) lastScanRelative.textContent = '';

        const payload = {
            operator: currentOperator,
            station: stationSel.value,
            raw_scan: raw,
            part_number: cleanedPart,
            serial_number: cleanedSerial,
            batch_comment: $('#generalNote').value || '' // Capture Batch Comment
        };

        const status = await send(payload);

        lastScanStatus.textContent = status;

        if (status === 'OK') {
            lastScanStatus.style.cssText = 'background:#d1fae5; color:#065f46;';
            playSoundSuccess();
            show('✅ SAVED', 'ok');
            // Add to client-side cache for duplicate detection
            if (typeof addScanToCache === 'function') {
                addScanToCache(currentOperator, cleanedSerial);
            }
        } else if (status === 'DUPLICATE') {
            lastScanStatus.style.cssText = 'background:#fef3c7; color:#92400e;';
            playSoundDuplicate();
            show('⚠️ DUPLICATE', 'dup');
            // Also add duplicates to cache to prevent repeated attempts
            if (typeof addScanToCache === 'function') {
                addScanToCache(currentOperator, cleanedSerial);
            }
        } else if (status === 'QUEUED') {
            // QUEUED is a success state - scan is saved locally, will sync later
            lastScanStatus.style.cssText = 'background:#dbeafe; color:#1e40af;';
            playSoundSuccess(); // Success beep - scan IS saved (locally)
            show('📤 QUEUED (will sync)', 'queued');
            // Add to client-side cache even when queued (offline duplicate protection)
            if (typeof addScanToCache === 'function') {
                addScanToCache(currentOperator, cleanedSerial);
            }
        } else {
            lastScanStatus.style.cssText = 'background:#fee2e2; color:#991b1b;';
            lastScanStatus.textContent = 'ERROR';
            playSoundError();
            show('❌ ERROR', 'err');
        }

        saveLastScan(cleanedPart, cleanedSerial, status);
        addToHistory({
            part: cleanedPart,
            serial: cleanedSerial,
            status: status,
            timestamp: new Date().toISOString()
        });

    } catch (e) {
        console.error(e);
        lastScanStatus.textContent = 'ERR';
        playSoundError();
        show('❌ ERROR', 'err');
    } finally {
        unlockScanner();
    }
});

// Handle scan field clear button
scanInput.addEventListener('input', () => {
    clearBtn.style.display = scanInput.value ? 'flex' : 'none';
});
clearBtn.addEventListener('click', () => {
    scanInput.value = '';
    clearBtn.style.display = 'none';
    scanInput.focus();
});

// Initialization
async function initApp() {
    initBattery(); // Start Battery Monitor
    initClock(); // Start Live Clock

    // Initialize offline queue
    try {
        await initOfflineQueue();
        updateQueueUI();
        // Flush any pending scans from previous session
        if (navigator.onLine) {
            setTimeout(flushQueue, 2000);
        }
    } catch (e) {
        console.warn('Queue init failed:', e);
    }

    // Start Supabase health checks (v8.8.2)
    if (typeof startHealthChecks === 'function') {
        startHealthChecks();
        // Show new status badges
        const internetBadge = document.getElementById('internetStatus');
        const supabaseBadge = document.getElementById('supabaseStatus');
        if (internetBadge) internetBadge.style.display = 'inline-block';
        if (supabaseBadge) supabaseBadge.style.display = 'inline-block';
    }

    applyConfigCache();
    populateOperators();
    populateStations();
    restoreLockStates();

    scanInput.disabled = false;
    scanInput.classList.add('ready');
    scanInput.placeholder = '✅ Ready to scan';

    fetchConfig()
        .then((ok) => {
            if (ok) {
                populateOperators();
                populateStations();
                restoreLockStates();
            }
        })
        .catch((err) => console.warn('Background config fetch failed:', err));

    loadLastScan().catch(err => console.warn('Failed to load last scan:', err));
    fetchHistory();

    // Register Service Worker for PWA caching (v8.8.2 enhanced)
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./service-worker.js')
            .then(reg => {
                console.log('📦 Service Worker registered:', reg.scope);

                // Listen for service worker updates
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    console.log('🔄 New service worker found, installing...');

                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // New service worker is ready, waiting to activate
                            console.log('✅ New service worker ready, will reload page');

                            // Show a brief notification to user
                            showUpdateNotification();

                            // Automatically reload after 2 seconds to get the update
                            setTimeout(() => {
                                // Tell the new service worker to skip waiting and become active
                                newWorker.postMessage({ type: 'SKIP_WAITING' });
                            }, 1500);

                            // Wait for the new worker to activate, then reload
                            newWorker.addEventListener('controllerchange', () => {
                                console.log('✅ New service worker activated, reloading page');
                                window.location.reload();
                            });
                        }
                    });
                });

                // Listen for messages from service worker
                navigator.serviceWorker.addEventListener('message', event => {
                    if (event.data && event.data.type === 'SERVICE_WORKER_UPDATE') {
                        console.log(`📢 Service worker update available: ${event.data.version}`);

                        // Show notification and reload immediately
                        showUpdateNotification();
                        // Force reload to get the new version
                        window.location.reload();
                    }
                });
            })
            .catch(err => console.error('❌ Service Worker registration failed:', err));
    }

    console.log('🚀 App initialized');
}

// Show update notification to user (v8.8.2)
function showUpdateNotification() {
    // v8.8.2: Simplified - just log to console, no banner
    console.log('📢 New version available - page will reload');
}

initApp();

// Modals & Listeners
// Refresh history when user changes Operator or Station
operatorInput.addEventListener('change', async () => {
    savePrefs();
    fetchHistory();
    await loadLastScan(); // v8.8.2: Reload last scan when operator changes
});

stationSel.addEventListener('change', async () => {
    savePrefs();
    fetchHistory();
    await loadLastScan(); // v8.8.2: Reload last scan when station changes
});

lockBtn.addEventListener('click', () => {
    operatorInput.disabled = true;
    stationSel.disabled = true;
    lockBtn.style.display = 'none';
    unlockBtn.style.display = 'inline-flex';
    savePrefs();
    saveLockStates();
});

unlockBtn.addEventListener('click', () => {
    operatorInput.disabled = false;
    stationSel.disabled = false;
    lockBtn.style.display = 'inline-flex';
    unlockBtn.style.display = 'none';
    saveLockStates();
});

// v8.8.2: historyToggle removed - history panel is always expanded now

// Batch Comment Logic
lockBatchBtn.addEventListener('click', () => {
    const isLocked = generalNote.disabled;
    if (isLocked) {
        // UNLOCK
        generalNote.disabled = false;
        lockBatchBtn.innerHTML = '🔒 Lock Comment';
        lockBatchBtn.style.background = '#10b981'; // var(--success)
        clearNoteBtn.disabled = false;
        clearNoteBtn.style.opacity = '1';
    } else {
        // LOCK
        generalNote.disabled = true;
        lockBatchBtn.innerHTML = '🔓 Unlock Comment';
        lockBatchBtn.style.background = '#f59e0b'; // var(--warning)
        clearNoteBtn.disabled = true;
        clearNoteBtn.style.opacity = '0.5';
    }
    saveLockStates();
});

clearNoteBtn.addEventListener('click', () => {
    generalNote.value = '';
    generalNote.focus();
    saveLockStates(); // Save that the comment was cleared
});

// Also save batch comment when it changes
generalNote.addEventListener('input', () => {
    localStorage.setItem('batchComment', generalNote.value);
});

// Update sync status display periodically
setInterval(() => {
    updateSyncStatusUI();
}, 30000);
