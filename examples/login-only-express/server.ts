/**
 * Minimal LTI 1.3 tool: Moodle launches it, the user lands signed in.
 *
 * Login-only mode needs just three adapter methods. Users live in memory and
 * sessions are plain JWTs, so swap those for your real user model and auth.
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initLti, type LtiLoginOnlyAdapter, type LtiUser } from 'lti-moodle-integration/backend';

const PORT = Number(process.env.PORT ?? 3000);
const MOUNT_PATH = process.env.LTI_MOUNT_PATH ?? '/api/lti';
const JWT_SECRET = process.env.APP_JWT_SECRET ?? crypto.randomBytes(32).toString('hex');

const users = new Map<string, LtiUser>();

const adapter: LtiLoginOnlyAdapter = {
  customFieldPrefix: 'demo',

  async upsertUser({ email, name, role }) {
    const existing = users.get(email);
    const user: LtiUser = existing ?? { id: crypto.randomUUID(), email, name, roles: [role] };
    users.set(email, user);
    return user;
  },

  generateJwt(user) {
    const expiresIn = 60 * 60;
    const token = jwt.sign({ sub: user.id, email: user.email, roles: user.roles }, JWT_SECRET, {
      expiresIn,
    });
    return { token, expiresIn };
  },

  resolveEffectiveTenant() {
    return undefined;
  },
};

const app = express();
app.use(express.json());

// The SPA route the launch redirects to. A real app would use LtiLaunchView.vue /
// LtiLaunch.tsx; this page does the same ltik -> app JWT exchange in plain JS.
app.get('/lti/launch', (_req, res) => {
  res.type('html').send(`<!doctype html>
<meta charset="utf-8"><title>LTI demo</title>
<body style="font-family:system-ui;padding:24px">
<h1>LTI 1.3 launch</h1><pre id="out">Exchanging launch token…</pre>
<script>
  const ltik = new URLSearchParams(location.search).get('ltik');
  fetch(${JSON.stringify(MOUNT_PATH)} + '/session?ltik=' + encodeURIComponent(ltik))
    .then((r) => r.json())
    .then((session) => {
      if (!session.success) throw new Error(session.message);
      return fetch('/api/me', { headers: { Authorization: 'Bearer ' + session.token } });
    })
    .then((r) => r.json())
    .then((me) => { document.getElementById('out').textContent = 'Signed in as\\n' + JSON.stringify(me, null, 2); })
    .catch((e) => { document.getElementById('out').textContent = 'Launch failed: ' + e.message; });
</script>`);
});

app.get('/api/me', (req, res) => {
  try {
    const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
    const claims = jwt.verify(token, JWT_SECRET) as { email: string };
    res.json(users.get(claims.email) ?? null);
  } catch {
    res.status(401).json({ message: 'Not signed in' });
  }
});

async function main() {
  await initLti(app, adapter, {
    mountPath: MOUNT_PATH,
    connectMode: 'login-only',
    loginOnlyLaunchPath: '/lti/launch',
    ltiaas: true,
  });

  app.listen(PORT, () => {
    const base = process.env.LTI_TOOL_BASE_URL ?? `http://localhost:${PORT}`;
    console.log(`LTI demo tool listening on ${base}`);
    console.log(`  Tool URL / redirect URI : ${base}${MOUNT_PATH}/launch`);
    console.log(`  Initiate login URL      : ${base}${MOUNT_PATH}/login`);
    console.log(`  Public keyset URL       : ${base}${MOUNT_PATH}/keys`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
