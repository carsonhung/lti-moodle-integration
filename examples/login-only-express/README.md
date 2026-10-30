# Example: login-only LTI 1.3 tool

The smallest useful integration: a Moodle user clicks the activity and lands in
your app, signed in. One file, `server.ts`, with three adapter methods.

## Run it

You need Node 22+, a MongoDB instance (ltijs keeps its state there), and a public
HTTPS URL that Moodle can reach, for example a tunnel:
`cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`.

```bash
cd examples/login-only-express
npm install
cp .env.example .env        # fill in LTI_ENCRYPTION_KEY and LTI_TOOL_BASE_URL
npm start
```

The server prints the three URLs Moodle needs.

## Register it in Moodle

In **Site administration › Plugins › Activity modules › External tool › Manage
tools › configure a tool manually**:

| Field | Value |
|---|---|
| LTI version | LTI 1.3 |
| Tool URL | `<base>/api/lti/launch` |
| Public key type | Keyset URL |
| Public keyset | `<base>/api/lti/keys` |
| Initiate login URL | `<base>/api/lti/login` |
| Redirection URI(s) | `<base>/api/lti/launch` |
| Share launcher's email with tool | Always |
| Tool configuration usage | Launch only |

Save, then open **View configuration details** for the tool and copy the client
ID and endpoints into the `LTI_PLATFORM_*` values in `.env`. Restart the server.

Add the tool as an activity in a course and open it. The page shows the signed-in
user returned by `/api/me`.

## Next steps

- Replace the in-memory `users` map and `jwt.sign` with your user model and auth.
- Route users with the `resolveLoginSession` hook — see
  [docs/LOGIN_ONLY.md](../../docs/LOGIN_ONLY.md).
- For teacher activity selection (Deep Linking) and grade passback, implement the
  full `LtiAdapter` — see [docs/GETTING_STARTED.md](../../docs/GETTING_STARTED.md).
