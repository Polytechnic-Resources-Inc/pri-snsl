/**
 * Test for HIBC Check Digit Validation Fix (v8.6.4)
 * Historical snippet (v8.6.4). Live HIBC behavior is tested in
 * tests/test_scan_parse_regressions.js — all-numeric serials no longer
 * strip the last digit as of v8.8.8.
 */

// Simulate the check digit stripping logic (v8.6.4)
function stripCheckDigit(sNum) {
    if (sNum.length <= 1) return sNum;

    const lastChar = sNum.charAt(sNum.length - 1);
    const isLetter = /^[A-Z]$/i.test(lastChar);
    const isSpecialChar = /^[\-\.\$\/\+\%]$/.test(lastChar);
    const hasLetters = /[A-Z]/i.test(sNum);

    // Always strip letters and special chars (they're clearly check digits)
    if (isLetter || isSpecialChar) {
        return sNum.substring(0, sNum.length - 1);
    }
    // For digits: check if we have enough trailing chars to safely strip
    else {
        const letterMatches = sNum.match(/[A-Z]/gi);
        if (letterMatches) {
            const lastLetter = letterMatches[letterMatches.length - 1];
            const lastLetterPos = sNum.lastIndexOf(lastLetter);
            const trailingChars = sNum.substring(lastLetterPos + 1);

            // Only strip if we have >6 trailing chars (leaves 6+ after strip)
            if (trailingChars.length > 6) {
                return sNum.substring(0, sNum.length - 1);
            }
        } else {
            // All numeric serial - strip last digit
            return sNum.substring(0, sNum.length - 1);
        }
    }
    return sNum;
}

// Test cases
const tests = [
    // Letters and special chars - always stripped (unambiguous check digits)
    { input: 'R757WM102689%', expected: 'R757WM102689', desc: 'Alphanumeric with % - % stripped' },
    { input: 'R757WM102689Y', expected: 'R757WM102689', desc: 'Alphanumeric with letter Y - Y stripped' },
    { input: 'R757WM102689.', expected: 'R757WM102689', desc: 'Alphanumeric with . - . stripped' },
    { input: 'TNN10212238F', expected: 'TNN10212238', desc: 'Alphanumeric with letter F - F stripped' },

    // All-numeric serials - last digit stripped (assumed check digit)
    { input: '1234567890', expected: '123456789', desc: 'Pure numeric - last digit stripped' },

    // Alphanumeric with >6 trailing digits - last digit stripped
    { input: '760E2107185', expected: '760E210718', desc: 'Alphanumeric with 7 trailing digits - digit stripped (6 remain)' },

    // Alphanumeric with 6 trailing digits - NOT stripped (could be 6-digit serial or 5+check)
    { input: '757EN112036', expected: '757EN112036', desc: 'Alphanumeric with 6 trailing digits - NOT stripped (keep)' },
    { input: 'R757WM102694', expected: 'R757WM102694', desc: '6-digit serial, no check digit - NOT stripped' },
    { input: 'R757WM102698', expected: 'R757WM102698', desc: '6-digit serial, no check digit - NOT stripped' },

    // Alphanumeric with ≤5 trailing digits - NOT stripped
    { input: 'R757WM10269', expected: 'R757WM10269', desc: 'Exactly 5 trailing digits - NOT stripped' },
    { input: 'MGC1S17754', expected: 'MGC1S17754', desc: '5 trailing digits - NOT stripped' },

    // Alphanumeric with 7 trailing digits (6-digit serial + check digit) - stripped
    { input: 'R757WM1026990', expected: 'R757WM102699', desc: '6-digit serial with check digit 0 - stripped' },

    // Note: 757EW248480 (757EW + 5-digit serial + 0 check digit) has 6 trailing digits
    // With >6 rule, it will NOT be stripped (treated as 6-digit serial without check digit)
    // This matches 757EN112036 behavior

    // Edge cases
    { input: 'A', expected: 'A', desc: 'Single char - not stripped' },
    { input: 'AB', expected: 'A', desc: 'Two letters - last stripped' },
];

console.log('\n=== HIBC CHECK DIGIT VALIDATION TESTS ===\n');
let passed = 0, failed = 0;

tests.forEach((test, i) => {
    const result = stripCheckDigit(test.input);
    const status = result === test.expected ? 'PASS' : 'FAIL';
    if (result === test.expected) passed++; else failed++;

    console.log(`${i + 1}. ${status}: ${test.desc}`);
    console.log(`   Input:    "${test.input}"`);
    console.log(`   Expected: "${test.expected}"`);
    console.log(`   Got:      "${result}"`);
    console.log('');
});

console.log(`=== RESULTS: ${passed}/${tests.length} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
