# Material Source Grouping and External Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the coarse Facebook import folder with account-based smart groups and add a restricted, idempotent Guangdada ingestion channel that stores each exact media file only once.

**Architecture:** `Material` remains the canonical asset and R2 owner. Read-only smart groups derive Facebook membership from existing mappings and external membership from a new `MaterialOriginMapping` collection. Facebook and external ingestion share a source-neutral content identity, while a BullMQ worker and six-hour cron provide bounded, pausable, observable external synchronization.

**Tech Stack:** TypeScript, Express, Mongoose, BullMQ/Redis, node-cron, React/Vite, Jest, Node test runner, Cloudflare R2, GitHub Actions.

---

## Preconditions and Safety Rails

- Work only in `/Users/zww/autoark/.worktrees/facebook-material-ingestion` on `codex/material-source-grouping`.
- Preserve the clean release base at `/Users/zww/autoark`.
- Never place the supplied provider key in source, tests, command arguments, logs, fixtures, Git history, API payloads, or frontend code.
- Use `GUANGDADA_API_KEY` only through process environment and rotate the currently shared key after the new secret path is live.
- Keep external scheduling disabled until the Facebook grouping, dry run, and 10/100-item canaries pass in production.
- Commit after every task; do not combine deployment authorization or production secret rotation with an unreviewed code commit.

## Task 1: Add Explicit External-Material Permissions

**Files:**

- Modify: `autoark-backend/src/models/User.ts`
- Modify: `autoark-backend/src/utils/jwt.ts`
- Modify: `autoark-backend/src/middlewares/auth.ts`
- Modify: `autoark-backend/src/utils/userInput.ts`
- Modify: `autoark-backend/src/services/user.service.ts`
- Modify: `autoark-backend/src/controllers/user.controller.ts`
- Create: `autoark-backend/src/utils/materialPermission.ts`
- Modify: `autoark-backend/tests/user-service-permissions.test.ts`
- Create: `autoark-backend/tests/material-external-permissions.test.ts`

- [ ] **Step 1: Write failing permission-boundary tests**

Add cases proving:

```ts
expect(canReadExternalMaterials(superAdmin)).toBe(true)
expect(canManageExternalMaterials(superAdmin)).toBe(true)
expect(canReadExternalMaterials(explicitReader)).toBe(true)
expect(canManageExternalMaterials(explicitReader)).toBe(false)
expect(canReadExternalMaterials(ordinaryOrgAdmin)).toBe(false)
expect(canReadExternalMaterials(member)).toBe(false)
```

Also prove only a super administrator can grant or revoke these permissions and that `authenticate` refreshes permissions from the current user document instead of trusting stale JWT claims.

- [ ] **Step 2: Run the focused tests and confirm red**

Run:

```bash
cd autoark-backend
npx jest tests/material-external-permissions.test.ts tests/user-service-permissions.test.ts --runInBand
```

Expected: failures for missing `UserPermission`, permission helpers, and sanitized user updates.

- [ ] **Step 3: Add the smallest permission model**

Implement:

```ts
export enum UserPermission {
  MATERIALS_EXTERNAL_READ = 'materials:external:read',
  MATERIALS_EXTERNAL_MANAGE = 'materials:external:manage',
}

permissions: [{
  type: String,
  enum: Object.values(UserPermission),
}]
```

Extend `JwtPayload` with `permissions?: UserPermission[]`, but set `req.user.permissions` from the fresh database user loaded by `authenticate`. Add `canReadExternalMaterials` and `canManageExternalMaterials`; super administrators always pass, and manage implies read.

- [ ] **Step 4: Whitelist permission edits and audit them**

Allow `permissions` through create/update sanitizers only for super-admin actions. Include the permission list in the existing user update audit `after` snapshot without exposing any credentials.

- [ ] **Step 5: Run focused tests and TypeScript build**

Run:

```bash
npx jest tests/material-external-permissions.test.ts tests/user-service-permissions.test.ts --runInBand
npm run build
```

Expected: both suites pass and `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add autoark-backend/src/models/User.ts autoark-backend/src/utils/jwt.ts autoark-backend/src/middlewares/auth.ts autoark-backend/src/utils/userInput.ts autoark-backend/src/services/user.service.ts autoark-backend/src/controllers/user.controller.ts autoark-backend/src/utils/materialPermission.ts autoark-backend/tests/user-service-permissions.test.ts autoark-backend/tests/material-external-permissions.test.ts
git commit -m "feat: add external material permissions"
```

## Task 2: Introduce Source-Neutral Canonical Content Identity

**Files:**

