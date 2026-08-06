import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const loginOnlyExample = resolve(here, '../src/adapters/login-only.example.ts');

test('login-only example is valid and demonstrates verified host resolution', () => {
  const source = readFileSync(loginOnlyExample, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
    reportDiagnostics: true,
  });

  const errors = (output.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(errors, []);
  assert.match(source, /export async function resolveLoginSession/);
  assert.match(source, /session\.identity\.platform\.contextId/);
  assert.match(source, /session\.role === 'student'/);
  assert.match(source, /handleVerifiedTeacherLaunch/);
  assert.match(source, /const fallback = '\/dashboard'/);
  assert.doesNotMatch(source, /req\.(body|query)|window\.|location\./);
});
