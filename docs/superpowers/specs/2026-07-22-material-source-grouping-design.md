# Material Source Grouping and External Creative Ingestion Design

**Status:** Draft for written review

**Date:** 2026-07-22

**Scope:** AutoArk material library, Facebook material grouping, and Guangdada external material ingestion

## Context

AutoArk currently stores every automatically imported Facebook material with the physical folder string `Facebook导入`. That implementation is too coarse for a library containing thousands of materials and cannot model reuse: a single canonical material can be associated with several Facebook ad accounts.

The existing data already contains most of the relationships needed for a better information architecture:

- `Material.facebookMappings` records Facebook account and creative relationships.
- `Material.source.externalAccountId` and `Material.usage.accounts` provide safe legacy fallbacks.
- `AdMaterialMapping` records account, campaign, ad set, creative, and ad relationships.
- `Material.folder` supports only one physical path and therefore must not represent multi-account membership.

The material folder tree also counts only `uploaded` materials, while Facebook ingestion creates `ready` materials. This makes valid imported material counts disappear from the folder navigation.

The approved external provider exposes a read-only HTTPS API at [4437799.com/api-docs](https://4437799.com/api-docs/). It uses a Bearer API key and returns paginated advertising materials. The query supports package/product filtering, recent-day filtering, and sorting by recency, heat, or estimated value. Video media URLs are returned in each record's `videos` array.

## Goals

1. Replace the coarse Facebook import folder with account-based smart groups.
2. Keep exactly one canonical `Material` and one scoped R2 object for identical content.
3. Allow one material to appear in every Facebook account group that uses it without copying the material.
4. Add a restricted external material channel grouped by Guangdada product/package.
5. Pull the best 500 recent external materials every six hours, with safe initial backfill and operational controls.
6. Reuse canonical global materials when Facebook and Guangdada provide identical bytes.
7. Preserve existing manual folders and organization isolation.

## Non-goals

- Grouping Facebook materials by campaign, ad set, or individual ad in this release.
- Replacing user-created manual folders.
- Automatically publishing external materials to Facebook.
- Exposing the external provider or its credentials to ordinary AutoArk users.
- Circumventing provider anti-bot controls or scraping provider web pages. AutoArk will use only the documented API.
- Deduplicating private organization materials into a global material in a way that could expose private metadata.

## Approved Information Architecture

The material library has two smart-group roots alongside the existing manual folder tree:

```text
Facebook
├── 全部 Facebook 素材
├── 未归属账户
├── 广告账户 A · 1234
├── 广告账户 B · 5678
└── 已停用账户 C · 9012

外部优质素材
└── 广大大
    ├── 产品 / 包名 A
    ├── 产品 / 包名 B
    └── 未识别产品
```

Facebook account names come from `Account.name`; the last four account ID characters disambiguate duplicate names. Disabled or unavailable accounts remain visible with a status badge so historical materials do not disappear.

A material associated with multiple accounts appears in each relevant account group. The card shows the number of associated accounts and an expandable account list. The global Facebook total counts each canonical material once; summing account group counts can be larger because reuse is intentional.

External smart groups are visible only to super administrators and explicitly authorized operations roles.

External package labels use `productName · packageName` when both values exist, otherwise the available value. Records with neither value enter `未识别产品`.

## Architecture

### 1. Canonical material remains the stored asset

`Material` remains the only asset record and continues to own storage URL, file metadata, fingerprints, lifecycle status, metrics, and manual folder placement.

Automatic imports stop assigning the physical folder `Facebook导入`. Smart-group membership is derived from source relationships. Existing user-created manual folders and manual move operations remain unchanged.

### 2. Facebook account smart groups

Facebook membership is derived in this order:

1. Every distinct `facebookMappings.accountId` value.
2. `source.externalAccountId` when no Facebook mapping is present.
3. `usage.accounts` as a legacy fallback.
4. `未归属账户` only when no account identifier can be recovered.

Account grouping is virtual. Renaming an account changes the displayed group name without updating materials or moving R2 objects.

The material query API gains an explicit Facebook-account filter. The smart-group endpoint returns group keys, names, statuses, and unique material counts. Both `ready` and `uploaded` are active library statuses.

### 3. External source mappings

A new `MaterialOriginMapping` collection represents a provider relationship independently from the canonical material. This avoids overloading the legacy single-source object and supports future providers without duplicating assets.

Important fields:

- `provider`: initially `guangdada`.
- `providerAssetKey`: stable provider record/media identity.
- `materialId`: canonical AutoArk material.
- `organizationId`: omitted for the approved global external library.
- `packageName`, `productName`, and `advertiserName`.
- `mediaType` and provider media role/index.
- `firstSeenAt` and `lastSeenAt`.
- `heat` and `estimatedValue` snapshots.
- `sourcePageUrl` and the last observed media URL.
- bounded provider metadata needed for diagnosis; no credentials or unbounded raw payloads.

Unique indexes prevent duplicate provider mappings. Query indexes support provider/package groups and material origin lookup.

Provider asset identity uses the provider's native material ID or ad key plus native media ID when available. If the API omits a native media ID, a stable hash of the provider record identity, media type, and normalized media URL is used. Implementation begins with a live response-shape canary before freezing this precedence.

### 4. Smart-group service

A focused service supplies smart-group navigation and material filters:

- Facebook adapter: account groups from material Facebook relationships.
- Guangdada adapter: package groups from `MaterialOriginMapping`.
- Shared output contract: key, label, source, status, count, and nested children.

Manual folders remain a separate API section. The frontend renders manual and smart groups together but never treats a smart group as a writable folder.

## External Ingestion Flow

### Scheduled query

Every six hours, one scheduler run requests recent Guangdada records with:

- `recent_days=3`
- `sort_by=estimated_value`
- enough bounded pages to consider at most 500 records

The worker applies heat as a local secondary sort when estimated values are equal. Pagination bounds discovered during the API canary are recorded in configuration rather than assumed.

Only one scheduled run may be active. A distributed lock and queue count check prevent overlap. A manual dry run remains available to authorized operators.

### Initial backfill

After production deployment and a successful dry run, an explicit backfill processes the top 2,000 records from the most recent 30 days. It runs in bounded batches, persists progress, can be paused or resumed, and does not enable the recurring schedule until its canary batches are healthy.

### Per-record processing

1. Validate and normalize the provider record.
2. Extract supported image and video candidates.
3. Check `MaterialOriginMapping` by provider asset identity. Already processed assets update observation metadata without downloading again.
4. Download new media with size, MIME, redirect, DNS, and timeout controls.
5. Compute exact SHA256 and existing secondary fingerprints.
6. Search for an active canonical material within the allowed content-identity scope.
7. Reuse the existing material or upload one new R2 object and create one material.
8. Upsert the origin mapping and update the smart-group counts.

The pre-download provider identity avoids normal repeated transfers. SHA256 catches identical content delivered under different provider IDs or already imported from Facebook.

### Identity and tenant boundary

The external Guangdada library is global and restricted by role. It can reuse an identical global Facebook material. It must not attach a global origin mapping to an organization-private material, because doing so could expose private metadata. Organization-private content retains the existing organization-scoped identity boundary even if the bytes are identical.

## API Design

- `GET /api/materials/smart-groups` returns the role-filtered smart-group tree with active-status counts.
- `GET /api/materials?smartGroupType=facebook-account&smartGroupKey=<accountId>` filters by Facebook account.
- `GET /api/materials?smartGroupType=external-package&smartGroupKey=<providerPackageKey>` filters by external package.
- `GET /api/materials/:id/origins` returns a safe origin summary.
- `GET /api/materials/external/guangdada/status` returns latest synchronization state and counters.
- `POST /api/materials/external/guangdada/sync` accepts bounded `dryRun`, `recentDays`, and `limit` controls.
- `POST /api/materials/external/guangdada/pause` and `/resume` control the provider job.

Reading external smart groups and origins requires super administrator or `materials:external:read`. Synchronization controls require super administrator or `materials:external:manage`. Ordinary users cannot infer external group counts, material IDs, source URLs, run state, or provider configuration.

## Frontend Behavior

- Add smart-group roots above or beside the existing manual folder tree.
- Use distinct icons and a non-editable treatment for smart groups.
- Keep create, rename, move, and delete actions only on manual folders.
- Display material type, source badges, account reuse count, and external product/package.
- Add an origin panel to material details without exposing provider credentials or unrestricted raw payloads.
- Preserve current pagination and search within the selected group.
- Empty, loading, unavailable-account, and provider-paused states have explicit messages.

## Security and Secret Handling

- Store the provider key only in production secret configuration under a dedicated environment variable.
- Never place the key in source, Git history, database response payloads, task payloads, logs, analytics events, or frontend bundles.
- Redact authorization headers and provider responses before structured logging.
- Rotate the initially shared key after deployment because it has already been transmitted through a chat channel.
- Accept HTTPS media only.
- Resolve and validate every redirect target; reject loopback, link-local, private, multicast, and reserved addresses for IPv4 and IPv6.
- Enforce connection, response, and total download timeouts; enforce supported MIME types and maximum byte size while streaming.
- Treat remote metadata and filenames as untrusted input.

## Reliability and Failure Handling

- `401` or `403`: stop the provider schedule, mark credentials invalid, and alert an operator. Do not retry continuously.
- `429`: honor `Retry-After` when present and use exponential backoff with jitter.
- `5xx` and network timeouts: bounded retry, then leave the item retryable for the next run.
- Invalid or unsupported media: record a terminal item-level failure and continue the batch.
- Provider human-verification or restriction response: pause the run and surface the response category without attempting browser automation.
- R2 upload succeeds but database insertion loses a uniqueness race: delete the losing R2 object and reuse the winner.
- Database succeeds but origin mapping fails: retry the mapping idempotently; do not redownload the media.
- A failed item never aborts unrelated records.

Each run records discovered, considered, already-seen, downloaded, content-reused, newly-created, invalid, failed, and deferred counts, plus timestamps and a redacted error sample.

## Migration

Facebook grouping requires no destructive material or R2 migration. Historical membership is derived from existing mappings and fallbacks. A bounded repair task can materialize missing indexes or normalize recoverable account IDs, but does not duplicate or move materials.

The legacy `Facebook导入` value remains readable for rollback but is no longer assigned automatically or used as the primary navigation. No user-created folder is deleted.

Before external ingestion, production verification must still show:

- 2,076 active Facebook materials.
- 2,076 distinct content files.
- zero exact-content duplicate groups.
- all active Facebook materials represented exactly once in the global Facebook total, with unmapped materials isolated explicitly.

## Testing Strategy

Implementation follows red-green-refactor.

### Unit tests

- One material appears in all mapped Facebook account groups without duplicate global counting.
- Account-name fallback, duplicate account names, disabled accounts, and unmapped materials.
- Active status includes both `ready` and `uploaded`.
- Provider identity normalization and media candidate extraction.
- Estimated-value primary sorting and heat secondary sorting.
- Secret redaction and unsafe URL rejection.
- Retry classification for authorization, rate-limit, server, and terminal item failures.

### Integration tests

- Smart-group endpoints enforce organization and role boundaries.
- Manual folders remain writable while smart groups are read-only.
- Same provider asset is not downloaded twice.
- Different provider IDs with identical bytes resolve to one canonical global material.
- Identical external bytes never expose an organization-private material.
- Concurrent insertion leaves one material, one retained R2 object, and all origin mappings.
- Scheduler lock prevents overlapping six-hour runs.
- Pause/resume and initial-backfill progress are idempotent.

### Production verification

- Compare pre/post Facebook canonical material and distinct-file counts.
- Verify account smart-group counts and multi-account reuse on sampled materials.
- Confirm the legacy coarse folder is not used for new imports.
- Run external dry run without downloads.
- Canary 10 external records, then 100, before the 2,000-record backfill.
- Verify sampled image/video R2 objects return expected MIME types.
- Confirm no provider key appears in source, build artifacts, logs, API responses, or job payloads.
- Cross a six-hour schedule boundary and prove no overlapping job wave is added.

## Rollout

1. Ship schema, indexes, smart-group read paths, and UI with external scheduling disabled.
2. Verify Facebook grouping and unchanged deduplication totals in production.
3. Install the provider key in production secret configuration and rotate it.
4. Run a provider response-shape and pagination dry run.
5. Process 10 and then 100 external canary records.
6. Run the pausable 30-day/top-2,000 backfill.
7. Enable the six-hour/top-500 recurring schedule.
8. Cross one schedule boundary and verify idempotency, queue backpressure, counters, and material visibility.

## Rollback

- Disable the external scheduler and worker flag.
- Hide smart-group navigation and fall back to existing manual folders.
- Retain canonical materials and origin mappings for diagnosis; do not delete R2 objects during rollback.
- The legacy folder value remains available, so rollback does not require a reverse data migration.

## Acceptance Criteria

1. Facebook navigation is account-based and no new automatic import uses the coarse physical folder.
2. A reused material appears in every mapped account group while the global total and R2 storage remain canonical.
3. Existing manual folders work unchanged.
4. External navigation is `外部优质素材 → 广大大 → 产品/包名` and is restricted to authorized roles.
5. External sync runs every six hours, considers at most 500 top recent records, and cannot overlap.
6. The initial top-2,000 backfill is bounded, observable, and pausable.
7. Cross-source exact-content matches reuse one allowed canonical material.
8. Authorization failures pause the provider; rate limits and transient failures use bounded backoff.
9. The API key is absent from code, Git, logs, job payloads, API responses, and frontend bundles.
10. Production verification proves active material totals, distinct-file totals, group behavior, R2 accessibility, and schedule idempotency.
