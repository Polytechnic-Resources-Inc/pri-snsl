# PRI Serial Number Log (SNSL)

Mobile-friendly scanning system for recording PRI production serial numbers from barcode labels.

## Overview

PRI-SNSL is a static Progressive Web App used by operators on tablets or phones. Operators scan a label, the app extracts the part and serial number, and the scan is saved to Supabase. When the tablet is offline or Supabase is unreachable, scans are stored locally and retried later.

The scanner behavior is implemented in `app.js`, `scan-cache.js`, `supabase-health.js`, and `service-worker.js`. This documentation cleanup does not change scanner behavior or the Supabase schema.

## Current Version

Scanner UI and service worker: `v8.8.6`.

Use the version badge in the scanning app and `service-worker.js` cache version as the runtime version check.

## Purpose

- Record each production scan with operator, station, raw barcode, part number, serial number, note, and timestamp.
- Give operators clear scan feedback: saved, duplicate, queued, or error.
- Keep scanning usable during short Wi-Fi or Supabase outages.
- Provide dashboard review, export, correction, and daily reporting support.

## Documentation

Current source-of-truth docs:

- [Operator Handbook](operator-handbook.md) - simple operator workflow and what each scan result means.
- [Troubleshooting Guide](troubleshooting.md) - symptom, likely cause, and fix steps for common problems.
- [Barcode Parsing Contract](barcode-parsing.md) - current barcode validation and parsing behavior.
- [Idempotency and Deduplication Contract](idempotency-dedup.md) - duplicate handling, local queue behavior, and retry behavior.
- [Offline Scanning Architecture](docs/OFFLINE_SCANNING.md) - technical offline flow summary, linked back to the source contracts.
- [Supabase Schema Reference](supabase_schema.md) - database table reference.
- [Report Setup Guide](scripts/SETUP_GUIDE.md) - daily report configuration.
- [Test Suite](tests/README.md) - available regression tests.

Historical fix notes and one-off migration notes are kept for context, but they are not the current source of truth unless linked above.

## Key Components

| Component | Files | Purpose |
|---|---|---|
| Scanner app | `index.html`, `app.js` | Main operator scanning workflow, barcode validation, parsing, and submission |
| Duplicate cache | `scan-cache.js` | Blocks same-operator repeat scans of the same serial within 5 seconds |
| Offline queue | `app.js` IndexedDB helpers | Saves scans locally before network submission |
| Connectivity checks | `supabase-health.js` | Separates device internet status from Supabase reachability |
| Offline app shell | `service-worker.js`, `manifest.json` | PWA install support and cached app assets |
| Dashboard | `dashboard.html` | Scan review, filtering, export, edit, and delete workflows |
| Operator history | `my-scans.html` | Operator-specific scan history view |
| Reports | `scripts/daily_report.py`, `.github/workflows/daily-report.yml` | Daily Excel and email report generation |
| Database | Supabase tables documented in `supabase_schema.md` | Operators, stations, part map, and scans |

## Setup

### Scanner Deployment

1. Host the static files on Vercel or another static host.
2. Confirm `index.html`, `app.js`, `scan-cache.js`, `supabase-health.js`, `service-worker.js`, `manifest.json`, and app icons are deployed together.
3. Confirm the Supabase URL and anon key used by the scanner are valid.
4. Open the scanner app and verify:
   - operator list loads
   - station list loads
   - internet badge shows online
   - Supabase badge reaches OK or SLOW
   - pending scan count starts at zero

### Supabase

The scanner reads active operators, stations, and part mappings from Supabase and writes scan records to the `scans` table.

Do not apply schema changes from documentation without verifying the live project first. The scanner currently sends an `idempotency_key` with each scan insert.

### Daily Reports

Daily reports are handled by GitHub Actions in `.github/workflows/daily-report.yml`. The workflow runs at `10:07 UTC` each day, which is approximately `5:07 AM EST` or `6:07 AM EDT`.

Required GitHub secrets:

| Secret | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_KEY` | Supabase key used by the report script |
| `SMTP_EMAIL` | Gmail account used to send reports |
| `SMTP_PASSWORD` | Gmail app password |
| `REPORT_RECIPIENTS` | Comma-separated recipient list |
| `GSHEET_CREDENTIALS_JSON` | Optional Google Sheets backup credentials |
| `GSHEET_SPREADSHEET_ID` | Optional Google Sheets backup target |

## Step-by-Step Operator Flow

Operators should use [Operator Handbook](operator-handbook.md). The short version is:

1. Select the correct operator and station.
2. Scan one complete barcode.
3. Read the result message before moving on.
4. Continue on `SAVED` or `QUEUED`.
5. Do not rescan immediately on `DUPLICATE`.
6. Clean and rescan on `ERROR`; set aside repeated failures.
7. Leave the app open if pending scans are waiting.

## Edge Cases and Warnings

- `QUEUED` is a saved local scan, not a failed scan.
- A recent duplicate is blocked locally and is not sent to the database.
- A database duplicate is treated as complete for queue cleanup.
- Clearing browser site data can remove local queued scans. Do not clear site data while pending scans are above zero.
- Old fix-summary docs may mention earlier versions such as `v8.6.4` or `v8.6.6`; prefer the current docs linked above.

## Troubleshooting

Use [Troubleshooting Guide](troubleshooting.md) for operator-safe recovery steps. Use [Idempotency and Deduplication Contract](idempotency-dedup.md) and [Barcode Parsing Contract](barcode-parsing.md) for technical investigation.

## Notes and Limitations

- The scanner is a browser app. Local queue storage depends on the browser keeping site data.
- The scanner queues before attempting network sync so short outages do not stop scanning.
- The app does not change Supabase schema at runtime.
- Report generation is separate from scanner behavior.

## License

Private - Polytechnic Resources Inc.