- Create: `autoark-backend/src/utils/materialContentIdentity.ts`
- Modify: `autoark-backend/src/utils/facebookMaterialIdentity.ts`
- Modify: `autoark-backend/src/models/Material.ts`
- Modify: `autoark-backend/src/services/facebookMaterialIngestion.service.ts`
- Modify: `autoark-backend/src/services/facebookMaterialDeduplication.service.ts`
- Modify: `autoark-backend/tests/facebook-material-ingestion.test.ts`
- Modify: `autoark-backend/tests/facebook-material-deduplication.test.ts`
- Create: `autoark-backend/tests/material-content-identity.test.ts`

- [ ] **Step 1: Write failing compatibility and race-safety tests**

Cover global and organization-private scopes, an existing legacy `fb:*` fingerprint, and two concurrent source imports of identical bytes. Assert one active material and one retained R2 object.

- [ ] **Step 2: Run focused tests and confirm red**

```bash
cd autoark-backend
npx jest tests/material-content-identity.test.ts tests/facebook-material-ingestion.test.ts tests/facebook-material-deduplication.test.ts --runInBand
```

Expected: the source-neutral helper and SHA fallback do not yet exist.

- [ ] **Step 3: Implement a shared identity helper**

Use one key format for all new automatic imports:

```ts
export const buildMaterialFingerprintKey = (
  organizationId: string | undefined,
  sha256: string,
): string => {
  const scope = organizationId ? `organization:${organizationId}` : 'global'
  const scopeHash = createHash('sha256').update(scope).digest('hex').slice(0, 16)
  return `content:${scopeHash}:sha256:${sha256}`
}

export const buildActiveShaQuery = (
  organizationId: string | undefined,
  sha256: string,
) => ({
  organizationId: organizationId || { $in: [null] },
  status: { $in: ['uploaded', 'ready'] },
  'fingerprint.sha256': sha256,
})
```

Keep the existing Facebook helper exported for legacy callers, but route new writes through `buildMaterialFingerprintKey`. Before uploading, query by active scoped SHA so existing `fb:*` records are reused. Both Facebook and external writers must insert with the new shared key, so the existing unique `fingerprintKey` index resolves concurrent races.

- [ ] **Step 4: Add the scoped SHA lookup index**

Add a non-unique compatibility index:

```ts
materialSchema.index({ organizationId: 1, 'fingerprint.sha256': 1, status: 1 })
```

Do not rewrite historical keys or move existing R2 objects.

- [ ] **Step 5: Keep Facebook behavior intact except for physical folder assignment**

Remove `folder: 'Facebook导入'` from new material fields so Mongoose uses the normal default/manual-folder behavior. Preserve Facebook tags, mappings, `usage.accounts`, original-media preference, deleted-material rehydration, and loser-object cleanup.

- [ ] **Step 6: Run focused tests and build**

```bash
npx jest tests/material-content-identity.test.ts tests/facebook-material-ingestion.test.ts tests/facebook-material-deduplication.test.ts --runInBand
npm run build
```

Expected: all focused suites pass and the build exits 0.

- [ ] **Step 7: Commit**

```bash
git add autoark-backend/src/utils/materialContentIdentity.ts autoark-backend/src/utils/facebookMaterialIdentity.ts autoark-backend/src/models/Material.ts autoark-backend/src/services/facebookMaterialIngestion.service.ts autoark-backend/src/services/facebookMaterialDeduplication.service.ts autoark-backend/tests/material-content-identity.test.ts autoark-backend/tests/facebook-material-ingestion.test.ts autoark-backend/tests/facebook-material-deduplication.test.ts
git commit -m "refactor: share canonical material identity"
```

## Task 3: Build Facebook Account Smart Groups

**Files:**

- Create: `autoark-backend/src/services/materialSmartGroup.service.ts`
- Modify: `autoark-backend/src/controllers/material.controller.ts`
- Modify: `autoark-backend/src/routes/material.routes.ts`
- Create: `autoark-backend/tests/material-smart-groups.test.ts`
- Modify: `autoark-backend/tests/material-folder-regex.test.ts`

- [ ] **Step 1: Write failing smart-group service tests**

Prove:

- a canonical material mapped to accounts A and B appears once in each account group;
- the global Facebook count includes that material once, not twice;
- `facebookMappings.accountId` wins over `source.externalAccountId`, which wins over `usage.accounts`;
- no recoverable account enters `未归属账户`;
- duplicate account names use the last four account-ID characters;
- disabled accounts remain visible with a status badge;
- both `ready` and `uploaded` count as active.

- [ ] **Step 2: Run the new suite and confirm red**

```bash
cd autoark-backend
npx jest tests/material-smart-groups.test.ts tests/material-folder-regex.test.ts --runInBand
```

Expected: missing service, controller, and route behavior.

- [ ] **Step 3: Implement virtual membership and unique counts**

Return a stable contract:

```ts
export interface MaterialSmartGroupNode {
  key: string
  type: 'facebook-root' | 'facebook-account' | 'external-root' | 'external-provider' | 'external-package'
  label: string
  count: number
  status?: 'active' | 'disabled' | 'unavailable' | 'paused'
  children?: MaterialSmartGroupNode[]
}
```

