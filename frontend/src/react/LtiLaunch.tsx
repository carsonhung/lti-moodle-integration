/**
 * LtiLaunch — React port of LtiLaunchView.vue.
 *
 * Receives an `ltik` query param, exchanges it for an app JWT, persists the
 * token, and redirects to the correct in-app route based on role + the
 * optional `agentId` / `categoryId` query params.
 *
 * INTEGRATION NOTES
 * -----------------
 * This component is intentionally framework-light. To wire it into a React
 * app, edit the `INTEGRATION HOOKS` section below to:
 *   1. Call your auth store's "set token" action after `getLtiSession`.
 *   2. Trigger your "fetch profile" action.
 *   3. Use your router to redirect to the in-app target (agent/category page).
 *
 * The hooks are intentionally inline because the launch view is an
 * entry-point route with no parent to pass callbacks. If you need true
 * reusability, lift them into a context provider or pass them as props.
 *
 * Requires `react`, `react-dom`, and `react-router-dom` (peer deps) plus the
 * shared `../api` module. If you don't use react-router, swap `useSearchParams`
 * / `useNavigate` for your router's equivalents.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';

import { getLtiSession, getLtiSessionByTicket } from '../api';

const LOGIN_HREF = '/login';

interface AppUser {
  roles?: string[];
}

interface TargetRoute {
  path: string;
  query?: Record<string, string>;
}

/* ─── INTEGRATION HOOKS ────────────────────────────────────────────────────
 * Replace the bodies of these functions with calls into your auth store
 * (Redux / Zustand / Context) and profile fetcher. They run once per launch.
 */

async function persistToken(token: string, expiresInSec: number, tenant?: string): Promise<void> {
  // EXAMPLE (Zustand):
  //   useAuthStore.getState().setToken(token, expiresInSec * 1000);
  //   if (tenant) useTenantStore.getState().setTenant(tenant);
  const expirationDate = Date.now() + expiresInSec * 1000;
  localStorage.setItem('app.token', token);
  localStorage.setItem('app.tokenExpiration', String(expirationDate));
  if (tenant) localStorage.setItem('app.tenant', tenant);
  axios.defaults.headers.common['Authorization'] = 'Bearer ' + token;
}

async function loadProfile(): Promise<AppUser | null> {
  // EXAMPLE: return (await api.get('/auth/me')).data.user;
  return null;
}

function targetRouteFor(opts: {
  agentId?: string;
  categoryId?: string;
  courseId?: string;
  user: AppUser | null;
  passthrough: Record<string, string>;
}): TargetRoute {
  const { agentId, categoryId, user, passthrough } = opts;
  const roles = user?.roles || [];
  const isAdmin = roles.includes('admin');
  const isTeacher = roles.includes('teacher');

  if (categoryId) {
    return { path: `/lti/category/${categoryId}`, query: passthrough };
  }
  if (!agentId) return { path: '/welcome' };

  if (isAdmin) return { path: `/admin/topic/${agentId}`, query: passthrough };
  if (isTeacher) return { path: `/teacher/topic/${agentId}`, query: passthrough };
  return { path: `/student/topic/${agentId}`, query: passthrough };
}

/* ───────────────────────────────────────────────────────────────────────── */

function buildUrl(target: TargetRoute): string {
  const query = target.query ?? {};
  const search = new URLSearchParams(query).toString();
  return search ? `${target.path}?${search}` : target.path;
}

export function LtiLaunch() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [status, setStatus] = useState('Signing you in…');
  const [error, setError] = useState<string | null>(null);

  // React 18 StrictMode double-invokes effects in dev; guard so the ltik
  // exchange (single-use token) only runs once.
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    (async () => {
      try {
        const ltik = (searchParams.get('ltik') ?? '').trim();
        const ticket = (searchParams.get('ticket') ?? '').trim();
        const agentId = (searchParams.get('agentId') ?? '').trim();
        const categoryId = (searchParams.get('categoryId') ?? '').trim();
        const courseId = (searchParams.get('courseId') ?? '').trim();
        const embedded = (searchParams.get('embedded') ?? '').trim();
        const lti = (searchParams.get('lti') ?? '').trim();
        const lock = (searchParams.get('lock') ?? '').trim();
        const returnTo = (searchParams.get('returnTo') ?? '').trim();

        if (!ltik && !ticket) {
          throw new Error('Missing ltik / ticket (LTI context token).');
        }

        // LTI 1.1 launches carry a `ticket` (no ltijs ltik); 1.3 launches carry
        // an `ltik`. Exchange whichever is present for an app JWT.
        const session = ticket ? await getLtiSessionByTicket(ticket) : await getLtiSession(ltik);
        await persistToken(String(session.token), Number(session.expiresIn), session.tenant);

        setStatus('Loading your profile…');
        const user = await loadProfile();

        const passthrough: Record<string, string> = {};
        if (embedded) passthrough.embedded = '1';
        if (lti) passthrough.lti = '1';
        if (lock) passthrough.lock = '1';
        if (returnTo) passthrough.returnTo = returnTo;

        // Persist LTI context so route guards / lock policies can read it later.
        if (categoryId) {
          localStorage.setItem('app.lti.categoryId', categoryId);
          if (courseId) localStorage.setItem('app.lti.courseId', courseId);
          if (ltik) localStorage.setItem('app.lti.ltik', ltik);
          localStorage.removeItem('app.lti.lock');
          localStorage.removeItem('app.lti.lockAgentId');
        } else if (lock === '1' && agentId) {
          localStorage.setItem('app.lti.lock', '1');
          localStorage.setItem('app.lti.lockAgentId', agentId);
          localStorage.removeItem('app.lti.categoryId');
          localStorage.removeItem('app.lti.courseId');
        } else {
          localStorage.removeItem('app.lti.lock');
          localStorage.removeItem('app.lti.lockAgentId');
          localStorage.removeItem('app.lti.categoryId');
          localStorage.removeItem('app.lti.courseId');
        }

        const target = targetRouteFor({ agentId, categoryId, courseId, user, passthrough });
        navigate(buildUrl(target), { replace: true });
      } catch (e: any) {
        setError(String(e?.message || 'LTI launch failed.'));
      }
    })();
  }, [navigate, searchParams]);

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <h1 style={styles.h1}>LTI Launch</h1>
        {!error ? (
          <p style={styles.muted}>{status}</p>
        ) : (
          <p style={styles.error}>{error}</p>
        )}

        {error && (
          <div style={styles.actions}>
            <a style={styles.btn} href={LOGIN_HREF}>
              Go to Login
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: 'min(640px, 100%)',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: 20,
    background: '#fff',
  },
  h1: { margin: '0 0 10px', fontSize: 18, color: '#0f172a' },
  muted: { color: '#64748b', margin: 0 },
  error: { color: '#9f1239', margin: 0 },
  actions: { marginTop: 16 },
  btn: {
    display: 'inline-block',
    padding: '10px 14px',
    borderRadius: 10,
    background: '#0ea5e9',
    color: '#fff',
    textDecoration: 'none',
    fontWeight: 700,
  },
};

export default LtiLaunch;
