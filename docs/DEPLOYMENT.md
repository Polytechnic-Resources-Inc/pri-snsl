# Deployment Guide

## Purpose

This guide turns PRI-SNSL deployment into a repeatable operational procedure.

Use it before deploying scanner, dashboard, report-script, or configuration changes. The main goals are to avoid stale tablet versions, avoid losing unsynced browser queue data, and make rollback possible without relying on original developer memory.

Do not use this guide to rotate credentials. Use `docs/SECRETS_INVENTORY.md` for credential ownership and rotation planning.

## System Overview

- PRI-SNSL is a static Progressive Web App.
- Production hosting is expected to be Vercel or another static host. The repo contains `vercel.json`, which serves the repo root with no build command.
- Supabase is the backend database for operators, stations, part mappings, and scan records.
- Browser code contains hardcoded Supabase frontend configuration.
- `service-worker.js` caches the app shell for offline loading.
- Accepted scans are stored in browser IndexedDB before Supabase sync, so browser site data can temporarily contain unsynced production data.

## Critical Deployment Risks

- **Stale service worker:** Tablets may keep running old cached files if the service worker/cache version does not move clients to the new release.
- **`CACHE_VERSION` dependency:** `service-worker.js` uses `CACHE_VERSION` to name the cache and delete older caches. The current inspected value is `v8.8.5`.
- **Version badge mismatch:** `index.html` displays the scanner version badge. The README says the scanner UI and service worker are currently `v8.8.5`.
- **IndexedDB queue data:** Pending scans live in browser IndexedDB. Clearing site data while pending count is above zero can delete unsynced scans.
- **Hardcoded frontend Supabase config:** Supabase URL/key changes require frontend source edits, redeploy, and cache verification. Updating GitHub Actions secrets alone does not update tablets.
- **Rollback can also be cached:** Promoting an older Vercel deployment may not be enough if tablets still run a different cached service worker/app shell.
- **No build/package workflow found:** Repository inspection did not find `package.json` or a frontend build step. Do not invent one during deployment.

## Pre-Deployment Checklist

Complete this checklist before deploying:

- [ ] Identify release purpose in one sentence.
- [ ] Confirm whether the change affects scanner behavior, dashboard behavior, report generation, Supabase credentials, or documentation only.
- [ ] Confirm there is no active production incident that would make deployment unsafe.
- [ ] Ask operations whether any tablet has pending scans that are stuck or business-critical.
- [ ] Do not tell users to clear browser/site data if any tablet has pending scans above zero.
- [ ] Confirm Git working tree contains only intended changes.
- [ ] Identify the current production rollback point: previous Vercel production deployment or previous Git commit.
- [ ] Confirm Vercel access: TODO owner, TODO backup owner.
- [ ] Confirm GitHub repo/admin access: TODO owner, TODO backup owner.
- [ ] Confirm Supabase access if the change touches `app.js`, `dashboard.html`, `my-scans.html`, `supabase-health.js`, or report scripts.
- [ ] Decide whether `CACHE_VERSION` must change.
- [ ] If scanner behavior changes, confirm `index.html` version badge and `service-worker.js` version expectations are aligned.
- [ ] If frontend Supabase config changes, follow `docs/SECRETS_INVENTORY.md` before deployment.
- [ ] If report scripts change, confirm `.github/workflows/daily-report.yml` can still run manually.

## Versioning Rules

Current inspected version references:

- README current version: `v8.8.5`.
- `service-worker.js` header and `CACHE_VERSION`: `v8.8.5`.
- `index.html` version badge/footer: `v8.8.5`.
- `app.js` contains version history comments at the top. It is not a formal changelog.

Operational rules:

1. Treat `service-worker.js` `CACHE_VERSION` as the browser cache release identifier.
2. Treat the visible version badge in `index.html` as the operator/admin runtime check.
3. For scanner behavior, parsing, Supabase config, cached assets, dashboard, or my-scans changes, decide explicitly whether the cache version needs to change.
4. If `CACHE_VERSION` changes, align all human-visible version references in the same release.
5. Do not rely on GitHub Actions report secrets to update frontend Supabase keys. Frontend keys are hardcoded browser assets.

When to bump `CACHE_VERSION`:

- Bump for scanner behavior changes.
- Bump for changes to files listed in `service-worker.js` `CORE_ASSETS`.
- Bump for Supabase browser config changes.
- Bump for stale-cache fixes.
- Usually bump for dashboard/my-scans changes if users must reliably receive the change.
- Documentation-only changes do not require a cache version bump.

## Deployment Procedure