Use an aggregation that first projects one distinct account-ID array per material, then unwinds and groups. Never sum mapping rows directly. Join labels/status from `Account` and use `__unassigned__` for the fallback group.

- [ ] **Step 4: Add explicit smart-group list filters**

Extend `GET /api/materials` with sanitized `smartGroupType` and `smartGroupKey`. For Facebook account filters, encode the same fallback precedence used by the group service; do not match `source.externalAccountId` when a Facebook mapping already exists.

Add `GET /api/materials/smart-groups` before `/:id` in `material.routes.ts`.

- [ ] **Step 5: Fix manual-folder counts**

Change the folder-tree active filter to:

```ts
const baseFilter = combineFilters(
  { status: { $in: ['uploaded', 'ready'] } },
  getMaterialFilter(req),
)
```

Keep manual folder create/rename/move/delete behavior unchanged. Smart-group keys must never enter a folder mutation endpoint.

- [ ] **Step 6: Run tests and build**

```bash
npx jest tests/material-smart-groups.test.ts tests/material-folder-regex.test.ts tests/facebook-material-ingestion.test.ts --runInBand
npm run build
```

Expected: all suites pass and `tsc` exits 0.

- [ ] **Step 7: Commit**

```bash
git add autoark-backend/src/services/materialSmartGroup.service.ts autoark-backend/src/controllers/material.controller.ts autoark-backend/src/routes/material.routes.ts autoark-backend/tests/material-smart-groups.test.ts autoark-backend/tests/material-folder-regex.test.ts
git commit -m "feat: group Facebook materials by account"
```

## Task 4: Model External Origins and Normalize Guangdada Records

**Files:**

- Create: `autoark-backend/src/models/MaterialOriginMapping.ts`
- Create: `autoark-backend/src/integration/guangdada/types.ts`
- Create: `autoark-backend/src/integration/guangdada/client.ts`
- Create: `autoark-backend/src/integration/guangdada/normalize.ts`
- Create: `autoark-backend/tests/guangdada-client.test.ts`
- Create: `autoark-backend/tests/guangdada-normalize.test.ts`

- [ ] **Step 1: Add an environment-only response-shape canary**

Write a test skipped unless `GUANGDADA_LIVE_CANARY=1`. Once the live flag is set, a missing `GUANGDADA_API_KEY` must fail the selected test explicitly instead of producing a zero-test green run. It requests one record from `GET https://4437799.com/api/v1/ads?page=1&page_size=1&recent_days=3&sort_by=estimated_value`, asserts only the documented envelope (`data`, `pagination`, `videos`), and prints field names/counts only. It must never print headers, values, media URLs, raw records, or the key.

- [ ] **Step 2: Write mocked failing client/normalizer tests**

Cover Bearer authentication, query bounds, pagination, 401/403 pause classification, `Retry-After` on 429, retryable 5xx, redacted errors, video extraction, stable asset identity, package labels/keys, and estimated-value then heat sorting.

- [ ] **Step 3: Run focused tests and confirm red**

```bash
cd autoark-backend
npx jest tests/guangdada-client.test.ts tests/guangdada-normalize.test.ts --runInBand
```

Expected: modules and model do not yet exist.

- [ ] **Step 4: Implement the origin mapping schema and indexes**

Store bounded safe metadata only:

```ts
{
  provider: 'guangdada',
  providerAssetKey: string,
  materialId: ObjectId,
  packageKey: string,
  packageName?: string,
  productName?: string,
  advertiserName?: string,
  mediaType: 'image' | 'video',
  mediaRole: string,
  mediaIndex: number,
  firstSeenAt: Date,
  lastSeenAt: Date,
  heat?: number,
  estimatedValue?: number,
  sourcePageUrl?: string,
  lastMediaUrl?: string,
}
```

Add unique `{ provider: 1, providerAssetKey: 1 }` plus query indexes `{ provider: 1, packageKey: 1, lastSeenAt: -1 }` and `{ materialId: 1, provider: 1 }`. Do not store raw provider payloads or credentials.

- [ ] **Step 5: Implement the bounded API client and normalizer**

Read the key at call time:

```ts
const apiKey = process.env.GUANGDADA_API_KEY
if (!apiKey) throw new ProviderConfigurationError('GUANGDADA_API_KEY is not configured')
```

Clamp `pageSize`, `recentDays`, and overall records to explicit constants. Normalize native record/media IDs first; when a media ID is absent, hash the record identity, media type/index, and normalized HTTPS URL. Hash normalized package identity into an opaque `packageKey` while keeping the safe display label separately.

- [ ] **Step 6: Run mocked tests, then the opt-in canary**

