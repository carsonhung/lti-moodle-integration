# Changelog

All notable changes to the `lti-moodle-integration` package are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Broker contract CI coverage**: Added callback validation for signature,
  audience, token type/version, original platform tuple, trusted Staff ID
  provenance, roles, strict `TALIC001_2A_2026` parsing, login/course modes, and
  atomic concurrent JTI consumption, plus typecheck/package gates.
- **Shared broker `ltik` client**: Exported the v2 `tt = broker.ltik`
  verifier, durable broker-consume helper, course/platform helpers, and
  fail-closed teacher-promotion evidence. Legacy v1 remains login-compatible.
- **Verified login-session resolution**: Added stable LTI platform subjects and
  platform tuples to user upserts, explicit trusted institutional-ID claim
  provenance, and an optional `resolveLoginSession` hook that can replace the
  JWT user and return a safe app-relative target plus serializable launch
  metadata.
- **Protocol-neutral content selection**: Added `onNormalizedLaunch` delegation
  across LTI 1.3 and 1.0a/1.1 plus `respondToDeepLinking()` so hosts can own
  launch routing and resource selection without handling signing credentials.
- **LTI 1.0a / 1.1 support (OAuth 1.0a)** — the provider can now be launched from
  older LMSs that speak LTI 1.0a / 1.1, alongside the existing 1.3 path. Off by
  default; enable with `legacyLti: true` (or `LTI_LEGACY_ENABLED=true`) and supply
  a `consumerStore` (resolves the shared secret by consumer key) plus a signing
  secret (`launchTicketSecret` / `LTI_LAUNCH_TICKET_SECRET`, falls back to the
  bind-token secret). Includes:
  - Hand-rolled OAuth 1.0a HMAC-SHA1 verification (`legacy/oauth1.ts`) with
    timestamp-window and nonce replay protection (`LtiNonceStore`, in-memory
    default via `createInMemoryNonceStore`).
  - A legacy router (`createLti11Router`) handling the signed form-POST launch,
    mapping params to the same normalized launch handler used by 1.3, and a
    short-lived signed **launch ticket** the SPA exchanges at the legacy
    `/session` endpoint (the 1.1 analogue of `ltik`). Frontend `LtiLaunchView.vue`
    / `LtiLaunch.tsx` now accept a `?ticket=` param.
  - **LTI 1.1 Content-Item deep linking** (`legacyDeepLinking` /
    `LTI_LEGACY_DEEP_LINKING`) — renders a picker and returns an OAuth 1.0a-signed
    auto-POST `ContentItemSelection` form to the LMS.
- **Grade passback**:
  - **LTI 1.1 Basic Outcomes** POX client (`legacy/outcomes.ts`):
    `replaceResult` / `readResult` / `deleteResult`, OAuth 1.0a-signed with
    `oauth_body_hash`.
  - **LTI 1.3 AGS prototype** (`grades/ags.ts`, experimental) behind
    `agsPrototype` / `LTI_AGS_PROTOTYPE`, built on ltijs's Grade service.
  - A unified host-callable `sendScore()` facade that dispatches to 1.1 Outcomes
    or 1.3 AGS based on the captured grade link, plus an `LtiGradeLinkStore`
    (in-memory default via `createInMemoryGradeLinkStore`) that records the
    outcome service URL / AGS endpoint at launch time.
- **Consumer credential admin** — `createLtiConsumerAdminRouter` (parallel to
  `createLtiAdminRouter`) for CRUD over OAuth 1.0a consumer key/secret pairs; the
  secret is write-only (accepted on create/update, never returned). Reference
  `LtiConsumerModel` / `LtiGradeLinkModel` Mongoose models and store examples.
- New public exports: `createLtiConsumerAdminRouter`, `createInMemoryNonceStore`,
  `createInMemoryGradeLinkStore`, `sendScore`, `handleNormalizedLaunch`, the
  OAuth 1.0a primitives, and the supporting types (`NormalizedLaunch`,
  `LtiConsumerStore`, `LtiNonceStore`, `LtiGradeLinkStore`, etc.).
- New env vars (see `.env.example`): `LTI_LEGACY_ENABLED`, `LTI_LEGACY_MOUNT`,
  `LTI_LEGACY_TIMESTAMP_WINDOW_S`, `LTI_LEGACY_NONCE_TTL_MS`,
  `LTI_LEGACY_DEEP_LINKING`, `LTI_LAUNCH_TICKET_SECRET`, `LTI_AGS_PROTOTYPE`.
- Packaging metadata so the module can be installed directly instead of only
  copied in: `files` whitelist, a `prepare` build hook (runs on `git`
  installs, `npm pack`, and `npm publish`), `repository` / `bugs` / `homepage`,
  and a `publishConfig.access: "restricted"` guard against accidental public
  publish.
- Subpath export `./frontend/*` (identity-mapped to the on-disk path) so
  consumers who `npm install` the package can import the raw Vue/React components
  (e.g. `lti-moodle-integration/frontend/src/views/LtiLaunchView.vue`) through
  their own bundler, in addition to the existing copy-in workflow.
- `LICENSE` (Apache-2.0) and `NOTICE` (attribution) files, Copyright 2026 HKU TALIC.
- README "Option C — Install as a package" section covering private-registry and
  git installs.
- SaaS architecture design notes — for evolving the package into a hosted
  multi-tenant LTI gateway (Option 2a) and a fully hosted product (Option 2b).
  Kept as internal-only notes outside the published package (see "Changed").

### Changed

- **Safer launch diagnostics**: Routine logs now report claim presence and keys;
  `LTI_DEBUG_CLAIMS` emits masked identity fingerprints, while raw PII requires
  `LTI_DEBUG_RAW_CLAIMS` and still redacts credentials.
- **Role inference**: Instructor, TeachingAssistant, Administrator, and
  ContentDeveloper roles now consistently receive teacher-level launch
  handling.
- Internal strategy notes (`PACKAGING_DISCUSSION.md`, `SAAS_ARCHITECTURE.md`) were
  moved out of the package's `docs/` into the host monorepo's `docs/internal/`, so
  they ship neither in the npm tarball nor in the standalone public repo. The
  published `docs/` now contains only consumer-facing integration docs.
- `core.ts` launch handling was refactored into a protocol-agnostic
  `handleNormalizedLaunch` (in `launchHandler.ts`) shared by the 1.3 and 1.1
  paths; logging and bind-token helpers were extracted to `logger.ts` /
  `bindToken.ts`. No behavior change for existing 1.3 deployments.
- Licensed the package under `Apache-2.0` (was `UNLICENSED`) and removed
  `"private": true` so it can be installed/published; publishing stays gated
  behind `publishConfig.access: "restricted"`.

## [1.0.0]

### Added

- Initial portable LTI 1.3 Provider module: `initLti`, `createLtiAdminRouter`,
  the `LtiAdapter` / `LtiLoginOnlyAdapter` adapter pattern, login-only /
  context-mapping / deep-linking connect modes, Mongoose + Drizzle reference
  adapters, and Vue 3 / React 18 frontend components sharing one
  framework-neutral `api.ts`.
