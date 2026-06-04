<template>
  <div class="lti-platforms">
    <div class="panel-header">
      <div class="header-content">
        <h1 class="panel-title">
          <i class="fas fa-plug"></i>
          LTI Platforms
        </h1>
        <p class="panel-subtitle">Register and manage LMS platforms (Moodle) for LTI 1.3</p>
      </div>
      <div class="header-actions">
        <button class="btn-action secondary" :disabled="loading" @click="loadPlatforms">
          <i class="fas fa-sync-alt"></i>
          Refresh
        </button>
      </div>
    </div>

    <div v-if="error" class="alert alert-danger">
      <i class="fas fa-exclamation-triangle"></i>
      <span>{{ error }}</span>
    </div>

    <div class="card">
      <h2 class="card-title">Add / Update Platform</h2>
      <div class="form-grid">
        <div class="field">
          <label>Name</label>
          <input v-model="form.name" type="text" placeholder="Moodle HKU" />
        </div>
        <div class="field">
          <label>Platform URL</label>
          <input v-model="form.url" type="text" placeholder="https://moodle.example.com" />
        </div>
        <div class="field">
          <label>Client ID</label>
          <input
            v-model="form.clientId"
            type="text"
            placeholder="(from Moodle tool registration)"
          />
        </div>
        <div class="field">
          <label>Authentication Endpoint</label>
          <input
            v-model="form.authenticationEndpoint"
            type="text"
            placeholder="https://moodle.../auth.php"
          />
        </div>
        <div class="field">
          <label>Access Token Endpoint</label>
          <input
            v-model="form.accesstokenEndpoint"
            type="text"
            placeholder="https://moodle.../token.php"
          />
        </div>
        <div class="field">
          <label>Auth Config Method</label>
          <select v-model="form.authConfigMethod">
            <option value="JWK_SET">JWK_SET</option>
            <option value="JWK_KEY">JWK_KEY</option>
            <option value="RSA_KEY">RSA_KEY</option>
          </select>
        </div>
        <div class="field field-wide">
          <label>Auth Config Key</label>
          <input
            v-model="form.authConfigKey"
            type="text"
            placeholder="For JWK_SET: https://moodle.../certs.php"
          />
        </div>
      </div>

      <div class="actions">
        <button class="btn-action primary" :disabled="saving" @click="savePlatform">
          <i class="fas fa-save"></i>
          {{ saving ? 'Saving…' : 'Save Platform' }}
        </button>
        <button class="btn-action secondary" :disabled="saving" @click="resetForm">
          <i class="fas fa-undo"></i>
          Reset
        </button>
      </div>
      <p class="muted">
        Calls <code>/api/v1/lti/platforms</code> (admin-only). LTI must be enabled on the backend
        (<code>LTI_ENABLED=true</code>).
      </p>
    </div>

    <div class="card">
      <h2 class="card-title">Registered Platforms</h2>

      <div v-if="loading" class="muted">Loading…</div>
      <div v-else-if="platforms.length === 0" class="muted">No platforms registered yet.</div>

      <div v-else class="table-wrap">
        <table class="platforms-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>URL</th>
              <th>Client ID</th>
              <th>Auth</th>
              <th>Token</th>
              <th>Keyset</th>
              <th style="width: 140px">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in platforms" :key="p.platformId || `${p.url}-${p.clientId}`">
              <td>{{ p.name || '-' }}</td>
              <td class="mono">{{ p.url || '-' }}</td>
              <td class="mono">{{ p.clientId || '-' }}</td>
              <td class="mono">{{ p.authenticationEndpoint || '-' }}</td>
              <td class="mono">{{ p.accesstokenEndpoint || '-' }}</td>
              <td class="mono">{{ p.authConfigKey || '-' }}</td>
              <td>
                <button class="btn-link" @click="prefill(p)">
                  <i class="fas fa-pen"></i> Edit
                </button>
                <button
                  class="btn-link danger"
                  :disabled="deletingId === p.platformId"
                  @click="remove(p)"
                >
                  <i class="fas fa-trash"></i> Delete
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  listLtiPlatforms,
  saveLtiPlatform,
  deleteLtiPlatform,
  type LtiPlatform,
} from '../api';

