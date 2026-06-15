# Packaging & SaaS Discussion — Working Notes

A saved record of the decision discussion about distributing
`lti-moodle-integration` as an installable package and/or a SaaS. Use this as the
resume point; the deep-dive on npm package installation continues from §6.

---

## 1. The question

> Is it possible to make the LTI integration part a project package developers can
> install directly, or make it a SaaS?

**Answer:** Yes to both. The folder was already ~80% package-shaped (had `main`,
`types`, `exports`, `build` script, adapter pattern). Two flags blocked real
distribution: `"private": true` and `"license": "UNLICENSED"`.

---

## 2. What was decided

- **Do the installable package first** (low effort, immediately useful, forces the
  clean boundary SaaS needs anyway).
- **Treat SaaS as a later evolution** — design documented, not built.
- Keep the package name `lti-moodle-integration` (no scope) to avoid churning the
  documented import paths. Scoping (`@carsonhung/...`) noted as a future option.
- License: **Apache-2.0**, Copyright 2026 HKU TALIC (with a `NOTICE` file for
  attribution). Earlier draft used an HKU TELI internal-use license; changed to
  Apache-2.0 since the package is meant to be openly installable.
- Publish target: **private registry or git install**, not public npm. Guarded by
  `publishConfig.access: "restricted"`.

---

## 3. Changes already made (Phase 0 — packaging)

| File | Change |
|---|---|
| `package.json` | Removed `private`; `license: "Apache-2.0"`, `author: "HKU TALIC"`; added `repository`/`bugs`/`homepage`, `files` whitelist, `./frontend/*` subpath export, `prepare` build hook, `publishConfig.access: "restricted"`. |
| `LICENSE` + `NOTICE` | New — Apache-2.0, Copyright 2026 HKU TALIC + attribution. |
| `CHANGELOG.md` | New — packaging changes + 1.0.0 baseline. |
| `README.md` | New "Option C — Install as a package" section + consumption comparison table; linked the SaaS doc. |
| `docs/SAAS_ARCHITECTURE.md` | New — gateway (2a) vs hosted (2b), isolation, key mgmt, phased roadmap. |

Three consumption models now documented:

| | A: Copy in | B: Reference in place | C: Install as a package |
|---|---|---|---|
| Edit the core | Yes (fork) | Yes (co-dev) | No (consume releases) |
| Upgrades | Re-copy | `git pull` | `npm update` |
| Best for | One-off forks | Active co-dev | Many consumers |

---

## 4. Verification done

- `npm run build` compiles clean (`tsc -p backend/tsconfig.json`).
- Flat `dist` layout matches `exports`: `backend/dist/index.js` + `index.d.ts`.
- `npm pack --dry-run` → 74 files, 188.7 kB tarball; includes compiled JS+types,
  reference source, frontend source, docs, `.env.example`, README/CHANGELOG/LICENSE.
- Temporary `node_modules` / `dist` / lockfile removed afterward so the repo's
  "reference in place" resolution isn't shadowed.

---

## 5. Open items / decisions outstanding

- **`repository` URL set** to `github.com/carsonhung/lti-moodle-integration`
  (across `package.json`, README, and §7 commands).
- Not committed yet (per git-workflow rule — commit only when asked).
- Scope vs unscoped name — deferred.
- SaaS open decisions live in `docs/SAAS_ARCHITECTURE.md` §11.

---

## 6. Deep dive: npm package installation — git install (DONE & VERIFIED)

**Chosen channel:** direct **git install** (`git+https` / `git+ssh`, pin a tag),
no registry. **Name stays unscoped.**

### 6.1 The critical fix — `prepare`, not `prepack`

