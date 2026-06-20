/**
 * Packaging / consumption integration test.
 *
 * Proves the module is installable exactly as a published (registry or git)
 * package: it builds, `npm pack`s a tarball, installs that tarball into a
 * throwaway consumer, and asserts the public API + subpath exports resolve at
 * runtime through the `exports` map — the same path an external consumer takes.
 *
 * This is an *integration* test (it shells out to npm and fetches the package's
 * own deps from the registry), so it lives behind its own `.itest.mjs` suffix
 * and the `npm run test:packaging` script rather than the fast unit `npm test`.
 *
 * Run: `npm run test:packaging`
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..', '..');

const run = (cmd, cwd) =>
  execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('packs, installs, and resolves its public exports like a published package', { timeout: 600_000 }, () => {
  const work = mkdtempSync(join(tmpdir(), 'lti-pack-'));
  try {
    // 1. Pack — `prepare` rebuilds dist, then the tarball is written to `work`.
    run(`npm pack --pack-destination "${work}"`, pkgRoot);
    const tarball = readdirSync(work).find((f) => f.endsWith('.tgz'));
    assert.ok(tarball, 'npm pack produced a .tgz tarball');

    // 2. Throwaway consumer that installs the tarball (pulls the package's own
    //    runtime deps from the registry, just like a real consumer would).
    const consumer = join(work, 'consumer');
    mkdirSync(consumer);
    writeFileSync(
      join(consumer, 'package.json'),
      JSON.stringify({ name: 'lti-consumer-fixture', version: '1.0.0', private: true }, null, 2)
    );
    run(`npm install "${join(work, tarball)}" --no-audit --no-fund`, consumer);

    // 3. Resolve through the installed package's `exports` map.
    const require = createRequire(join(consumer, 'noop.cjs'));

    const backend = require('lti-moodle-integration/backend');
    for (const name of [
      'initLti',
      'createLtiAdminRouter',
      'createLtiConsumerAdminRouter',
      'setLtiLogger',
      'getLtiProvider',
      'verifyBindToken',
      'testPlatformConnection',
    ]) {
      assert.equal(typeof backend[name], 'function', `backend export "${name}" is callable`);
    }

    // Root specifier resolves to the same entry as the ./backend subpath.
    const root = require('lti-moodle-integration');
    assert.equal(typeof root.initLti, 'function', 'root export resolves');

    // Non-JS subpath exports resolve to real shipped files.
    assert.ok(
      existsSync(require.resolve('lti-moodle-integration/.env.example')),
      '.env.example subpath export resolves to a real file'
    );
    assert.ok(
      existsSync(require.resolve('lti-moodle-integration/frontend/src/api.ts')),
      'frontend source subpath export resolves to a real file'
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
