# Operator Handbook

## Overview

This guide is for people scanning boxes. It explains what to do during normal scanning and what each result on the screen means.

## Purpose

The scanner records the barcode, operator, station, part number, serial number, and time. Your job is to scan one complete label, read the result, and only set items aside when the screen tells you something needs attention.

## Step-by-Step Instructions

1. Open the scanning app.
2. Wait until the scan box says Ready to scan.
3. If your name and station are already locked from last time, keep scanning.
4. If they are not locked, select your name and the correct Station.
5. Clean the barcode if the label is dirty or marked.
6. Scan the full barcode in one pass.
7. Read the result message before scanning the next item.

## Scan Results

| Result | What it means | What to do |
|---|---|---|
| `SAVED` or `OK` | The scan reached the main database. | Move to the next item. |
| `QUEUED` | The scan is saved on this tablet, but has not reached the main database yet. | Keep scanning if needed. Leave the app open until pending scans return to zero. |
| `DUPLICATE` | The same serial was already seen. It may have just been scanned, or it may already be in the main database. | Do not keep rescanning. Check the recent scan list. If it still looks wrong, set the item aside for review. |
| `ERROR` or `SCAN REJECTED` | The barcode could not be accepted. It may be too short, damaged, incomplete, or not recognized. | Clean the label and scan once more. If it fails again, set it aside for review. |
| `Timeout - Please retry scan` | The app took too long processing the scan. | Wait for the scan box to unlock, then scan again once. |

## What Duplicate Means

A duplicate means the scanner believes that serial number has already been handled.

There are two common cases:

- You scanned the same item twice within a few seconds.
- The serial is already saved in the main database.

Do not keep scanning the same item repeatedly. Repeated scans can make it harder to tell what happened. Check the recent scan list first, then ask a supervisor if the item should be reviewed.

## What Queued Means

`QUEUED` means the tablet saved the scan locally and will send it later. This usually happens when Wi-Fi is down, the internet is unstable, or the main database is temporarily unreachable.

Queued scans are not lost as long as browser site data is not cleared. Keep the scanner app open when possible, especially at the end of a shift.

## Offline Scanning

You can keep scanning when the app shows offline or down status.

Watch these items at the top of the screen:

- Internet badge: shows whether the tablet has internet.
- Database badge: shows whether the main database is reachable.
- Pending scan count: shows how many scans are waiting to send.

If pending scans are above zero, leave the app open until the count returns to zero.

## Edge Cases and Warnings

- Do not clear browser data while pending scans are above zero.
- Do not close the browser at the end of shift if pending scans are still waiting.
- Do not scan before your operator and station are selected.
- Do not scan while the scan box is gray or locked.
- Do not keep rescanning a duplicate item.
- If a barcode fails twice, set the item aside instead of trying many times.

## Troubleshooting

| Symptom | What to do |
|---|---|
| Pending count is above zero | Keep the app open. Check Wi-Fi. Wait 30 to 60 seconds after the badges turn green. |
| Pending count stays stuck | Leave the app open and notify a supervisor. If both badges are green, the supervisor may ask you to reload once. |
| Every scan says error | Confirm your operator and station are selected. Clean the label. If one product type keeps failing, set those items aside. |
| Operator name is missing | If operator/station are already locked, keep scanning. If lists never fill after a minute, call a supervisor. Do not clear site data. |
| Scan box is locked | Wait for the timeout message or for the box to unlock. If it stays locked for more than 35 seconds, ask a supervisor. |
| Duplicate looks wrong | Check the recent scan list for the same serial. Set the item aside if it is not clear. |

## Notes and Limitations

- The app saves your selected operator and station on the tablet.
- The app saves queued scans on the tablet, not on another device.
- A supervisor should handle repeated errors, stuck pending scans, and missing operator names.
