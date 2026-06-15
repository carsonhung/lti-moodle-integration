# Changelog

All notable changes to the `lti-moodle-integration` package are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
- `docs/SAAS_ARCHITECTURE.md` — design for evolving the package into a hosted
  multi-tenant LTI gateway (Option 2a) and a fully hosted product (Option 2b).

### Changed

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