```bash
PATH=/Users/zww/.nvm/versions/node/v24.14.1/bin:$PATH npm test -- --runInBand tests/guangdada-client.test.ts tests/guangdada-normalize.test.ts
GUANGDADA_LIVE_CANARY=1 GUANGDADA_API_KEY="$GUANGDADA_API_KEY" PATH=/Users/zww/.nvm/versions/node/v24.14.1/bin:$PATH npm test -- --runInBand tests/guangdada-client.test.ts -t "live response shape"
```

Expected: mocked suites pass and skip the live canary when the flag is absent. With the live flag set, the selected canary passes only when `GUANGDADA_API_KEY` was safely injected beforehand; otherwise it fails explicitly. No secret or raw provider data appears in output.

- [ ] **Step 7: Commit**

```bash
git add autoark-backend/src/models/MaterialOriginMapping.ts autoark-backend/src/integration/guangdada/types.ts autoark-backend/src/integration/guangdada/client.ts autoark-backend/src/integration/guangdada/normalize.ts autoark-backend/tests/guangdada-client.test.ts autoark-backend/tests/guangdada-normalize.test.ts
git commit -m "feat: model Guangdada material origins"
```

## Task 5: Add a Safe Remote-Media Downloader

**Files:**

- Create: `autoark-backend/src/services/remoteMediaDownload.service.ts`
- Create: `autoark-backend/tests/remote-media-download.test.ts`

- [ ] **Step 1: Write failing SSRF and stream-limit tests**

Cover HTTPS-only URLs; credentials in URLs; loopback, private, link-local, multicast, documentation, unspecified, IPv4-mapped IPv6, and reserved IPv4/IPv6 ranges; DNS answers containing any blocked address; DNS-rebinding attempts; redirect revalidation; redirect limits; MIME allowlist; declared and streamed size limits; connection/total timeout; and safe filenames.

- [ ] **Step 2: Run the suite and confirm red**

```bash
cd autoark-backend
npx jest tests/remote-media-download.test.ts --runInBand
```

Expected: downloader module is missing.

- [ ] **Step 3: Implement resolve-before-connect validation**

Accept only `https:` with no username/password. Resolve all A/AAAA answers and reject the URL if any answer is non-public. Pin the outbound connection to one of the already validated addresses through a custom lookup/agent while preserving the original hostname for TLS SNI and certificate verification; do not perform an unvalidated second DNS lookup. For every redirect, repeat URL parsing, DNS resolution, address validation, and connection pinning before the next request. Set `maxRedirects: 0` on the underlying client and follow redirects in application code.

- [ ] **Step 4: Enforce streaming limits**

Allow only approved image/video MIME types, cap response bytes while iterating chunks, abort on overflow, and apply connect, response, and total timeouts. Return a buffer only after all validations pass. Errors must contain a category and host, never query strings, response bodies, or authorization headers.

- [ ] **Step 5: Run tests and build**

```bash
npx jest tests/remote-media-download.test.ts --runInBand
npm run build
```

Expected: all downloader cases pass and `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add autoark-backend/src/services/remoteMediaDownload.service.ts autoark-backend/tests/remote-media-download.test.ts
git commit -m "feat: safely download external media"
```

## Task 6: Implement Idempotent External Material Ingestion

**Files:**

- Create: `autoark-backend/src/services/externalMaterialIngestion.service.ts`
- Modify: `autoark-backend/src/services/r2Storage.service.ts`
- Create: `autoark-backend/tests/external-material-ingestion.test.ts`

- [ ] **Step 1: Write failing idempotency and scope tests**

Assert:

- the same provider asset updates `lastSeenAt` without downloading again;
- a provider mapping whose material is deleted is remapped to an active canonical material instead of returning a stale object;
- different provider asset IDs with identical bytes share one global `Material` and one R2 object;
- a Guangdada asset identical to a global Facebook material reuses it;
- a global origin never attaches to an organization-private material;
- a uniqueness-race loser deletes its new R2 object and maps to the winner;
- origin-upsert retry never redownloads already stored media;
- one invalid item does not abort unrelated records.

- [ ] **Step 2: Run the suite and confirm red**

```bash
cd autoark-backend
npx jest tests/external-material-ingestion.test.ts --runInBand
```

Expected: ingestion service is missing.

- [ ] **Step 3: Implement pre-download provider deduplication**

For each normalized candidate, query `{ provider, providerAssetKey }`. If found, update observation/ranking metadata and return `alreadySeen` without calling the downloader.

- [ ] **Step 4: Implement post-download canonical deduplication**

After a safe download, compute SHA256 and MD5, query active global materials by scoped SHA, and reuse the winner. Otherwise upload under `global/external/guangdada`, insert a `ready` `Material` with `buildMaterialFingerprintKey(undefined, sha256)`, then upsert the origin mapping.

Use this result contract:

