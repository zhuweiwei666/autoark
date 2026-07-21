# Facebook Advertising Material Ingestion Implementation Plan

> Execute this plan incrementally with test-driven development. Production rollout must be canaried before the full active-account backfill.

**Goal:** Reliably synchronize every currently authorized active Facebook advertising account, download original image/video assets, store them in R2, and create tenant-scoped material-library records with observable and recoverable queues.

**Architecture:** Keep account, campaign, and insight synchronization in BullMQ, but add a separate low-concurrency material-ingestion queue so binary downloads cannot block metadata workers. Propagate organization ownership through every job, resolve original Meta assets by image hash or video ID, upload them to tenant-prefixed R2 keys, and idempotently map them into `Creative` and `Material`. Queue startup is fail-closed: workers must be ready before schedulers start, schedulers refuse to enqueue without consumers, and a superadmin-only recovery endpoint provides dry-run and confirmed bounded cleanup.

**Tech Stack:** Node.js, TypeScript, Express, Mongoose, BullMQ, Redis, AWS S3-compatible R2, Jest.

---

## Task 1: Normalize Facebook ad-account identifiers

**Files:**
- Modify: `autoark-backend/src/services/facebook.service.ts`
- Test: `autoark-backend/src/services/__tests__/facebook.service.test.ts`

1. Add a failing test proving an unprefixed stored account ID is sent to Meta as `act_<id>` for account-level campaign, ad-set, ad, and account-info reads.
2. Run the focused test and confirm it fails on the raw identifier.
3. Reuse the canonical account-ID normalizer in each account-level service method.
4. Run the focused test and confirm it passes.

## Task 2: Make queue startup and scheduling fail closed

**Files:**
- Modify: `autoark-backend/src/queue/facebook.worker.ts`
- Modify: `autoark-backend/src/queue/facebook.queue.ts`
- Modify: `autoark-backend/src/services/facebook.campaigns.v2.service.ts`
- Modify: `autoark-backend/src/server.ts`
- Test: `autoark-backend/src/queue/__tests__/facebook.worker.test.ts`
- Test: `autoark-backend/src/services/__tests__/facebook.campaigns.v2.service.test.ts`

1. Add failing tests for awaiting worker readiness, reporting worker errors/failures, rejecting scheduler enqueue when no account worker exists, and skipping accounts already pending in any nonterminal state.
2. Make worker initialization asynchronous and await `waitUntilReady()` for every worker before cron registration.
3. Expose worker-count and pending-account helpers from the queue module.
4. Gate account scheduling on a live consumer and deduplicate across time slots.
5. Run focused tests and confirm they pass.

## Task 3: Add tenant-safe original-asset ingestion

**Files:**
- Modify: `autoark-backend/src/models/Creative.ts`
- Modify: `autoark-backend/src/models/Material.ts`
- Modify: `autoark-backend/src/integration/facebook/ads.api.ts`
- Modify: `autoark-backend/src/queue/facebook.queue.ts`
- Modify: `autoark-backend/src/queue/facebook.worker.ts`
- Modify: `autoark-backend/src/services/facebook.campaigns.v2.service.ts`
- Add: `autoark-backend/src/services/facebookMaterialIngestion.service.ts`
- Test: `autoark-backend/src/services/__tests__/facebookMaterialIngestion.service.test.ts`

1. Add failing tests covering image-hash originals, video-source originals, carousel children, dynamic asset feeds, preview-only fallback labeling, tenant-scoped fingerprint idempotency, and retryable failure state.
2. Extend schemas with organization ownership, ingestion state, multiple material mappings, and Facebook import metadata while retaining backward-compatible fields.
3. Add deterministic asset extraction and fix Meta image-hash response parsing.
4. Add a low-concurrency material queue and propagate `organizationId` from account jobs through campaign creative jobs.
5. Download with time and size limits, compute a fingerprint, upload under a hashed tenant prefix, upsert `Material` with `source.type = import`, and update `Creative` atomically.
6. Run focused tests and confirm they pass.

## Task 4: Add safe diagnostics and recovery

**Files:**
- Modify: `autoark-backend/src/queue/facebook.queue.ts`
- Modify: `autoark-backend/src/controllers/facebook.controller.ts`
- Modify: `autoark-backend/src/routes/facebook.routes.ts`
- Test: `autoark-backend/src/controllers/__tests__/facebook.queue-recovery.test.ts`

1. Add failing tests for detailed queue health and recovery dry-run behavior.
2. Report worker count, state counts, and a bounded sample of failed reasons without exposing secrets.
3. Add a superadmin-only recovery endpoint that defaults to dry-run and requires an exact confirmation phrase before removing bounded stale waiting/prioritized/delayed/failed account jobs.
4. Run focused tests and confirm they pass.

## Task 5: Regression verification

**Files:**
- Modify only files required by failing regressions.

1. Run all backend Jest suites serially.
2. Run backend TypeScript compilation and production build.
3. Review the complete diff for tenant isolation, secret handling, queue bounds, and unrelated changes.

## Task 6: Production rollout and proof

1. Commit only this plan and implementation files, push the dedicated branch, and use the guarded production workflow.
2. Verify `/api/build` reports the deployed commit.
3. Verify all Facebook workers report ready before any scheduler enqueue.
4. Run queue recovery in dry-run mode, review exact counts, then run the confirmed bounded cleanup.
5. Trigger a canary sync for a small set of active accounts and prove Meta creative IDs map to R2-backed `Material` records with correct image/video MIME types.
6. Trigger the full active-account backfill and monitor account, campaign, ad, and material queues until backlog decreases without runaway duplication.
7. Report separately: code shipped, production deployed, live material proof, account coverage, and any remaining provider-side failures.
