# Ways to consume the package

Three ways to use this module in your project — copy it in, reference it in place, or install it as a package — and how to choose.


**Option A — Copy in (steps above).** Copy `backend/src/*` into your app's `src/lti/` and `frontend/src/*` into your app's `src/lti/`. The files then resolve your app's own `node_modules`. Best when you want to fork/diverge from the module.

**Option B — Reference in place (no copy).** Keep this folder intact as a sibling of your `backend/`/`frontend/` and import its source directly. Nothing portable is duplicated in your app — you only write the app-specific adapter + bootstrap + thin views. It's the recommended setup when you want to keep vibe-coding new LTI features inside this folder. Wiring:

```
your-project/
├── package.json            ← root: hosts the LTI runtime deps (see below)
├── lti-moodle-integration/ ← this folder, dropped in unchanged
├── backend/                ← your app (keeps its own node_modules)
└── frontend/               ← your app (keeps its own node_modules)
```

1. **Provide the folder's runtime deps so the sibling can resolve them.** Node/TS resolve a module's `import`s by walking *up* the directory tree, so this folder needs `express`, `ltijs`, `jsonwebtoken`, `mongoose` (backend) and `axios` (frontend) to be reachable from an ancestor directory. The simplest way is a **root `package.json`** with those deps + `npm install` at the root:

```jsonc
// ./package.json (workspace root)
{
  "private": true,
  "dependencies": {
    "axios": "^1.7.7",
    "express": "^5.0.1",
    "jsonwebtoken": "^9.0.2",
    "ltijs": "^5.9.5",
    "mongoose": "^8.7.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/jsonwebtoken": "^9.0.7",
    "@types/node": "^22.7.5"
  }
}
```

(npm workspaces work too; this minimal root install keeps your `backend/`/`frontend/` `node_modules` untouched.)

2. **Backend — compile the folder + import it relatively.** In `backend/tsconfig.json`, add the folder to `include` and exclude the `*.example.ts` reference adapters:

```jsonc
{
  "include": ["src/**/*.ts", "../lti-moodle-integration/backend/src/**/*.ts"],
  "exclude": [
    "node_modules", "dist",
    "../lti-moodle-integration/backend/src/adapters/*.example.ts",
    "../lti-moodle-integration/backend/src/models/drizzle-schema.example.ts"
  ]
}
```

Then your `bootstrap.ts` / adapter import the public API by relative path:

```typescript
import { initLti, createLtiAdminRouter, setLtiLogger } from '../../../lti-moodle-integration/backend/src/index';
import type { LtiAdapter } from '../../../../lti-moodle-integration/backend/src/types';
import { LtiCourseMapModel } from '../../../../lti-moodle-integration/backend/src/models/LtiCourseMapModel.mongoose';
```

> Note: `tsc` doesn't rewrite path aliases in emitted JS, so the backend uses **relative** imports (works for `tsx` dev, `tsc --noEmit`, and `node dist`). Because the folder is now part of the program, the emitted `dist/` nests under `dist/backend/src/` — point `main`/`start` there.

3. **Frontend — alias the folder.** In `vite.config.ts` and `tsconfig.json`:

```typescript
// vite.config.ts
alias: { '@lti': path.resolve(__dirname, '../lti-moodle-integration/frontend/src') }
```

```jsonc
// tsconfig.json
"paths": { "@lti/*": ["../lti-moodle-integration/frontend/src/*"] }
```

Then import the portable client directly: `import { configureLtiApi, getLtiSession } from '@lti/api';`. (Vite resolves `axios` from your frontend's `node_modules`; `vue-tsc` resolves it from the root install in step 1.)

4. **Your app keeps only the glue.** Everything that touches your models/auth lives in your app, importing the portable types/core above:
   - `backend/src/lti/adapters/<yourAdapter>.ts` — implements `LtiAdapter` (or `LtiLoginOnlyAdapter`).
   - `backend/src/lti/bootstrap.ts` — calls `initLti` + mounts `createLtiAdminRouter`.
   - `frontend/src/lti/views/*.vue` (Vue) or `frontend/src/lti/react/*.tsx` (React) — your app-styled `LtiLaunch` / `LtiDeepLink` / `LtiPlatformsAdmin` (start from this folder's templates and wire your auth store + route names).

To move to the next project: copy this folder in unchanged, repeat steps 1–4. Nothing in this folder needs editing for portability — all the app-specific code lives in your `backend/`/`frontend/`.

**Option C — Install as a package (`npm install`).** The folder is now packaged so you can depend on it like any other module instead of copying source. The backend ships compiled (`backend/dist` with `.d.ts`); the frontend components ship as source under the `./frontend/*` subpath export and are resolved by your own bundler.

Install it from npm:

```bash
npm install lti-moodle-integration
```

To track unreleased changes, you can install from a git tag or commit instead:

```bash
npm install git+https://github.com/carsonhung/lti-moodle-integration.git#v1.2.1
```

> A git install compiles `backend/dist` in the package's `prepare` script. Recent npm versions block install scripts from git dependencies; if `backend/dist` is missing afterwards, run `npm approve-scripts lti-moodle-integration` and reinstall. Always pin a tag or commit; without one npm installs the default branch HEAD.

Then consume the published entry points instead of relative paths:

```typescript
// backend
import { initLti, createLtiAdminRouter, setLtiLogger } from 'lti-moodle-integration/backend';
import type { LtiAdapter } from 'lti-moodle-integration/backend';
```

```typescript
// frontend (your bundler resolves the raw component source)
import { configureLtiApi, getLtiSession } from 'lti-moodle-integration/frontend/src/api';
// Vue:
import LtiLaunchView from 'lti-moodle-integration/frontend/src/views/LtiLaunchView.vue';
// React:
import { LtiLaunch } from 'lti-moodle-integration/frontend/src/react/LtiLaunch';
```

You still implement your own adapter and thin views — the package gives you the portable core, types, admin router, and reference components; everything that touches your models/auth/routes stays in your app (steps 3–4 of Option B). The reference adapters and models (`backend/src/adapters/*.example.ts`, `backend/src/models/*`) ship as source for you to copy and adapt.

Choose the consumption model by how much you expect to diverge from the module:

| | A: Copy in | B: Reference in place | C: Install as a package |
|---|---|---|---|
| You edit the core | Yes (forked) | Yes (vibe-code in the folder) | No (consume releases) |
| Upgrades | Manual re-copy | `git pull` the folder | `npm update` / bump version |
| Best for | One-off forks | Active co-development | Many independent consumers |