```ts
type ExternalIngestionOutcome =
  | { kind: 'alreadySeen'; materialId: string }
  | { kind: 'contentReused'; materialId: string }
  | { kind: 'created'; materialId: string }
  | { kind: 'invalid'; reason: string }
  | { kind: 'failed'; retryable: boolean; category: string }
```

- [ ] **Step 5: Close database/storage race windows**

On duplicate-key insertion, find the active canonical winner by shared fingerprint key, delete only the losing upload key, and upsert the origin to the winner. If mapping upsert fails after material success, retry the mapping idempotently and return failure without deleting the canonical material.

- [ ] **Step 6: Run tests and build**

```bash
npx jest tests/external-material-ingestion.test.ts tests/material-content-identity.test.ts tests/facebook-material-ingestion.test.ts --runInBand
npm run build
```

Expected: one canonical record/object across all tested duplicate paths.

- [ ] **Step 7: Commit**

```bash
git add autoark-backend/src/services/externalMaterialIngestion.service.ts autoark-backend/src/services/r2Storage.service.ts autoark-backend/tests/external-material-ingestion.test.ts
git commit -m "feat: ingest external materials idempotently"
```

## Task 7: Add Run State, Queue, Cron, and Control APIs

**Files:**

- Create: `autoark-backend/src/models/ExternalMaterialSyncRun.ts`
- Create: `autoark-backend/src/models/ExternalMaterialSyncState.ts`
- Create: `autoark-backend/src/queue/externalMaterial.queue.ts`
- Create: `autoark-backend/src/queue/externalMaterial.worker.ts`
- Create: `autoark-backend/src/cron/externalMaterial.cron.ts`
- Create: `autoark-backend/src/controllers/externalMaterial.controller.ts`
- Modify: `autoark-backend/src/routes/material.routes.ts`
- Modify: `autoark-backend/src/cron/index.ts`
- Modify: `autoark-backend/src/server.ts`
- Create: `autoark-backend/tests/external-material-queue.test.ts`
- Create: `autoark-backend/tests/external-material-controller.test.ts`

- [ ] **Step 1: Write failing queue, state, and authorization tests**

Cover one active run, deterministic scheduled job IDs, Redis lock ownership, lock expiry/renewal, pause/resume, missing-key disabled behavior, 401/403 credential pause, 429 delay, bounded retries, 5xx retry, dry run with zero downloads, and role/permission checks on all status/control routes.

- [ ] **Step 2: Run focused tests and confirm red**

```bash
cd autoark-backend
npx jest tests/external-material-queue.test.ts tests/external-material-controller.test.ts --runInBand
```

Expected: queue, worker, state models, and controller are missing.

- [ ] **Step 3: Add persistent run/state records**

`ExternalMaterialSyncState` is one document per provider with `paused`, `pauseReason`, `recurringEnabled`, `backfillCursor`, and timestamps. `ExternalMaterialSyncRun` records mode, bounded request, status, cursor, and counters:

```ts
{
  discovered: 0,
  considered: 0,
  alreadySeen: 0,
  downloaded: 0,
  contentReused: 0,
  newlyCreated: 0,
  invalid: 0,
  failed: 0,
  deferred: 0,
}
```

Store only a bounded redacted error sample.

- [ ] **Step 4: Implement bounded job modes**

Use:

```ts
const SYNC_DEFAULTS = {
  scheduled: { recentDays: 3, limit: 500 },
  backfill: { recentDays: 30, limit: 2000 },
  canary10: { recentDays: 3, limit: 10 },
  canary100: { recentDays: 3, limit: 100 },
} as const
```

Fetch bounded pages, sort by estimated value then heat, process items independently, update progress after every batch, and make backfill cursor resumable. Dry run fetches/normalizes/counts but never downloads or writes materials/origins.

- [ ] **Step 5: Prevent overlap in both enqueue and execution paths**

Before enqueue, reject when an active/waiting scheduled job exists. In the worker, acquire a provider-scoped Redis `SET NX PX` lock with a random owner token, renew only when the token still matches, and release with compare-and-delete. A fixed schedule job ID is an additional guard, not the only lock.

- [ ] **Step 6: Wire cron and bootstrap behind a feature flag**

Schedule `0 */6 * * *`, but enqueue only when `EXTERNAL_MATERIAL_SYNC_ENABLED=true`, the provider state is not paused, recurring is enabled, and the key is present. Initialize the queue worker after Redis and before cron in `server.ts`.

- [ ] **Step 7: Add restricted APIs before `/:id` routes**

Implement:

```text
GET  /api/materials/external/guangdada/status
POST /api/materials/external/guangdada/sync
POST /api/materials/external/guangdada/pause
POST /api/materials/external/guangdada/resume
```

Read status requires external-read; mutations require external-manage. Clamp `dryRun`, `recentDays`, `limit`, and mode server-side. Ordinary users receive 403 with no provider counts, IDs, URLs, or configuration state.

