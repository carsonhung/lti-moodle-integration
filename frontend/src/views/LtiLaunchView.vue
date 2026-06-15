<template>
  <div class="lti-launch">
    <div class="card">
      <h1>LTI Launch</h1>
      <p v-if="!error" class="muted">{{ status }}</p>
      <p v-else class="error">{{ error }}</p>

      <div v-if="error" class="actions">
        <a class="btn" :href="loginHref">Go to Login</a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * LtiLaunchView — Receives an `ltik` query param, exchanges it for an app JWT,
 * persists the token, and redirects to the correct in-app route based on
 * role + the optional `agentId` / `categoryId` query params.
 *
 * INTEGRATION NOTES
 * -----------------
 * This component is intentionally framework-light. To wire it into a Vue 3
 * app, edit the `INTEGRATION HOOKS` section below to:
 *   1. Call your auth store's "set token" action after `getLtiSession`.
 *   2. Trigger your "fetch profile" action.
 *   3. Use your router to redirect to the in-app target (agent/category page).
 *
 * The hooks are intentionally inline (not props) because Vue's `<script setup>`
 * can't take callbacks from a parent for an entry-point view that has no parent.
 * If you need true reusability, wrap this component or pass callbacks via
 * provide/inject from `App.vue`.
 */

import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import { getLtiSession, getLtiSessionByTicket } from '../api';

const route = useRoute();
const router = useRouter();

const status = ref('Signing you in…');
const error = ref<string | null>(null);
const loginHref = '/login';

/* ─── INTEGRATION HOOKS ────────────────────────────────────────────────────
 * Replace the bodies of these functions with calls into your auth store
 * (Pinia / Vuex) and profile fetcher. They run once per launch.
 */

async function persistToken(token: string, expiresInSec: number, tenant?: string) {
  // EXAMPLE (Pinia):
  //   const auth = useAuthStore();
  //   auth.setToken(token, expiresInSec * 1000);
  //   if (tenant) useTenantStore().setTenant(tenant);
  const expirationDate = Date.now() + expiresInSec * 1000;
  localStorage.setItem('app.token', token);
  localStorage.setItem('app.tokenExpiration', String(expirationDate));
  if (tenant) localStorage.setItem('app.tenant', tenant);
  axios.defaults.headers.common['Authorization'] = 'Bearer ' + token;
}

async function loadProfile(): Promise<{ roles?: string[] } | null> {
  // EXAMPLE: return (await api.get('/auth/me')).data.user;
  return null;
}

function targetRouteFor(opts: {
  agentId?: string;
  categoryId?: string;
  courseId?: string;
  user: { roles?: string[] } | null;
  passthrough: Record<string, string>;
}): { name: string; params?: Record<string, string>; query?: Record<string, string> } {
  const { agentId, categoryId, user, passthrough } = opts;
  const roles = user?.roles || [];
  const isAdmin = roles.includes('admin');
  const isTeacher = roles.includes('teacher');

  if (categoryId) {
    return { name: 'LtiCategory', params: { categoryId }, query: passthrough };
  }
  if (!agentId) return { name: 'Welcome' };

  if (isAdmin) return { name: 'AdminTopic', params: { agentId }, query: passthrough };
  if (isTeacher) return { name: 'TeacherTopic', params: { agentId }, query: passthrough };
  return { name: 'StudentTopic', params: { agentId }, query: passthrough };
}

/* ───────────────────────────────────────────────────────────────────────── */

onMounted(async () => {
  try {
    const ltik = String(route.query.ltik ?? '').trim();
    const ticket = String(route.query.ticket ?? '').trim();
    const agentId = String(route.query.agentId ?? '').trim();
    const categoryId = String(route.query.categoryId ?? '').trim();
    const courseId = String(route.query.courseId ?? '').trim();
    const embedded = String(route.query.embedded ?? '').trim();
    const lti = String(route.query.lti ?? '').trim();
    const lock = String(route.query.lock ?? '').trim();
    const returnTo = String(route.query.returnTo ?? '').trim();

    if (!ltik && !ticket) {
      throw new Error('Missing ltik / ticket (LTI context token).');
    }

    // LTI 1.1 launches carry a `ticket` (no ltijs ltik); 1.3 launches carry an
    // `ltik`. Exchange whichever is present for an app JWT.
    const session = ticket ? await getLtiSessionByTicket(ticket) : await getLtiSession(ltik);
    await persistToken(String(session.token), Number(session.expiresIn), session.tenant);

    status.value = 'Loading your profile…';
    const user = await loadProfile();

    const passthrough: Record<string, string> = {};
    if (embedded) passthrough.embedded = '1';
    if (lti) passthrough.lti = '1';
    if (lock) passthrough.lock = '1';
    if (returnTo) passthrough.returnTo = returnTo;

    // Persist LTI context so router guards / lock policies can read it later.
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
    await router.replace(target);
  } catch (e: any) {
    error.value = String(e?.message || 'LTI launch failed.');
  }
});
</script>

<style scoped>
.lti-launch {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.card {
  width: min(640px, 100%);
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 20px;
  background: #fff;
}
h1 {
  margin: 0 0 10px;
  font-size: 18px;
  color: #0f172a;
}
.muted {
  color: #64748b;
  margin: 0;
}
.error {
  color: #9f1239;
  margin: 0;
}
.actions {
  margin-top: 16px;
}
.btn {
  display: inline-block;
  padding: 10px 14px;
  border-radius: 10px;
  background: #0ea5e9;
  color: #fff;
  text-decoration: none;
  font-weight: 700;
}
</style>
