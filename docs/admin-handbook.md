# Admin Handbook

## Purpose

This handbook is for PRI-SNSL operational/admin users who support day-to-day scanning without changing application code.

Use it to:

- Help operators keep scanning safely.
- Recognize queue, sync, scanner, dashboard, and report symptoms.
- Decide what an admin can safely do.
- Decide when to stop troubleshooting and escalate.

This is not a deployment, credential, disaster recovery, or engineering design guide. Use the existing deployment, secrets, dependency, and disaster recovery docs for those topics.

## System Overview

| Area | Practical meaning for admins |
|---|---|
| Scanner | Operators use the main scanner page on tablets/phones. They select an operator and station, scan a barcode, and watch for the result message. |
| Dashboard | Admin review page for scan records. It supports filtering, live operator status, notes, export, edit, add, and delete functions. |
| My Scans | Operator-focused history page. It shows scans for one selected operator and auto-refreshes every 30 seconds. It is view-only. |
| Supabase | Primary database for operators, stations, part mappings, and scan records. If Supabase is unavailable, scanning may continue locally as queued scans. |
| Queue behavior | Accepted scans are stored in browser IndexedDB before sync. A pending count above zero means the tablet still has unsynced scan data. |
| Offline behavior | `QUEUED` means the scan was saved locally and should sync later when internet and Supabase are reachable. It is not safe to clear site data while scans are queued. |

Current inspected scanner version: `v8.8.5`.

## Admin Responsibilities

| Responsibility | What to do |
|---|---|
| Monitor scanning health | Check whether operators are getting `SAVED` or `QUEUED`, whether pending counts return to zero, and whether the dashboard shows expected activity. |
| Assist operators | Help with missing operator/station lists, duplicate confusion, scan errors, stale tablets, and sync delays. |
| Monitor queues | Treat any nonzero pending count as possible unsynced production data until verified. |
| Verify reports | Confirm daily reports arrive, contain expected data, and can be rerun through the documented report process when needed. |
| Verify deployments | After a release, confirm scanner loads, version badge is expected, operator/station lists load, Supabase badge is healthy, and dashboard reads data. |
| Escalate correctly | Stop before clearing site data, deleting records, rotating credentials, changing deployment, or doing mass rescans. |
| Maintain process notes | Record recurring issues, unresolved ownership gaps, and repeated operator problems for follow-up. |

TODO: Name the primary operations admin and backup admin responsible for this handbook.

## Daily Admin Checklist

Use this once near shift start and again before end of shift.

- [ ] Open the scanner on at least one production device and confirm the page loads.
- [ ] Confirm the visible version badge matches the expected production version.
- [ ] Confirm the internet badge shows online on the production network.
- [ ] Confirm the Supabase badge reaches `OK` or `SLOW`, not persistent `DOWN` or `CHECKING`.
- [ ] Confirm operator and station lists load.
- [ ] Check that the scanner pending count is zero on active tablets, or record any nonzero counts.
- [ ] Confirm operators can see `SAVED` or expected `QUEUED` results.
- [ ] Open the dashboard and confirm today's scans appear.
- [ ] Review live operator status for unexpectedly idle or missing operators.
- [ ] Check for suspicious dashboard rows such as `UNKNOWN` part, very short serials, or unusual notes.
- [ ] Confirm daily report delivery or note the expected manual recovery path.
- [ ] Ask supervisors whether any tablet had queue, stale version, or scanner load problems.

End-of-shift queue rule:

- [ ] Any tablet with pending scans above zero stays powered on with the scanner open.
- [ ] Record operator, station, pending count, device, and approximate time range.
- [ ] Escalate if pending count does not clear after the network and Supabase badges recover.

## Understanding Scan Statuses