- [ ] **Step 8: Run tests and build**

```bash
npx jest tests/external-material-queue.test.ts tests/external-material-controller.test.ts tests/external-material-ingestion.test.ts --runInBand
npm run build
```

Expected: focused tests pass and `tsc` exits 0.

- [ ] **Step 9: Commit**

```bash
git add autoark-backend/src/models/ExternalMaterialSyncRun.ts autoark-backend/src/models/ExternalMaterialSyncState.ts autoark-backend/src/queue/externalMaterial.queue.ts autoark-backend/src/queue/externalMaterial.worker.ts autoark-backend/src/cron/externalMaterial.cron.ts autoark-backend/src/controllers/externalMaterial.controller.ts autoark-backend/src/routes/material.routes.ts autoark-backend/src/cron/index.ts autoark-backend/src/server.ts autoark-backend/tests/external-material-queue.test.ts autoark-backend/tests/external-material-controller.test.ts
git commit -m "feat: schedule external material sync"
```

## Task 8: Expose External Smart Groups and Safe Origin Summaries

**Files:**

- Modify: `autoark-backend/src/services/materialSmartGroup.service.ts`
- Create: `autoark-backend/src/services/materialQuery.service.ts`
- Modify: `autoark-backend/src/controllers/material.controller.ts`
- Modify: `autoark-backend/src/routes/material.routes.ts`
- Modify: `autoark-backend/tests/material-smart-groups.test.ts`
- Create: `autoark-backend/tests/material-origin-routes.test.ts`

- [ ] **Step 1: Write failing visibility/query tests**

Prove the external root is absent for ordinary users, present for super-admin/explicit readers, packages nest under `外部优质素材 → 广大大`, package counts are unique material counts, one material can have several origin mappings without double-counting, and `GET /:id/origins` returns safe summaries only.

- [ ] **Step 2: Run focused tests and confirm red**

```bash
cd autoark-backend
npx jest tests/material-smart-groups.test.ts tests/material-origin-routes.test.ts --runInBand
```

Expected: external groups and origin routes are absent.

- [ ] **Step 3: Add the external package aggregation**

Join mappings to active `uploaded`/`ready` materials, then group by `packageKey`, collect unique active material IDs with `$addToSet`, and count `$size`. Choose `productName · packageName`, the available value, or `未识别产品` as the label. Add provider paused status without exposing configuration details.

- [ ] **Step 4: Add external material-page querying**

For `smartGroupType=external-package`, use a Mongo aggregation with `$lookup` from origin mappings, apply provider/package and active-material filters before sort/skip/limit, and produce list/total in one `$facet`. Do not load an unbounded material-ID array into application memory.

- [ ] **Step 5: Add safe origin summaries**

Return provider, package/product label, advertiser, ranking snapshots, first/last seen timestamps, media type, and safe source page URL. Exclude provider asset keys, raw media URLs, metadata payloads, and all credentials.

- [ ] **Step 6: Run tests and build**

```bash
npx jest tests/material-smart-groups.test.ts tests/material-origin-routes.test.ts tests/material-external-permissions.test.ts --runInBand
npm run build
```

Expected: all suites pass and unauthorized requests reveal no external-library existence.

- [ ] **Step 7: Commit**

```bash
git add autoark-backend/src/services/materialSmartGroup.service.ts autoark-backend/src/services/materialQuery.service.ts autoark-backend/src/controllers/material.controller.ts autoark-backend/src/routes/material.routes.ts autoark-backend/tests/material-smart-groups.test.ts autoark-backend/tests/material-origin-routes.test.ts
git commit -m "feat: expose restricted external material groups"
```

## Task 9: Render Read-Only Smart Groups and Admin Controls

**Files:**

- Modify: `autoark-frontend/src/pages/MaterialLibraryPage.tsx`
- Modify: `autoark-frontend/src/pages/UserManagementPage.tsx`
- Modify: `autoark-frontend/src/contexts/AuthContext.tsx`
- Create: `autoark-frontend/src/services/materialSmartGroups.ts`
- Create: `autoark-frontend/tests/material-smart-groups.test.mjs`
- Create: `autoark-frontend/tests/external-material-permissions.test.mjs`

- [ ] **Step 1: Write failing frontend contract tests**

Assert the page fetches `/materials/smart-groups`, sends `smartGroupType`/`smartGroupKey` instead of `folder`, never opens create/rename/move/delete controls for smart groups, and renders source, account reuse, disabled/paused, empty, loading, and unavailable states. Also assert only super administrators see permission-grant checkboxes and only external-manage users see sync/pause/resume controls.

- [ ] **Step 2: Run the frontend test and confirm red**

```bash
cd autoark-frontend
node --test --test-name-pattern="material smart groups" tests/material-smart-groups.test.mjs
node --test tests/external-material-permissions.test.mjs
```

Expected: missing service and UI contract.

