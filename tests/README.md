# Test Suite

## Overview

This folder contains lightweight regression tests for scanner parsing, validation, duplicate cache behavior, connectivity classification, and report formatting helpers.

## Purpose

Use these tests after documentation or code changes to confirm known scanner rules still behave as expected. Documentation-only changes do not require scanner runtime changes, but running the relevant tests is still useful when docs were checked against code behavior.

## Step-by-Step Instructions

Run JavaScript tests from the repository root:

```bash
node tests/test_validation.js
node tests/test_hibc_check_digit.js
node tests/test_scan_cache.js
node tests/test_sync_classification.js
node tests/test_supabase_health.js
node tests/test_config_cache.js
node tests/test_760e_endcap_fix.js
node tests/test_759e2_no_strip.js
node tests/test_759el_quick.js
node tests/test_758el_and_header_fix.js
```

Run Python tests from the repository root:

```bash
python tests/test_mgc_fix.py
python tests/test_100760_formatting.py
```

Some report helper checks may require the `scripts` directory on the Python path or report dependencies installed from `scripts/requirements.txt`.

## Test Inventory

| Test | Area |
|---|---|
| `test_validation.js` | Raw barcode validation rules |
| `test_hibc_check_digit.js` | HIBC check digit stripping |
| `test_scan_cache.js` | Recent duplicate cache behavior |
| `test_sync_classification.js` | Supabase response classification |
| `test_supabase_health.js` | Supabase health check behavior |
| `test_config_cache.js` | Config cache parse/save rules and fetch timeout helper |
| `test_760e_endcap_fix.js` | 100760 end-cap handling |
| `test_759e2_no_strip.js` | 759E2 trailing digit preservation |
| `test_759el_quick.js` | 759EL parsing behavior |
| `test_758el_and_header_fix.js` | 758EL parsing and report header extraction |
| `test_mgc_fix.py` | MGC S/C variant handling |
| `test_100760_formatting.py` | Report formatting for 100760 variants |

## Edge Cases and Warnings

- Tests are a focused regression suite, not full end-to-end coverage.
- Browser storage, IndexedDB, and live Supabase behavior are only partially simulated.
- Report tests may need Python dependencies installed.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `node` command not found | Node.js not installed or not on PATH | Install Node.js or run in an environment with Node |
| Python import error | Report dependencies missing or path issue | Install `scripts/requirements.txt` and run from repo root |
| Expected count in old docs differs | Old README was stale | Treat test output and current test files as source |
| Supabase health test fails unexpectedly | Environment or fetch mocking difference | Inspect the specific failed assertion |

## Notes and Limitations

- These tests do not require production scanner behavior changes.
- Do not use tests to infer live Supabase schema; verify schema separately.
