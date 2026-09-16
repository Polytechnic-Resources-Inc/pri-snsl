// Regression tests against live parse helpers in app.js (not a copied snippet).
// Run: node tests/test_scan_parse_regressions.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadParse() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const configStart = src.indexOf('const BARCODE_VALIDATION = {');
    const configEnd = src.indexOf('// ===== SUMMARY =====');
    const fnStart = src.indexOf('function cleanSerialNumber');
    const fnEnd = src.indexOf('// History and Status helpers');
    if (configStart < 0 || configEnd < 0 || fnStart < 0 || fnEnd < 0) {
        throw new Error('Could not slice parse helpers from app.js');
    }
    const context = {
        console,
        PART_NUMBER_MAP: {
            '0100810016250265': '536713-002',
            '0100810016250302': '536719-001',
        },
    };
    vm.runInNewContext(src.slice(configStart, configEnd) + '\n' + src.slice(fnStart, fnEnd), context);
    return context;
}

function resolveScan(p, raw) {
    const validation = p.validateRawBarcode(raw);
    let parsed = p.parsePN_SN(raw);
    if (!parsed.part || parsed.part === 'UNKNOWN' || !parsed.serial) {
        const candidateSerial = parsed.serial || p.cleanSerialNumber(raw);
        const extractedPart = p.extractPartFromSerial(candidateSerial);
        if (extractedPart) {
            parsed.part = extractedPart;
            parsed.serial = candidateSerial;
        } else {
            parsed.serial = candidateSerial;
        }
    }
    if (!parsed.part || parsed.part === 'UNKNOWN') {
        const recovered = p.recoverTruncatedGs1(raw, p.PART_NUMBER_MAP);
        if (recovered) {
            parsed.part = recovered.part;
            parsed.serial = recovered.serial;
        }
    }
    return {
        validation,
        part: parsed.part || 'UNKNOWN',
        serial: p.cleanSerialNumber(parsed.serial),
    };
}

const p = loadParse();
const tests = [];

function test(desc, fn) {
    tests.push({ desc, fn });
}

test('HIBC P5557100 with trailing $ keeps 9-digit serial (prod 41264)', () => {
    const r = p.parsePN_SN('+B446P55571001/$+710010217$');
    if (r.part !== 'P5557100') throw new Error('part ' + r.part);
    if (r.serial !== '710010217') throw new Error('serial ' + r.serial);
});

test('HIBC P5557100 without check char keeps last serial digit (prod 41262)', () => {
    const r = p.parsePN_SN('+B446P55571001/$+710010216');
    if (r.part !== 'P5557100') throw new Error('part ' + r.part);
    if (r.serial !== '710010216') throw new Error('serial ' + r.serial);
});

test('HIBC P5557100E strips letter check char (prod 41261)', () => {
    const r = p.parsePN_SN('+B446P5557100E1/$+7100E11238S');
    if (r.part !== 'P5557100E') throw new Error('part ' + r.part);
    if (r.serial !== '7100E11238') throw new Error('serial ' + r.serial);
});

test('HIBC P5557100 numeric leftover check digit still trimmed to 9', () => {
    const r = p.parsePN_SN('+B446P55571001/$+7100102167');
    if (r.serial !== '710010216') throw new Error('serial ' + r.serial);
});

test('HIBC 757E2 mixed serial does not strip last digit (v8.8.3)', () => {
    const r = p.parsePN_SN('+B446757E21/$+R757E210173');
    if (r.part !== '757E2') throw new Error('part ' + r.part);
    if (r.serial !== 'R757E210173') throw new Error('serial ' + r.serial);
});

test('chopped GS1 starting with 01 still recovers MGC serial (dashboard UNKNOWN Sep 14)', () => {
    const raw = '0100162502651126082521MGC2903514';
    const r = resolveScan(p, raw);
    if (r.serial !== 'MGC2903514') throw new Error('serial ' + r.serial);
    if (r.part !== '536713-002' && r.part !== 'MGC') throw new Error('part ' + r.part);
});

test('chopped GS1 missing 01 recovers MGC from date+AI 21', () => {
    const raw = '62502651126082521MGC2903674';
    const r = resolveScan(p, raw);
    if (r.serial !== 'MGC2903674') throw new Error('serial ' + r.serial);
    if (r.part !== '536713-002' && r.part !== 'MGC') throw new Error('part ' + r.part);
});

test('recoverTruncatedGs1 finds 21MGC even when raw starts with 01', () => {
    const rec = p.recoverTruncatedGs1('0100162502651126082521MGC2903514', p.PART_NUMBER_MAP);
    if (!rec) throw new Error('no recovery');
    if (rec.serial !== 'MGC2903514') throw new Error('serial ' + rec.serial);
});

let passed = 0;
let failed = 0;
for (const t of tests) {
    try {
        t.fn();
        passed++;
        console.log('PASS', t.desc);
    } catch (e) {
        failed++;
        console.log('FAIL', t.desc, e.message);
    }
}
console.log(`RESULT ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