const loading = ref(false);
const saving = ref(false);
const deletingId = ref<string | null>(null);
const error = ref<string | null>(null);
const platforms = ref<LtiPlatform[]>([]);

const form = ref({
  name: 'Moodle',
  url: '',
  clientId: '',
  authenticationEndpoint: '',
  accesstokenEndpoint: '',
  authConfigMethod: 'JWK_SET',
  authConfigKey: '',
});

async function loadPlatforms() {
  error.value = null;
  loading.value = true;
  try {
    platforms.value = await listLtiPlatforms();
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || 'Failed to load platforms.';
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  form.value = {
    name: 'Moodle',
    url: '',
    clientId: '',
    authenticationEndpoint: '',
    accesstokenEndpoint: '',
    authConfigMethod: 'JWK_SET',
    authConfigKey: '',
  };
}

function prefill(p: LtiPlatform) {
  form.value = {
    name: p.name || 'Moodle',
    url: p.url || '',
    clientId: p.clientId || '',
    authenticationEndpoint: p.authenticationEndpoint || '',
    accesstokenEndpoint: p.accesstokenEndpoint || '',
    authConfigMethod: p.authConfigMethod || 'JWK_SET',
    authConfigKey: p.authConfigKey || '',
  };
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function savePlatform() {
  error.value = null;
  saving.value = true;
  try {
    await saveLtiPlatform(form.value);
    await loadPlatforms();
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || 'Failed to save platform.';
  } finally {
    saving.value = false;
  }
}

async function remove(p: LtiPlatform) {
  error.value = null;
  const id = p.platformId || '';
  deletingId.value = id || null;
  try {
    await deleteLtiPlatform({ platformId: id, url: p.url || '', clientId: p.clientId || '' });
    await loadPlatforms();
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || 'Failed to delete platform.';
  } finally {
    deletingId.value = null;
  }
}

onMounted(() => {
  loadPlatforms();
});
</script>

<style scoped>
.lti-platforms { padding: 18px; }
.panel-header {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 14px;
}
.panel-title { margin: 0; font-size: 20px; color: #0f172a; }
.panel-title i { margin-right: 8px; color: #0ea5e9; }
.panel-subtitle { margin: 6px 0 0; color: #64748b; }

.card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 14px;
}
.card-title { margin: 0 0 12px; font-size: 16px; color: #0f172a; }

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.field-wide { grid-column: 1 / -1; }
.field label {
  display: block;
  font-weight: 700;
  font-size: 12px;
  margin-bottom: 6px;
  color: #334155;
}
.field input,
.field select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  font-size: 14px;
}

.actions { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.btn-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  background: #fff;
  cursor: pointer;
  font-weight: 600;
}
.btn-action.primary { background: #0ea5e9; color: #fff; border-color: #0ea5e9; }
.btn-action.secondary { background: #fff; color: #0f172a; }
.btn-action[disabled] { opacity: 0.6; cursor: not-allowed; }

.muted { color: #64748b; font-size: 13px; }

.alert {
  padding: 10px 14px;
  border-radius: 10px;
  margin-bottom: 12px;
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.alert-danger { background: #fff1f2; color: #9f1239; border: 1px solid #fecdd3; }

.table-wrap { overflow-x: auto; }
.platforms-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.platforms-table th,
.platforms-table td {
  border-bottom: 1px solid #e2e8f0;
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
}
.platforms-table th { background: #f8fafc; font-weight: 700; color: #334155; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }

.btn-link {
  border: 0;
  background: transparent;
  color: #0ea5e9;
  cursor: pointer;
  margin-right: 6px;
  font-weight: 600;
}
.btn-link.danger { color: #9f1239; }
.btn-link:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