- [ ] **Step 3: Add typed smart-group loading and selection state**

Use separate state from physical folders:

```ts
type MaterialSelection =
  | { kind: 'all' }
  | { kind: 'folder'; path: string }
  | { kind: 'smart'; type: string; key: string; label: string }
```

When selection is smart, add smart-group query parameters and omit `folder`. Reset pagination on every selection change. Extend the authenticated `User` type with `permissions?: string[]`; continue refreshing it from `/api/auth/me` so grants and revocations take effect without trusting local storage alone.

- [ ] **Step 4: Render the approved hierarchy**

Render Facebook account nodes for all users who can see their materials. Render the external root only when the endpoint returns it. Use distinct icons and a read-only visual treatment. Context menus and folder mutation actions must accept only `{ kind: 'folder' }` selections.

- [ ] **Step 5: Add card/detail origin cues**

Show source badges, count of distinct Facebook accounts, and external product/package. Load the restricted origins endpoint only when the user opens origin details; handle 403 without disclosing external metadata. For external-manage users, show latest redacted run counters plus dry-run/sync-now and pause/resume actions with confirmation and bounded server-defined modes.

- [ ] **Step 6: Add super-admin permission controls**

Add two checkboxes to the existing user create/edit forms: `查看外部优质素材` and `管理外部素材同步`. Render them only for super administrators, send only the two allowlisted permission strings, and make manage select read automatically. Ordinary organization admins must neither see nor submit these fields.

- [ ] **Step 7: Run frontend tests and build**

```bash
npm test
npm run build
```

Expected: all Node tests pass and Vite production build succeeds.

- [ ] **Step 8: Commit**

```bash
git add autoark-frontend/src/pages/MaterialLibraryPage.tsx autoark-frontend/src/pages/UserManagementPage.tsx autoark-frontend/src/contexts/AuthContext.tsx autoark-frontend/src/services/materialSmartGroups.ts autoark-frontend/tests/material-smart-groups.test.mjs autoark-frontend/tests/external-material-permissions.test.mjs
git commit -m "feat: show material smart groups"
```

## Task 10: Add Secret-Safe Production Configuration

**Files:**

- Modify: `.github/workflows/prod-deploy.yml`
- Modify: `deploy/prod-deploy.sh`
- Modify: `deploy/env.example`
- Modify: `deploy/README.md`
- Create: `autoark-backend/tests/external-material-config.test.ts`
- Create: `deploy/tests/prod-secret-sync.test.sh`

- [ ] **Step 1: Write failing configuration and shell tests**

Prove production startup can leave external sync disabled without a key, enabling sync requires a non-empty key, the deployment helper updates only the named environment entry with mode 600, no value reaches command-line arguments, and logs contain only the variable name.

- [ ] **Step 2: Run tests and confirm red**

```bash
cd autoark-backend
npx jest tests/external-material-config.test.ts --runInBand
cd ..
bash deploy/tests/prod-secret-sync.test.sh
```

Expected: external configuration and secret-sync helper are absent.

- [ ] **Step 3: Add documented environment names with safe defaults**

Add names only:

```dotenv
GUANGDADA_API_KEY=
EXTERNAL_MATERIAL_SYNC_ENABLED=false
```

The key must not have a fallback. The feature flag defaults to false.

- [ ] **Step 4: Stream the GitHub Actions secret over standard input**

Expose `GUANGDADA_API_KEY: ${{ secrets.GUANGDADA_API_KEY }}` and `EXTERNAL_MATERIAL_SYNC_ENABLED: ${{ vars.EXTERNAL_MATERIAL_SYNC_ENABLED || 'false' }}` only to the deploy step. In `prod-deploy.sh`, pipe the secret value over SSH standard input to a remote script that atomically replaces `GUANGDADA_API_KEY=` in `/root/prod.env` and `/opt/autoark/deploy/.env`, then applies mode 600. Update the validated boolean feature flag in the same two files without printing either value. Do not interpolate the secret into the SSH command or enable shell tracing.

- [ ] **Step 5: Run secret-leak checks**

```bash
bash deploy/tests/prod-secret-sync.test.sh
git grep -nE "[g]da_[A-Za-z0-9_-]+" -- autoark-backend autoark-frontend deploy .github
git diff --check
```

Expected: shell tests pass; `git grep` returns no matches; diff check is clean.

- [ ] **Step 6: Run builds**

```bash
cd autoark-backend && npm run build
cd ../autoark-frontend && npm run build
```