### 1. Review The Change

1. Read the diff.
2. Confirm no secret values were added.
3. Confirm no unrelated application code changed.
4. Confirm whether `CACHE_VERSION` and visible version references are correct for the release.
5. Confirm rollback point is known.

### 2. Verify Locally Enough For The Change

Use the smallest practical verification:

- Documentation-only: read the rendered Markdown or raw file.
- Scanner/frontend changes: open the app locally or from a preview deployment if available.
- Report changes: run `scripts/daily_report.py --test` only with approved local credentials.
- Supabase/config changes: verify against Supabase with a controlled test, not during active production scanning if avoidable.

### 3. Commit And Push

1. Commit only intended files.
2. Push through the normal repository branch flow.
3. If Vercel Git integration is configured, expect Vercel to create a deployment from the pushed commit.

TODO: Document the actual production branch and Vercel project name.

### 4. Confirm Vercel Deployment

1. Open the Vercel project.
2. Find the deployment for the commit.
3. Confirm status is ready/successful.
4. Confirm production alias points at the intended deployment if this is a production release.
5. Record deployment URL, commit SHA, deploy time, and person deploying.

If no Vercel deployment appears, check:

- GitHub/Vercel integration access.
- Correct branch.
- Vercel project ownership.
- Whether a manual Vercel deploy is required for this project.

### 5. Production Verification

Complete the post-deployment verification checklist below before telling operations the release is ready.

## Post-Deployment Verification

Perform these checks from the production URL unless validating a preview:

- [ ] Scanner page loads.
- [ ] Visible version badge matches expected release.
- [ ] Browser console does not show obvious load errors.
- [ ] Internet badge shows online when the device has network.
- [ ] Supabase badge reaches `OK` or `SLOW`, not persistent `DOWN`.
- [ ] Operator list loads.
- [ ] Station list loads.
- [ ] Pending count is visible.
- [ ] If using a production tablet, pending count is zero before any cache-clearing action.
- [ ] Controlled test scan succeeds or queues only for an expected reason.
- [ ] Dashboard loads.
- [ ] Dashboard can read scan data.
- [ ] My-scans page loads if it is part of the release.
- [ ] If dashboard export changed, CSV/XLSX export still works.
- [ ] If report scripts changed, run the GitHub `Daily Build Report` workflow manually in test mode where possible.
- [ ] Confirm daily report scheduling assumptions were not changed. Automatic scheduling is external via cron-job.org per `.github/workflows/daily-report.yml`.

Minimum verification for documentation-only deploy:

- [ ] New doc appears in the repository.
- [ ] Vercel production app still loads.
- [ ] No app files were changed unintentionally.

## Rollback Procedure

Use rollback when production behavior is broken and a forward fix is not ready.

### 1. Decide Whether Rollback Is Safe

1. Identify what broke.
2. Confirm whether any schema, credential, or Supabase data change accompanied the deploy.
3. If credentials or Supabase schema changed, rollback may not restore service by itself.
4. Check whether tablets have pending scans. Do not clear site data while pending count is above zero.

### 2. Identify Previous Deployment

1. Open Vercel deployments.
2. Find the last known-good production deployment.
3. Record its URL/ID and commit SHA.

### 3. Promote Or Roll Back In Vercel

Preferred operational path:

1. Promote the last known-good deployment in Vercel, or use Vercel rollback if that is the established project workflow.
2. Confirm production alias now points to the rollback deployment.
3. Record rollback time, person, and deployment ID.

TODO: Document the exact PRI Vercel rollback method once project access is confirmed.

### 4. Verify After Rollback

- [ ] Scanner loads.
- [ ] Version badge is expected for rollback deployment.
- [ ] Supabase badge reaches `OK` or `SLOW`.
- [ ] Operator/station lists load.
- [ ] Controlled scan succeeds or queues for expected reason.
- [ ] Dashboard reads data.
- [ ] Pending queues are not cleared accidentally.

### 5. Handle Cache After Rollback

If tablets still show the broken version:

1. Confirm pending count is zero on the affected tablet.
2. Close all scanner tabs and reopen the app.
3. Hard refresh if available.
4. Escalate to a technical admin before clearing site data.
5. Use `force-cache-clear.html` only as a last-resort reference because it is stale and references older versions.

## Stale Cache Recovery

Use this section when Vercel shows the right deployment but a tablet still behaves like an old version.

### Do Not Clear Site Data When

- Pending count is above zero.
- Operator says scans are queued.
- Supabase badge is down/checking and scans have been accepted.
- You have not confirmed whether IndexedDB contains unsynced scans.