| Status | What it means | Operator action | Admin action | Escalation threshold |
|---|---|---|---|---|
| `SAVED` | Scan reached Supabase and the local queue record was removed. | Continue scanning. | Verify dashboard if the scan is business-critical or disputed. | Escalate only if dashboard/report does not later show the scan. |
| `QUEUED` | Scan was accepted and saved locally on the tablet, but has not synced to Supabase yet. | Keep scanning if production allows. Leave app open. Do not clear data. | Check pending count, internet badge, Supabase badge, and whether count drops after recovery. | Escalate if pending remains above zero after badges are healthy, one reload, and 30-60 seconds. |
| `DUPLICATE (recent scan)` | Same operator scanned the same serial again within the local duplicate window. The scan was blocked before queue/database. | Do not keep rescanning. Check recent scan display. | Help verify whether the item was already scanned. | Escalate if the operator believes the item is new and there is no recent/database record. |
| `DUPLICATE` | Supabase/database treated the scan as already present or equivalent. Queue cleanup treats this as complete. | Do not keep rescanning. Set aside if uncertain. | Check dashboard for the serial and confirm operator/station/date. | Escalate if duplicate status conflicts with physical production records. |
| `ERROR`, `INVALID SCAN`, `INVALID FORMAT`, or validation error | Barcode was rejected, parsing failed, or unexpected scanner/runtime error occurred. Rejected scans do not enter the queue. | Clean label, scan the full barcode once more, then set aside repeated failures. | Look for repeated failures by product/label type and collect examples. | Escalate if many labels from the same product fail or a valid product repeatedly shows `UNKNOWN`/invalid. |
| `BLOCKED` | Internal sync classification for non-retryable Supabase/auth/RLS/schema/permission errors. The operator may only see `QUEUED`. | Leave app open and stop risky troubleshooting. | Treat as a stuck queue if pending does not clear after normal recovery. | Escalate to technical admin/Supabase owner. |

## Queue Awareness & Safety

Accepted scans are queued in browser IndexedDB before network sync. That means a tablet can temporarily hold the only copy of production scan data.

Admin rules:

- A nonzero pending count is production data risk.
- `QUEUED` is an accepted local scan, not a failed scan.
- Leave the scanner tab open while pending scans exist.
- Keep the device powered and connected to Wi-Fi.
- Record pending count before doing anything.
- Reload once only after internet and Supabase badges look healthy.
- Do not clear site data, browser data, app storage, IndexedDB, or cache as a casual fix.

Safe queue recovery order:

1. Check internet badge.
2. Check Supabase badge.
3. Wait 30-60 seconds after badges recover.
4. If pending count does not change and badges are healthy, reload once.
5. Wait another 30-60 seconds.
6. If still stuck, preserve the tablet and escalate.

Information to collect before escalation:

| Field | Example |
|---|---|
| Device/tablet | TODO: internal device name or physical label |
| Operator | `Brenda` |
| Station | `MAIN` |
| Pending count | `3` |
| First seen | `2026-05-07 2:15 PM ET` |
| Last scan status | `QUEUED` |
| Internet badge | `ONLINE` or `OFFLINE` |
| Supabase badge | `OK`, `SLOW`, `DOWN`, or `CHECKING` |
| Approximate serials/products | `756EW...`, `PUL9000K...` |

TODO: Document who is trained to inspect IndexedDB queue metadata on production tablets.

## Common Operator Problems

| Problem | Symptoms | Likely causes | Safe actions | Unsafe actions | Escalation guidance |
|---|---|---|---|---|---|
| Scanner will not load | Blank page, browser error, old cached page only | Wi-Fi/hosting issue, stale browser state, device problem | Check Wi-Fi, close/reopen scanner tab, try another device | Clear site data before checking pending count; factory reset tablet | Escalate if multiple devices cannot load or one device has pending scans. |
| Scan field not ready | Placeholder stays initializing, field gray/disabled | App loading, config still loading, processing timeout | Wait; confirm operator/station loaded; reload once if no pending risk | Rapid rescans; clearing data | Escalate if locked longer than 35 seconds or repeats across devices. |
| Operator list missing | List stays loading or operator not present | Supabase/config unreachable; operator inactive/missing | Check Wi-Fi, refresh once, confirm other tablets, ask admin to verify active operator list | Add fake operator in records; scan under wrong name intentionally | Escalate if operator should be active but is absent. |
| Station list missing/wrong | Station list loading, station absent, previous station selected | Supabase/config issue; station inactive/missing; local saved preference | Refresh once; select correct station before scanning; unlock station if locked | Scan under wrong station; clear storage with pending scans | Escalate if station should be active but is absent. |
| Scans stuck queued | `QUEUED` results, pending count above zero | Wi-Fi/Supabase outage, blocked sync result, no flush trigger | Leave app open, check badges, wait, reload once after badges healthy | Clear site data; delete queued data; mass rescan | Escalate if pending persists after safe queue recovery order. |
| Duplicate scans | `DUPLICATE` or `DUPLICATE (recent scan)` | Same label scanned twice, database already has serial, queue retry recognized | Check recent scan/dashboard, set item aside if unclear | Repeatedly rescan; delete existing records blindly | Escalate if physical production record and dashboard disagree. |
| Stale version | One tablet behaves differently; version badge differs | Service-worker/browser cache | Confirm pending count is zero, close/reopen scanner, hard refresh if available | Clear all site data with pending scans; use cache tools blindly | Escalate if pending count is nonzero or version remains stale. |
| Dashboard mismatch | Scanner says saved but dashboard does not show it immediately | Filter/date/operator mismatch, dashboard cache/refresh delay, queued scan not synced | Clear filters, check date range, wait for auto-refresh, manually refresh dashboard | Delete/re-add records without reconciliation | Escalate if scanner shows `SAVED` but dashboard cannot find the serial after filter checks. |
| Tablet offline | Internet badge offline, browser cannot reach sites | Wi-Fi/device/network issue | Reconnect Wi-Fi, keep scanner open, continue only if `QUEUED` is acceptable | Clear data; close browser with many pending scans unless directed | Escalate if production must continue with growing queue risk. |
| Sync delay | Badge recovers but pending count stays briefly above zero | Flush has not triggered yet or Supabase slow | Wait 30-60 seconds; reload once if badges healthy | Repeated reloads; storage clearing | Escalate if count stays stuck after one reload and wait. |
| Part shows `UNKNOWN` | Dashboard/scanner has valid serial but unknown part | Missing part map or unsupported label mapping | Set aside for review; record examples; verify product/label type | Assume record is bad and delete; mass edit part numbers | Escalate recurring product-specific `UNKNOWN` entries. |