Expected: both builds succeed.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/prod-deploy.yml deploy/prod-deploy.sh deploy/env.example deploy/README.md deploy/tests/prod-secret-sync.test.sh autoark-backend/tests/external-material-config.test.ts
git commit -m "chore: configure external material sync safely"
```

## Task 11: Full Regression, Review, and Production Rollout

**Files:**

- Modify only files required by verified review findings.
- Record runtime evidence in the pull-request description and deployment task output; do not commit secrets or raw provider responses.

- [ ] **Step 1: Run the full local regression suite**

```bash
cd autoark-backend
npm test -- --runInBand
npm run build
cd ../autoark-frontend
npm test
npm run build
cd ..
git diff --check origin/main...HEAD
```

Expected: all backend suites, frontend suites, and builds pass; diff check reports no whitespace errors.

- [ ] **Step 2: Run security and correctness review**

Review the final diff for tenant leaks, permission bypass, SSRF, secret exposure, duplicate-content races, queue overlap, unsafe retry storms, unbounded payloads, and route-order collisions. Apply findings with failing regression tests first, then rerun Step 1.

- [ ] **Step 3: Verify the branch contains no key material**

```bash
git grep -nE "[g]da_[A-Za-z0-9_-]+|Authorization: Bearer [A-Za-z0-9_-]+" -- autoark-backend autoark-frontend deploy .github
git log -p --all -- autoark-backend autoark-frontend deploy .github | grep -E "[g]da_[A-Za-z0-9_-]+" && exit 1 || true
```

Expected: no credential matches.

- [ ] **Step 4: Push and open a pull request**

```bash
git push -u origin codex/material-source-grouping
gh pr create --base main --head codex/material-source-grouping --title "Group materials by source and add external ingestion" --body-file /tmp/autoark-material-pr.md
```

Expected: PR created with test evidence, rollout flags, and rollback instructions; no credentials in the body.

- [ ] **Step 5: Wait for CI and merge only when green**

Confirm actual checks ran and passed. Merge without bypassing failing or missing checks. Record the merge commit.

- [ ] **Step 6: Deploy code with external scheduling disabled**

Deploy the exact merge commit. Verify the backend/frontend runtime commit matches it. Confirm `EXTERNAL_MATERIAL_SYNC_ENABLED=false` and no external queue jobs run.

- [ ] **Step 7: Verify Facebook grouping against production invariants**

Using authenticated read-only queries, prove:

```text
active Facebook materials = 2,076
distinct Facebook content files = 2,076
exact-content duplicate groups = 0
global Facebook smart-group unique count = 2,076
every active Facebook material belongs to one or more account groups or 未归属账户
new Facebook imports do not receive folder=Facebook导入
```

Sample multi-account materials and prove each card resolves to one material ID/storage key while appearing in every related account group.

- [ ] **Step 8: Install and rotate the provider secret**

Set the GitHub Actions `GUANGDADA_API_KEY` secret without printing it and set the repository variable `EXTERNAL_MATERIAL_SYNC_ENABLED=false`. Deploy once to synchronize the remote environment. Rotate the initially shared provider key, replace the GitHub secret with the rotated value, redeploy, and verify only that configuration is present—not its value.

- [ ] **Step 9: Run dry run and canaries**

As an authorized operator:

1. Run dry run with 3 days / 10 records; expect zero downloads and zero material writes.
2. Run live canary 10; verify counts, sampled MIME types, material cards, origins, and zero duplicates.
3. Run live canary 100; repeat the same checks and verify a rerun reports already-seen without redownload.

Pause immediately on 401/403, human-verification response, unexplained duplicate creation, private-network URL, or credential leakage.

- [ ] **Step 10: Run the pausable initial backfill**

Start 30 days / top 2,000. Confirm cursor and counters advance, pause/resume is idempotent, failed items do not stop unrelated items, and a restarted worker resumes without redownloading mapped assets.

- [ ] **Step 11: Enable the six-hour schedule and cross a boundary**

Set the repository variable `EXTERNAL_MATERIAL_SYNC_ENABLED=true`, redeploy the exact merge commit, and enable recurring state. Cross one `0 */6 * * *` boundary and prove exactly one run is queued/active, no overlap occurs, the run considers at most 500 records, and repeated provider identities are not downloaded.

- [ ] **Step 12: Final production verification and rollback readiness**

Confirm ordinary users cannot see external roots/status/origins, authorized readers cannot mutate sync state, managers can pause/resume, logs contain no headers/keys/raw responses, R2 retained-object count matches newly created canonical materials, and the previous deploy commit plus `EXTERNAL_MATERIAL_SYNC_ENABLED=false` provide a tested rollback path.

## Completion Criteria

- Facebook navigation is account-based and no longer depends on the coarse import folder.
- One canonical material can appear in multiple smart groups without duplicate database records or files.
- External materials are grouped by Guangdada product/package and are invisible without explicit permission.
- Provider identity prevents repeat downloads; SHA256 prevents cross-account, cross-campaign, and cross-provider duplicate storage.
- The top 500 recent records run every six hours without overlap only after canaries/backfill approval.
- Code, CI, deployment, canaries, backfill, and live schedule-boundary verification are reported separately.
