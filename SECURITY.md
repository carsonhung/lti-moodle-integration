# Security policy

This module handles LMS launches, signed tokens, shared secrets, and grade
passback, so security reports are taken seriously.

## Reporting a vulnerability

Please report privately through GitHub:
**Security › Report a vulnerability** on
[the repository](https://github.com/carsonhung/lti-moodle-integration/security/advisories/new).
Don't open a public issue or pull request for a vulnerability.

Include the affected version, the configuration involved (LTI 1.3 or 1.1,
connect mode, enabled options), and steps or a proof of concept. You should get
an acknowledgement within a week. Once a fix is released, the advisory is
published with credit to you unless you prefer otherwise.

## Supported versions

Security fixes are made on the latest minor release. Upgrade to the newest
version before reporting, where possible.

## Hardening your deployment

- **Rate limiting** is the host application's job. Put a limiter such as
  [`express-rate-limit`](https://www.npmjs.com/package/express-rate-limit) (or
  your reverse proxy's) in front of the mount path, especially the public
  `/login`, `/launch`, and `/legacy/launch` routes and the `/session` bridges.
- **Admin routers** (`createLtiAdminRouter`, `createLtiConsumerAdminRouter`)
  must sit behind your admin authentication. The platform connection test makes
  outbound requests to the URLs an admin enters (only `http`/`https`, no embedded
  credentials), so don't expose it to untrusted users.
- Replace the in-memory nonce, grade-link, and AGS sync stores with shared,
  durable ones when you run more than one instance.

## Scope

In scope: launch and token validation, OAuth 1.0a verification and replay
protection, session bridging, deep-link response signing, grade passback, and
the admin routers. Misconfiguration of a host application or LMS is out of
scope, but reports that the docs encourage an unsafe setup are welcome.
