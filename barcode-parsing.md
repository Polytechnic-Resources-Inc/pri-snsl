# Barcode Parsing Contract

## Overview

This document describes the current barcode validation and parsing behavior used by the scanner runtime. The active runtime source is `app.js`. Product rule reference data is also present in `product_rules_master_truth.js`, but the browser behavior depends on what is loaded by the deployed app.

Current scanner version: `v8.8.8`.

## Purpose

Barcode parsing has one job: turn the raw scanner input into a submitted scan payload with:

- raw barcode
- part number
- serial number
- operator
- station
- batch comment

Invalid scans are rejected before they are queued or sent to Supabase.

## Step-by-Step Parsing Flow

Every scan follows this order:

1. Read the raw value from the scan input.
2. Trim whitespace.
3. Remove control characters.
4. Remove one leading apostrophe if present.
5. Run `validateRawBarcode(raw)`.
6. Stop immediately if validation fails.
7. Run `parsePN_SN(raw)`.
8. If part or serial is missing, try fallback serial cleaning and part extraction.
9. Run `cleanSerialNumber()` as the final serial cleanup.
10. Stop with `INVALID FORMAT` if the final serial is empty.
11. Check the recent duplicate cache.
12. Queue the scan locally and attempt sync.

Validation happens before parsing. A rejected scan never enters the offline queue.

## Supported Formats

| Format | Detection | Minimum length | Notes |
|---|---:|---:|---|
| GS1-128 | Raw value starts with `01` | 28 characters | Uses first 16 characters as the GS1 prefix lookup key |
| HIBC | Raw value contains `/$+` | 12 characters | Splits part and serial around the delimiter |
| Custom serial | Not GS1 or HIBC, but long enough | 20 characters | Used for MGC, R756, PUL, EBS, FIL, and similar direct serial formats |

## Validation Rules

`validateRawBarcode(rawScan)` rejects:

| Check | Rejection |
|---|---|
| Empty or non-string input | `Empty scan` |
| Length below 20 characters | `Too short` |
| Suspicious characters | `Contains invalid characters - possible scanner error` |
| GS1 shorter than 28 characters | `GS1-128 too short` |
| HIBC shorter than 12 characters | `HIBC too short` |

Suspicious characters are:

```text
* # @ ! ~ ` ^ & ( ) = { } | [ ] < > ; : ' "
```

The HIBC check digit characters `-`, `.`, `$`, `/`, `+`, and `%` are allowed.

## GS1-128 Behavior

For GS1-128 scans:

1. The first 16 characters are used as the part lookup prefix.
2. The remaining data is treated as the serial area.
3. If the serial area starts with date AI `11`, `17`, or `13`, the next 8 characters are skipped.
4. If the remaining value starts with serial AI `21`, the `21` is removed.
5. The prefix is looked up in `PART_NUMBER_MAP`.
6. If no part is found, the code attempts PFR inline part extraction from the serial.
7. If no part is found after fallback, the part is `UNKNOWN`.

## HIBC Behavior

For HIBC scans:

1. Split the raw value on `/$+`.
2. Treat the left side as the part candidate.
3. Treat the right side as the serial candidate.
4. Remove HIBC leading `+B` or `+` markers where applicable.
5. Resolve `446...` part wrappers before check digit decisions.
6. Strip a check digit when the code can do so without losing a real serial digit.
7. Convert the `446...` wrapper to the downstream part code.
8. Apply product-specific serial extraction rules.
9. Return `{ part, serial }`.

### HIBC Check Digit Rules

The scanner only strips a check digit. It does not validate the check digit value.

| Last character | Behavior |
|---|---|
| Letter | Strip it |
| Special HIBC check character | Strip it |
| Digit with letters earlier in serial | Strip only when the trailing character count is greater than the part-specific threshold |
| Digit with no letters in serial | Keep it. Missing check chars used to delete a real serial digit (P5557100). |

Part-specific digit thresholds:

| Part code | Max trailing count kept |
|---|---:|
| `100756E2` | 6 |
| `100757E2` | 6 |
| `100758E2` | 6 |
| `100759E2` | 7 |
| `757E2` | 6 |
| Other parts | 5 |

The `757E2` key is required because some HIBC `446` labels resolve to `757E2` before a `100` prefix is applied.

## Product-Specific Rules

`PRODUCT_SERIAL_RULES` in `app.js` contains product-specific regex rules for labels that include fixed serial prefixes, check digits, or padding. These rules run after the HIBC split and check digit step.

Examples of covered families include:

- `100756...`, `100757...`, `100758...`, `100759...`, `100760...`, `100780...`, `100790...`
- R756 variants
- MGC and MGCK variants
- PFR and P555 variants
- EBS variants
- FIL variants
- PulmOne variants
- TNN variants

If no rule exists for the part, or the rule does not match, the original serial is kept and then passed through final cleanup.

## Fallback Part Extraction

If parsing does not produce a clear part or serial, the scanner:

1. Uses the parsed serial if present, otherwise cleans the raw scan into a serial candidate.
2. Runs `extractPartFromSerial(candidateSerial)`.
3. Uses the detected part if a known prefix matches.
4. Leaves the part as `UNKNOWN` if no known prefix matches.

Fallback detection covers common MGC, R756, 756, P555, PUL, EBS, and FIL prefixes.

## Output Structure

`parsePN_SN()` returns:

```js
{
  part: string,
  serial: string
}
```

The final submitted payload contains:

```js
{
  operator: string,
  station: string,
  raw_scan: string,
  part_number: string,
  serial_number: string,
  batch_comment: string
}
```

Supabase insert fields are mapped in `syncScanToSupabase()`:

| Payload field | Supabase field |
|---|---|
| `operator` | `operator_name` |
| `station` | `station_id` |
| `raw_scan` | `raw_scan` |
| `part_number` | `part_id` |
| `serial_number` | `serial_number` |
| `batch_comment` | `batch_comment` |
| generated key | `idempotency_key` |

## Edge Cases and Warnings

- Incomplete GS1-128 scans (missing leading `01…`, or `01` plus a chopped GTIN) are recovered when serial AI `21` plus a known family prefix (MGC, PUL, …) is present.
- If part is still `UNKNOWN` after recovery, the scan is rejected and is not queued or inserted.
- Empty final serials are rejected as `INVALID FORMAT`.
- HIBC all-numeric serial sections keep the last digit unless a product rule trims a leftover numeric check digit.
- `%` is valid in HIBC labels and should not be treated as scanner noise.
- Product rules only affect matching part codes.
- The runtime does not prove that a HIBC check digit is mathematically correct.
- If `scan-cache.js` fails to load, recent duplicate protection is skipped.

## Troubleshooting

| Symptom | Likely parsing cause | Next step |
|---|---|---|
| `Too short` | Scanner captured only part of the barcode. | Clean label and rescan the full barcode. |
| `Contains invalid characters` | Scanner captured noise or a damaged label. | Clean label and rescan once. |
| `INVALID FORMAT` | The scan passed raw validation, but no serial could be extracted. | Capture the raw barcode and review parsing rules. |
| Incomplete barcode / UNKNOWN blocked | Scanner sent a chopped GS1-128 (missing leading `01`). | Rescan the full label in one pass. |
| Last serial digit appears missing | All-numeric HIBC used to strip the last digit when the gun omitted `$`. | Confirm app version is v8.8.8+. Rescan once. |

## Notes and Limitations

- `PART_NUMBER_MAP` is loaded at runtime from Supabase `part_map`.
- This document does not list every inline regex from `PRODUCT_SERIAL_RULES`; `app.js` is the current runtime source.
- The scanner does not mutate Supabase schema.
- Historical docs may describe older versions. Prefer this contract for current parsing behavior.
