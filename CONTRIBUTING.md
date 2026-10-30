# Contributing

Thanks for helping improve `lti-moodle-integration`. Bug reports, LMS
compatibility reports, docs fixes, and pull requests are all welcome.

## Reporting

- **Bugs**: open an issue with the bug template. Include the LTI version (1.3 or
  1.1), the LMS and its version, and the relevant `[LTI]` log lines (redact
  tokens, emails, and secrets).
- **LMS compatibility**: if you've run the module against Canvas, Blackboard,
  Brightspace, Sakai, or a Moodle version we haven't listed, the compatibility
  template helps everyone — even "it just worked".
- **Security issues**: don't open a public issue; see [SECURITY.md](SECURITY.md).

## Development

Requires Node 22+.

```bash
npm install
npm run typecheck
npm test                 # builds, then runs backend/test/*.test.mjs
npm run test:packaging   # packs the module and installs it into a scratch app
```

The backend lives in `backend/src` and compiles to `backend/dist`. Tests use the
built-in `node --test` runner and import from `../dist`. The frontend components
in `frontend/src` ship as source; keep the Vue (`views/`) and React (`react/`)
versions in step when you change one of them.

## Pull requests

- Keep each PR focused on one change, with tests for behaviour changes.
- New options and adapter methods should be optional, so existing integrations
  keep working.
- Update `README.md` / `docs/` for user-facing changes, and add an entry under
  **Unreleased** in `CHANGELOG.md`.
- CI runs typecheck, tests, the packaging test, `npm pack --dry-run`, and
  `git diff --check`; please make sure they pass locally.

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE), the same license as the project.