`backend/dist` is gitignored, so a git install must compile on the consumer's
machine. npm's lifecycle for **git dependencies** runs the **`prepare`** script
(and installs the package's `devDependencies` first, so `tsc` is available) —
**not** `prepack`/`prepublishOnly`. The original setup only had `prepack` +
`prepublishOnly`, which would have produced a package with **no built entry
point** on git install. Fixed by replacing them with a single:

```json
"prepare": "npm run clean && npm run build"
```

`prepare` covers all three paths: git install, `npm pack`, and `npm publish`.

### 6.2 Frontend subpath export fix

Changed `"./frontend/*": "./frontend/src/*"` → `"./frontend/*": "./frontend/*"`
(identity map) so the consumer import path is transparent and matches the README:
`import ... from 'lti-moodle-integration/frontend/src/views/LtiLaunchView.vue'`.

### 6.3 Install commands (consumer)

```bash
# pin a tag (recommended) — npm clones, installs devDeps, runs prepare (builds dist), installs
npm install git+https://github.com/carsonhung/lti-moodle-integration.git#v1.0.0
# or ssh: npm install git+ssh://git@github.com/carsonhung/lti-moodle-integration.git#v1.0.0
```

Backend import: `from 'lti-moodle-integration/backend'`. Frontend (bundler
resolves source): `from 'lti-moodle-integration/frontend/src/...'`.

### 6.4 End-to-end verification performed (all passed)

- `npm install` (no args) in the package → `prepare` fired and built
  `backend/dist/index.js` (proves the git-install build path).
- `npm pack` → faithful tarball (75 files, ~190 kB) containing compiled JS+types,
  reference source, frontend source, docs, `.env.example`.
- Installed that tarball into a **throwaway consumer** in the OS temp dir, then:
  - **Runtime (`node`):** `require('lti-moodle-integration/backend')` exposes
    `initLti`, `createLtiAdminRouter`, `setLtiLogger`, `getLtiProvider`,
    `verifyBindToken`, `testPlatformConnection`; root `.` resolves; the
    `frontend/src/*.{ts,vue,tsx}` subpaths and `.env.example` all resolve via the
    `exports` map.
  - **Types (`tsc --noEmit`, `moduleResolution: bundler`):** value + `import type`
    imports resolve through the `exports` `types` condition. `TYPES_OK`.
- Cleaned up consumer + temp `node_modules`/`dist`/lockfile/tgz afterward.

### 6.5 Notes / caveats confirmed

- **devDeps must stay in `devDependencies`** (typescript, @types/*) — git install
  installs them before `prepare`. Don't move them to peer/optional.
- **Pin a ref** (`#v1.0.0`); unpinned installs track the default branch HEAD.
- **Express 4 vs 5:** package types target Express 4; an Express 5 host bridges
  with a one-line cast at the integration boundary (unchanged from before).
- **Peer deps** vue/react/axios are optional → installing only one framework
  doesn't error.
- ltijs/express/jsonwebtoken are regular `dependencies`, so the consumer gets
  them automatically; mongoose/drizzle/pg are `optionalDependencies`.

### 6.6 Still done by hand in the consuming app (unchanged)

Implement the adapter (`LtiAdapter` / `LtiLoginOnlyAdapter`), call `initLti` +
mount `createLtiAdminRouter`, copy/wire the frontend views (fill INTEGRATION
HOOKS), add the LTI tables (Mongoose/Drizzle/SQL), and set the `LTI_*` env vars.

### 6.7 Open follow-ups (not yet done)

- [x] Real git remote URL set to `github.com/carsonhung/lti-moodle-integration`
      (updated in `repository`/install snippets).
- [ ] Decide release/tag flow (`npm version patch/minor/major` → push tag).
- [ ] (Optional) private-registry path (GitHub Packages) if git install proves
      too heavy for some consumers.
- [ ] Not committed yet — awaiting explicit go-ahead.

---

## 7. Repo location: split into its own repo, sync via `git subtree`

**Decision:** the package gets its **own git repo** (so `npm install git+…` works —
npm cannot install a *subdirectory* of a repo). The folder **stays here** in
`selfgroupassignment` and is kept in sync with the standalone repo via
`git subtree`. Plan-only; commands below are run by the user.

> Remote: `https://github.com/carsonhung/lti-moodle-integration.git`

### 7.0 Prep (one-time, before splitting)

1. A `.gitignore` for the standalone repo already added at
   `lti-moodle-integration/.gitignore` (ignores `node_modules/`, `*/dist/`,
   `*.tgz`, `.env*` but keeps `.env.example`).
2. `package.json` → `repository.url` is set to the remote (done).
3. **Commit the package work first** — `git subtree split` only sees committed
   history. From the `selfgroupassignment` root:

   ```bash
   git add lti-moodle-integration
   git commit -m "feat(lti): make package installable + saas design + subtree gitignore"
   ```

### 7.1 Create the standalone repo from the subfolder (preserves history)

From the `selfgroupassignment` root:

```bash
# 1. Extract the subfolder's history into a temp branch whose ROOT is the folder
git subtree split --prefix=lti-moodle-integration -b lti-split

# 2. Create an EMPTY GitHub repo "lti-moodle-integration"
#    (no README/license/.gitignore — avoids first-push conflicts)

# 3. Push the split history as the standalone repo's main
git push https://github.com/carsonhung/lti-moodle-integration.git lti-split:main

# 4. Clean up the temp branch
git branch -D lti-split
```

The folder remains a normal tracked part of `selfgroupassignment` — you have not
removed anything; you now also have an independent repo with the same files.

### 7.2 Tag a release so consumers can pin

Consumers should pin a tag (`#v1.0.0`), not float on `main`. Easiest in a fresh
clone of the standalone repo:

```bash
git clone https://github.com/carsonhung/lti-moodle-integration.git /tmp/lti-pkg && cd /tmp/lti-pkg
git tag v1.0.0
git push origin v1.0.0
```

### 7.3 Ongoing workflow — edit here, sync out

Add the remote once (from `selfgroupassignment` root):

```bash
git remote add lti-pkg https://github.com/carsonhung/lti-moodle-integration.git
```

After committing subfolder changes in `selfgroupassignment`, push them to the
standalone repo:

```bash
git subtree push --prefix=lti-moodle-integration lti-pkg main
```

If anyone commits *directly* on the standalone repo, pull those back:

```bash
git subtree pull --prefix=lti-moodle-integration lti-pkg main --squash
```

> `git subtree push` recomputes the split each time and can be slow on long
> histories; for big repos prefer redoing `git subtree split -b lti-split` then
> `git push lti-pkg lti-split:main`. Fine as-is for this project's size.

### 7.4 Release a new version

1. Bump `version` in `lti-moodle-integration/package.json` (here), update
   `CHANGELOG.md`, commit in `selfgroupassignment`.
2. `git subtree push --prefix=lti-moodle-integration lti-pkg main`.
3. Tag `vX.Y.Z` on the standalone repo (clone or GitHub Releases UI).
4. Consumers: `npm install git+https://github.com/carsonhung/lti-moodle-integration.git#vX.Y.Z`
   then `npm update` to move up.

### 7.5 How THIS project keeps consuming it

No change for now: `selfgroupassignment` keeps using **Option B (reference in
place)** against the local folder for active development — do **not** also
`npm install` the package here (that would create a second copy). External
projects use the git install. If you ever want this project to consume the
released package instead of the in-place folder, switch the relative imports to
`lti-moodle-integration/backend` and add the git-install dependency.

### 7.6 Alternatives considered

- **git submodule** — folder becomes a pointer to the standalone repo; stronger
  separation but more friction for in-place editing (extra `submodule update`
  dance). Rejected in favor of subtree.
- **`git filter-repo`** — cleaner history extraction than `subtree split`, but
  it's an external tool; not needed at this size.
- **Stay a subfolder + `gitpkg`** — lets npm install a subdir via a proxy;
  extra tooling/indirection, rejected as primary path.
