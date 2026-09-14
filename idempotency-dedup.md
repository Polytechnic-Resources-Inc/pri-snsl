# Idempotency and Deduplication Contract

## Overview

This document describes how the scanner prevents obvious repeat scans and how queued scans are retried without changing production scanning behavior.

Current scanner version: `v8.8.5`.

Runtime sources:

- `scan-cache.js` for recent duplicate detection.
- `app.js` for idempotency key generation, IndexedDB queueing, sync classification, and queue flush behavior.

## Purpose

The system protects two different situations:

- Accidental repeat scan by the same operator within a few seconds.
- Retry of a locally queued scan that may already have reached Supabase.

These are related but not identical. The recent duplicate cache blocks fast repeats before queueing. The idempotency key helps Supabase and the queue cleanup handle network retries.

## Step-by-Step Scan Flow

1. Validate and parse the barcode.
2. Clean the final serial number.
3. Check `isDuplicateScan(operator, serial)`.
4. If recent duplicate, show `DUPLICATE (recent scan)` and stop.
5. Generate an idempotency key.
6. Queue the scan locally in IndexedDB.
7. If internet and Supabase are reachable, attempt immediate sync.
8. If sync returns `OK` or `DUPLICATE`, remove the queued record.
9. If sync is retryable or blocked, keep the queued record and show `QUEUED`.

## Recent Duplicate Detection

Implemented in `scan-cache.js`.

| Setting | Value |
|---|---|
| Scope | Same operator and same cleaned serial |
| Window | 5 seconds |
| Stored entries | Last 100 serials per operator |
| Persistence | Browser `localStorage` |
| Time to live | 12 hours |
| Cleanup | Every 30 minutes and on cache initialization |

The cache is checked before the scan is queued or sent. If it matches, the scan is blocked immediately.

Recent duplicate response:

- UI message: `DUPLICATE (recent scan)`
- Tone: duplicate tone
- Queue record: none
- Supabase request: none

## Idempotency Key

Generated in `send()` in `app.js`.

Format:

```text
{serial_number}-{station}-{Date.now()}
```

Example:

```text
756EW99999-MAIN-1746393600000
```

The key is used as:

- IndexedDB object store key path.
- `idempotency_key` field in the Supabase insert payload.
- Queue cleanup identifier after `OK` or `DUPLICATE`.

Important behavior:

- The timestamp is generated when `send()` runs.
- Two scans of the same serial normally get different keys.
- A same-millisecond duplicate for the same serial and station could collide and overwrite the local queue record. This is unlikely in normal scanner use.

## Queue Storage

The offline queue is an IndexedDB database:

| Item | Value |
|---|---|
| Database | `sosv2-offline` |
| Version | `1` |
| Store | `pendingScans` |
| Key path | `idempotencyKey` |
| Indexes | `timestamp`, `status` |

Queued record shape:

```js
{
  idempotencyKey: string,
  payload: {
    operator: string,
    station: string,
    raw_scan: string,
    part_number: string,
    serial_number: string,
    batch_comment: string
  },
  timestamp: number,
  status: 'pending',
  retries: number,
  lastAttemptAt: string | null,
  lastResult: string | null,
  lastHttpStatus: number | null,
  lastErrorCode: string | null,
  lastErrorMessage: string
}
```

Every accepted scan is queued before network sync is attempted.

## Sync Classification

`syncScanToSupabase()` returns a classified result object. The scanner UI receives only `OK`, `DUPLICATE`, or `QUEUED` from `send()`.

| Internal result | Cause | Queue behavior | User-facing result |
|---|---|---|---|
| `OK` | Supabase returned 2xx | Remove queued record | `OK` / `SAVED` |
| `DUPLICATE` | HTTP 409 or Postgres `23505` | Remove queued record | `DUPLICATE` |
| `RETRYABLE` | Timeout, network error, HTTP 408, 429, 5xx, or unknown transient failure | Keep queued record and update retry metadata | `QUEUED` |
| `BLOCKED` | Auth, RLS, policy, permission, 400, 401, 403, 422, or other non-retryable 4xx | Keep queued record and update retry metadata | `QUEUED` |

Supabase sync has a 5 second abort timeout.

## Queue Flush Behavior

`flushQueue()` attempts to send pending records sequentially.

Flush guards:

- Does nothing if another flush is already running.
- Does nothing when `navigator.onLine` is false.
- Does nothing when `getConnectivityStatus().supabaseReachable` is false.

Flush triggers currently visible in runtime code:

- Browser `online` event, after about 1 second.
- App initialization when the browser is online, after about 2 seconds.
- Manual reload can re-run initialization and trigger the startup flush.

Flush result handling:

- `OK` or `DUPLICATE`: remove the record and update last sync time.
- `RETRYABLE`: update retry metadata and stop the flush loop.
- `BLOCKED`: update retry metadata and continue to the next record.
- Thrown sync error: classify as retryable, update retry metadata, and stop the loop.

The app updates the visible pending count every 30 seconds, but that display update is not the same as a queue flush.

## Cache Updates

The recent duplicate cache is updated after these user-facing outcomes:

- `OK`
- `DUPLICATE`
- `QUEUED`

The cache is not updated after validation errors or `INVALID FORMAT`.

## Edge Cases and Warnings

- A recent duplicate and a database duplicate are different events with similar operator meaning.
- `DUPLICATE (recent scan)` never reaches IndexedDB or Supabase.
- A database `DUPLICATE` is treated as complete and removed from the queue.
- A queued scan may show `QUEUED` even when the underlying error is `BLOCKED`; supervisor/admin review is needed if it remains stuck.
- Local queue data lives on the tablet/browser. Clearing site data can remove it.
- Browser private/incognito mode should not be used for production scanning.
- If IndexedDB fails, the app logs the queue error and attempts network sync as best effort.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Same item immediately says recent duplicate | Same operator scanned same serial within 5 seconds. | Do not rescan; check recent scan list. |
| Same item says database duplicate | Supabase already has the scan or idempotency key. | Treat as complete unless supervisor review says otherwise. |
| Pending count does not clear | Queue has retryable or blocked records, or no flush trigger has run yet. | Check badges, wait, then reload once if both badges are green or OK. |
| Pending count remains after reload | Record may be blocked by auth, RLS, schema, or other 4xx condition. | Supervisor/admin should inspect queued metadata and Supabase errors. |
| Queue disappeared after cache/site-data clear | Browser local storage was cleared. | Escalate; do not clear site data when pending count is above zero. |

## Notes and Limitations

- This contract documents client behavior only.
- Supabase constraints beyond `idempotency_key` must be verified in the live schema.
- The scanner does not create or modify Supabase schema.
- Historical offline docs may describe older retry behavior. Prefer this document for current queue and duplicate behavior.