## Dashboard Usage

The dashboard is for admin review and correction of scan records. It is not the scanner queue and does not show unsynced records that still live only on a tablet.

Admins should monitor:

- Today's scan activity.
- Live operator status cards.
- Operator, station, part, and serial filters.
- Unexpected idle operators.
- `UNKNOWN` parts.
- Very short or suspicious serial numbers flagged by the dashboard.
- Batch comments and dashboard notes.
- Whether recent scanner activity appears after sync.

Dashboard controls found in the current app:

| Control | Use | Admin caution |
|---|---|---|
| Quick date filters | Review today, yesterday, week, month, or all data. | Date filters use Eastern Time display logic. Confirm date range before declaring data missing. |
| Operator/station/part filters | Narrow records by operational area. | Clear filters before comparing against scanner reports. |
| Search serial | Find a specific serial. | Search only sees records already synced to Supabase. |
| Auto-refresh | Refreshes dashboard data every 30 seconds when enabled. | A queued tablet scan will not appear until sync succeeds. |
| Export CSV/XLSX | Download filtered records for review/reporting. | Confirm filters first; XLSX export depends on a browser-loaded library. |
| Notes | Add dashboard-only admin notes. | Notes are operational annotations; do not use them as a substitute for corrected records. |
| Edit record | Correct serial, part, operator, station, comment, note, or date/time. | Use only with supervisor approval and a clear audit reason. |
| Add new record | Manually create a scan record. | Use only for controlled reconciliation, not casual replacement for scanning. |
| Delete record | Permanently removes the scan record and related unit data. | High risk. Do not delete unless the business process authorizes it. |

Common misunderstandings:

- Dashboard does not prove a queued tablet scan was lost; it may not have synced yet.
- Dashboard filters can hide valid records.
- Dashboard password is convenience gating, not strong user authentication.
- Dashboard edits/deletes affect database records, not the tablet queue.

TODO: Define who may approve dashboard edits, manual adds, and deletes.

## My-Scans Usage

`my-scans.html` is a view-only scan history page for one selected operator.

Intended use:

- Operators or supervisors can select an operator name.
- The page shows today, this week, or all-time scan history for that operator.
- It shows the most recent scan and count for the selected date range.
- It auto-refreshes every 30 seconds.

Limitations:

- It reads synced Supabase records only.
- It does not show records still pending in a tablet queue unless they have synced.
- It does not edit, delete, or correct records.
- It remembers the last selected operator in browser local storage.

Troubleshooting:

| Symptom | Safe action |
|---|---|
| Operator missing | Check whether the operator is active and whether Supabase is reachable. |
| Recent scan missing | Confirm scanner status was `SAVED`; if it was `QUEUED`, check tablet pending count. |
| Count seems wrong | Check selected date range and Eastern Time date boundary. |
| Page says error loading scans | Refresh once and compare with dashboard/Supabase health. |

## Safe vs Unsafe Troubleshooting

### Safe Actions

These are usually safe for admins:

