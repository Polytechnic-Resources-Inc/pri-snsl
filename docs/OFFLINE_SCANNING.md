# Offline Scanning Architecture

## Overview

The scanner is offline-first for accepted scans: it writes each accepted scan to browser IndexedDB before attempting a network insert. If the tablet is offline, Supabase is unreachable, or the insert attempt fails, the scan remains queued for a later retry.

Current scanner version: `v8.8.5`.

Startup no longer waits on a live database call to unlock the scan box. Health checks use an 8 second GET against the operators table. Operator, station, and part map lists are cached on the tablet; the scan box enables first, then live config refreshes in the background.

## Purpose

This document gives a technical summary of offline scanning. The source-of-truth behavior is split across:

- [Operator Handbook](../operator-handbook.md) for operator instructions.
- [Troubleshooting Guide](../troubleshooting.md) for recovery steps.
- [Idempotency and Deduplication Contract](../idempotency-dedup.md) for queue, duplicate, and retry details.
- `app.js` and `supabase-health.js` for runtime behavior.

## Step-by-Step Flow

1. The operator scans a barcode.
2. `app.js` validates and parses the barcode.
3. The recent duplicate cache checks same-operator repeat scans.
4. `send()` generates an idempotency key.
5. `send()` writes the scan to IndexedDB.
6. If the browser is offline, the scan stays queued.
7. If Supabase is marked unreachable, the scan stays queued.
8. If Supabase is reachable, the app attempts a POST with a 5 second timeout.
9. `OK` and database `DUPLICATE` remove the queue record.
10. Retryable or blocked results leave the queue record in place with attempt metadata.

## Key Components

| Component | Runtime file | Responsibility |
|---|---|---|
| Raw validation and parsing | `app.js` | Reject malformed scans before queueing |
| Recent duplicate cache | `scan-cache.js` | Block same-operator same-serial scans within 5 seconds |
| Offline queue | `app.js` | Store accepted scans in IndexedDB |
| Sync classification | `app.js` | Classify Supabase responses as OK, duplicate, retryable, or blocked |
| Connectivity state | `supabase-health.js` | Track internet and Supabase reachability separately |
| PWA cache | `service-worker.js` | Cache app shell assets for browser loading |

## Queue Storage

The queue uses IndexedDB:

- database: `sosv2-offline`
- store: `pendingScans`
- key path: `idempotencyKey`
- indexes: `timestamp`, `status`

Queued records include the full scan payload plus retry metadata such as retry count, last attempt time, last result, HTTP status, error code, and error message.

## Queue Flush Triggers

The runtime code currently attempts queue flushing when:

- the browser fires an `online` event
- the app initializes while online
- the page is reloaded while online

The sync status display updates every 30 seconds, but that display update does not itself flush the queue.

## UI States

| UI state | Meaning |
|---|---|
| Internet `ONLINE` | Browser reports network connectivity |
| Internet `OFFLINE` | Browser reports no network connectivity |
| Supabase `CHECKING` | Health check has not completed yet |
| Supabase `OK` | Supabase is reachable |
| Supabase `SLOW` | Supabase responds, but health latency is high |
| Supabase `DOWN` | Supabase has failed enough health checks to be treated as unreachable |
| Pending count above zero | One or more scans are still stored locally |

## Edge Cases and Warnings

- `QUEUED` means the scan is saved locally, not lost.
- Clearing browser site data can delete queued scans.
- Browser private/incognito mode should not be used for production scanning.
- A database duplicate is removed from the queue because it is treated as already handled.
- A blocked sync result can still appear to the operator as `QUEUED`; supervisor/admin follow-up is needed if the queue remains stuck.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Pending count rises while internet is offline | Tablet cannot reach the network. | Reconnect Wi-Fi and leave the app open. |
| Pending count rises while Supabase is down | Supabase health check is failing. | Wait for Supabase to recover; do not clear site data. |
| Pending count stays above zero after badges recover | No flush trigger has run yet or a record is blocked. | Reload once while online, then wait 30 to 60 seconds. |
| Queue still stuck after reload | Record may have a blocked HTTP/RLS/schema/auth result. | Supervisor/admin should inspect queue metadata and Supabase logs. |

## Notes and Limitations

- The scanner app does not modify Supabase schema.
- Queue data is local to the browser profile on the scanning device.
- The service worker cache is separate from IndexedDB queue storage, but clearing all site data can remove both.
- This document intentionally avoids repeating every queue detail; use [Idempotency and Deduplication Contract](../idempotency-dedup.md) for the full queue contract.