Clearing site data can delete unsynced production scans.

### Safer Recovery Order

1. Confirm expected production version in Vercel.
2. Confirm expected `CACHE_VERSION` in deployed `service-worker.js`.
3. On the tablet, check visible version badge.
4. Close all scanner tabs.
5. Reopen the scanner URL.
6. Wait 30 to 60 seconds for the service worker update/reload path.
7. If still stale and pending count is zero, try hard refresh or browser cache clear for cached files only.
8. If still stale, escalate to technical admin.

### `force-cache-clear.html` Limitations

- It exists at repo root but is not an integrated admin runbook.
- It references older versions (`v8.6.4`/`v8.6.6`) while current inspected version is `v8.8.3`.
- It instructs users to use browser developer tools.
- It does not itself protect IndexedDB queue data.

Do not use it as an operator-facing procedure without supervisor/technical admin review.

## Deployment Failure Scenarios

### Deployment succeeds but tablets are stale

Likely causes:

- `CACHE_VERSION` was not changed when needed.
- Tablet still has old service worker/app shell.
- Browser has cached old files.

Response:

1. Verify Vercel production deployment.
2. Compare version badge and `service-worker.js` `CACHE_VERSION`.
3. Follow stale cache recovery.
4. Do not clear site data until pending count is zero.

### Scans queue unexpectedly after deploy

Likely causes:

- Supabase unreachable.
- Browser Supabase key/config mismatch.
- RLS/schema/permission issue.
- Scanner request blocked or failing.

Response:

1. Check internet and Supabase badges.
2. Check operator/station load.
3. Confirm frontend Supabase config was not changed accidentally.
4. Leave queued tablets open.
5. If both badges recover but queue remains stuck, escalate for IndexedDB/Supabase inspection.

### Supabase auth failure after deploy

Likely causes:

- Hardcoded anon key changed incorrectly.
- Supabase key rotated without frontend update.
- Wrong project URL deployed.

Response:

1. Confirm deployed `app.js`, `dashboard.html`, and `my-scans.html` point to expected Supabase project.
2. Follow `docs/SECRETS_INVENTORY.md` Supabase key rotation procedure.
3. Redeploy corrected frontend.
4. Verify scanner/dashboard.

### Dashboard mismatch

Likely causes:

- Dashboard file cached differently than scanner.
- Dashboard hardcoded Supabase config differs from scanner config.
- Dashboard password changed without communication.

Response:

1. Confirm deployed `dashboard.html` version/config.
2. Confirm dashboard can read Supabase data.
3. Confirm scanner and dashboard use the same intended Supabase project.
4. Check cache behavior if only one browser/tablet is affected.

### Version mismatch

Likely causes:

- `index.html` badge, README, `app.js` comments, and `service-worker.js` `CACHE_VERSION` were not aligned.
- Stale browser cache.

Response:

1. Identify expected release version.
2. Compare visible badge and deployed `service-worker.js`.
3. If source references disagree, prepare a corrective version-only release.
4. If source is correct but tablet is stale, follow stale cache recovery.

### Accidental broken release

Response:

1. Stop further changes.
2. Confirm whether production scanning can continue safely.
3. If scanning is broken, rollback to last known-good Vercel deployment.
4. Tell operators not to clear site data.
5. Verify rollback.
6. Open a follow-up issue or incident note with cause and corrective action.

## Ownership / Access Gaps

- Vercel project name is not documented in the repo.
- Vercel owner and backup owner are not documented.
- Production branch and Vercel Git integration details are not documented.
- GitHub repository admin and backup admin are not documented.
- No deployment approver is documented.
- No rollback approver is documented.
- Supabase owner and backup owner are not documented.
- No tablet/cache recovery owner is documented.
- No production verification checklist owner is documented.

## Immediate Recommendations

- Document the live Vercel project name, team/account, production domain, production branch, and backup admin.
- Confirm whether production deploys are automatic from GitHub or manually promoted in Vercel.
- Create a release log with deployment date, commit SHA, version, Vercel deployment URL, deployer, verifier, and rollback point.
- Add a short versioning checklist to every scanner release: `app.js` comments, `index.html` badge/footer, README version, and `service-worker.js` `CACHE_VERSION`.
- Replace or update `force-cache-clear.html` before using it as an admin procedure.
- Create a supervisor runbook for checking pending IndexedDB queues before cache clearing.
- Add a test/verification workflow in GitHub before relying on non-developer deployment.
- Create a disaster-recovery document for rebuilding hosting if Vercel access is lost.