- Reload the scanner page once.
- Close and reopen the scanner tab.
- Reconnect Wi-Fi.
- Verify internet and Supabase badges.
- Verify pending count.
- Wait 30-60 seconds after connectivity recovers.
- Clear dashboard filters.
- Compare scanner last-scan display, my-scans, and dashboard.
- Record operator, station, device, serial, time, and status.
- Ask operator to clean the label and rescan once after a validation error.
- Set questionable items aside for supervisor review.

### Unsafe Actions

Do not do these casually:

- Clear site data while pending count is above zero.
- Clear IndexedDB, local storage, or browser storage without technical approval.
- Reinstall browser/app on a tablet with pending scans.
- Factory reset a tablet with pending scans.
- Mass rescan items without reconciliation.
- Delete dashboard records to "clean up" duplicates.
- Manually add records to replace queued scans without proving what synced.
- Rotate Supabase, GitHub, Gmail, Vercel, or dashboard credentials during routine troubleshooting.
- Deploy or roll back without the deployment verification checklist.
- Use old cache-clearing helper pages without confirming queue safety.

## Escalation Rules

Stop troubleshooting and escalate when:

- Pending count remains above zero after safe queue recovery.
- Any tablet has pending scans and someone proposes clearing browser/site data.
- Multiple tablets cannot load scanner or operator/station lists.
- Supabase badge is persistently `DOWN` or `CHECKING`.
- Scanner accepts only `QUEUED` for an extended period.
- Operator/station lists are wrong or missing for active production users.
- Dashboard data conflicts with physical production records.
- A dashboard delete, manual add, or edit is being considered.
- A product family repeatedly produces invalid scans, missing serials, or `UNKNOWN` parts.
- A stale version cannot be resolved with close/reopen or safe refresh.
- Daily report failure involves missing scan data, not just email delivery.
- Any credential, deployment, hosting, schema, or database permission change is suspected.

Escalation contacts:

| Area | Primary | Backup |
|---|---|---|
| Production supervisor | TODO | TODO |
| Operations admin | TODO | TODO |
| Dashboard record correction approver | TODO | TODO |
| Supabase/database owner | TODO | TODO |
| IndexedDB queue recovery owner | TODO | TODO |
| Vercel/deployment owner | TODO | TODO |
| GitHub/report workflow owner | TODO | TODO |
| Device/tablet owner | TODO | TODO |

## Operational Do-Nots

- Do not clear storage with queued scans.
- Do not tell operators that `QUEUED` means failed.
- Do not rescan blindly after duplicate or queue symptoms.
- Do not scan under the wrong operator or station to keep moving unless a supervisor explicitly approves and records the correction path.
- Do not delete dashboard records without business approval and reconciliation.
- Do not manually add records unless the source data and approval are clear.
- Do not rotate credentials as a first response to a scanner issue.
- Do not deploy, roll back, or clear service-worker caches without checking pending queue safety.
- Do not use private/incognito browser mode for production scanning.
- Do not assume a report is wrong before checking dashboard filters, sync status, and date range.

## Recommended Future Improvements

Operational/documentation improvements only:

- Create a one-page laminated queue safety card for supervisors: pending count, do-not-clear-storage, escalation contact.
- Name primary and backup owners for operations, queue recovery, dashboard corrections, devices, Supabase, Vercel, GitHub, and reports.
- Define a written approval process for dashboard edits, manual adds, and deletes.
- Create a controlled reconciliation workflow for accidental site-data clearing or lost queued scans.
- Maintain a device inventory with tablet name, browser, scanner URL, expected version, and assigned area.
- Add a shift-start/shift-end queue log.
- Document exact operator and station activation/deactivation process in Supabase or the admin tool once confirmed.
- Add an admin-facing queue inspection runbook for trained technical admins.
- Add a simple incident form for stuck queues, stale versions, and dashboard/report mismatches.
- Confirm whether `my-scans` is intended for operators, supervisors, or both.
- Create a report verification checklist that distinguishes "report did not send" from "scan data missing."

## Unresolved Operational Ambiguity

- TODO: Who owns day-to-day operations support?
- TODO: Who can approve dashboard record edits?
- TODO: Who can approve dashboard record deletion?
- TODO: Who can approve manual record creation?
- TODO: Who manages active operator and station lists?
- TODO: Where is the production tablet/device inventory?
- TODO: Who is trained to inspect or recover IndexedDB queue data?
- TODO: What is the official end-of-shift process when pending count is nonzero?
- TODO: What is the official reconciliation process after accidental storage clearing?
- TODO: What is the expected production URL and current release verification owner?
- TODO: Are operators expected to use `my-scans`, or is it supervisor-only?
