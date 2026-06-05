/**
 * LtiPlatformsAdmin — React port of LtiPlatformsAdmin.vue.
 *
 * Admin-only screen to register / update / delete LMS platforms (Moodle, etc.)
 * for LTI 1.3. Calls `/api/v1/lti/platforms` via the shared `../api` module,
 * which requires the app's Bearer token to already be set on axios defaults
 * by your auth layer.
 *
 * Requires `react`, `react-dom`, and `axios` (peer deps). No router needed.
 */

import { Fragment, useCallback, useEffect, useState } from 'react';

import {
  listLtiPlatforms,
  saveLtiPlatform,
  deleteLtiPlatform,
  testLtiPlatform,
  type LtiPlatform,
  type LtiConnectionTestResult,
} from '../api';

interface PlatformForm {
  name: string;
  url: string;
  clientId: string;
  authenticationEndpoint: string;
  accesstokenEndpoint: string;
  authConfigMethod: string;
  authConfigKey: string;
}

const EMPTY_FORM: PlatformForm = {
  name: 'Moodle',
  url: '',
  clientId: '',
  authenticationEndpoint: '',
  accesstokenEndpoint: '',
  authConfigMethod: 'JWK_SET',
  authConfigKey: '',
};

function errText(e: any, fallback: string): string {
  return e?.response?.data?.message || e?.message || fallback;
}

function rowKey(p: LtiPlatform): string {
  return p.platformId || `${p.url}-${p.clientId}`;
}

export function LtiPlatformsAdmin() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [platforms, setPlatforms] = useState<LtiPlatform[]>([]);
  const [form, setForm] = useState<PlatformForm>({ ...EMPTY_FORM });
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, LtiConnectionTestResult>>({});

  const canTest = Boolean(
    form.authConfigKey && form.authenticationEndpoint && form.accesstokenEndpoint
  );

  const loadPlatforms = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setPlatforms(await listLtiPlatforms());
    } catch (e: any) {
      setError(errText(e, 'Failed to load platforms.'));
    } finally {
      setLoading(false);
    }
  }, []);

  function setField<K extends keyof PlatformForm>(key: K, value: PlatformForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function resetForm() {
    setForm({ ...EMPTY_FORM });
  }

  function prefill(p: LtiPlatform) {
    setForm({
      name: p.name || 'Moodle',
      url: p.url || '',
      clientId: p.clientId || '',
      authenticationEndpoint: p.authenticationEndpoint || '',
      accesstokenEndpoint: p.accesstokenEndpoint || '',
      authConfigMethod: p.authConfigMethod || 'JWK_SET',
      authConfigKey: p.authConfigKey || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function savePlatform() {
    setError(null);
    setSaving(true);
    try {
      await saveLtiPlatform(form);
      await loadPlatforms();
    } catch (e: any) {
      setError(errText(e, 'Failed to save platform.'));
    } finally {
      setSaving(false);
    }
  }

  async function testForm() {
    if (!canTest) return;
    setError(null);
    setTestingKey('form');
    try {
      const result = await testLtiPlatform({
        authenticationEndpoint: form.authenticationEndpoint,
        accesstokenEndpoint: form.accesstokenEndpoint,
        authConfigKey: form.authConfigKey,
        authConfigMethod: form.authConfigMethod,
      });
      setResults((prev) => ({ ...prev, form: result }));
    } catch (e: any) {
      setError(errText(e, 'Connection test failed.'));
    } finally {
      setTestingKey(null);
    }
  }

  async function testRow(p: LtiPlatform) {
    setError(null);
    const key = rowKey(p);
    setTestingKey(key);
    try {
      const result = p.platformId
        ? await testLtiPlatform({ platformId: p.platformId })
        : await testLtiPlatform({
            authenticationEndpoint: p.authenticationEndpoint || '',
            accesstokenEndpoint: p.accesstokenEndpoint || '',
            authConfigKey: p.authConfigKey || '',
            authConfigMethod: p.authConfigMethod || 'JWK_SET',
          });
      setResults((prev) => ({ ...prev, [key]: result }));
    } catch (e: any) {
      setError(errText(e, 'Connection test failed.'));
    } finally {
      setTestingKey(null);
    }
  }

  async function remove(p: LtiPlatform) {
    setError(null);
    const id = p.platformId || '';
    setDeletingId(id || null);
    try {
      await deleteLtiPlatform({ platformId: id, url: p.url || '', clientId: p.clientId || '' });
      await loadPlatforms();
    } catch (e: any) {
      setError(errText(e, 'Failed to delete platform.'));
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    loadPlatforms();
  }, [loadPlatforms]);

  return (
    <div style={styles.wrap}>
      <div style={styles.panelHeader}>
        <div>
          <h1 style={styles.panelTitle}>
            <i className="fas fa-plug" style={styles.titleIcon} /> LTI Platforms
          </h1>
          <p style={styles.panelSubtitle}>
            Register and manage LMS platforms (Moodle) for LTI 1.3
          </p>
        </div>
        <div>
          <button
            style={{ ...styles.btn, ...styles.btnSecondary }}
            disabled={loading}
            onClick={loadPlatforms}
          >
            <i className="fas fa-sync-alt" /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={styles.alert}>
          <i className="fas fa-exclamation-triangle" />
          <span>{error}</span>
        </div>
      )}

      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Add / Update Platform</h2>
        <div style={styles.formGrid}>
          <Field label="Name">
            <input
              style={styles.input}
              type="text"
              placeholder="Moodle HKU"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
            />
          </Field>
          <Field label="Platform URL">
            <input
              style={styles.input}
              type="text"
              placeholder="https://moodle.example.com"
              value={form.url}
              onChange={(e) => setField('url', e.target.value)}
            />
          </Field>
          <Field label="Client ID">
            <input
              style={styles.input}
              type="text"
              placeholder="(from Moodle tool registration)"
              value={form.clientId}
              onChange={(e) => setField('clientId', e.target.value)}
            />
          </Field>
          <Field label="Authentication Endpoint">
            <input
              style={styles.input}
              type="text"
              placeholder="https://moodle.../auth.php"
              value={form.authenticationEndpoint}
              onChange={(e) => setField('authenticationEndpoint', e.target.value)}
            />
          </Field>
          <Field label="Access Token Endpoint">
            <input
              style={styles.input}
              type="text"
              placeholder="https://moodle.../token.php"
              value={form.accesstokenEndpoint}
              onChange={(e) => setField('accesstokenEndpoint', e.target.value)}
            />
          </Field>
          <Field label="Auth Config Method">
            <select
              style={styles.input}
              value={form.authConfigMethod}
              onChange={(e) => setField('authConfigMethod', e.target.value)}
            >
              <option value="JWK_SET">JWK_SET</option>
              <option value="JWK_KEY">JWK_KEY</option>
              <option value="RSA_KEY">RSA_KEY</option>
            </select>
          </Field>
          <Field label="Auth Config Key" wide>
            <input
              style={styles.input}
              type="text"
              placeholder="For JWK_SET: https://moodle.../certs.php"
              value={form.authConfigKey}
              onChange={(e) => setField('authConfigKey', e.target.value)}
            />
          </Field>
        </div>

        <div style={styles.actions}>
          <button
            style={{ ...styles.btn, ...styles.btnPrimary }}
            disabled={saving}
            onClick={savePlatform}
          >
            <i className="fas fa-save" /> {saving ? 'Saving…' : 'Save Platform'}
          </button>
          <button
            style={{ ...styles.btn, ...styles.btnSecondary }}
            disabled={!canTest || testingKey === 'form'}
            onClick={testForm}
          >
            <i className="fas fa-plug" /> {testingKey === 'form' ? 'Testing…' : 'Test Connection'}
          </button>
          <button
            style={{ ...styles.btn, ...styles.btnSecondary }}
            disabled={saving}
            onClick={resetForm}
          >
            <i className="fas fa-undo" /> Reset
          </button>
        </div>
        <ConnectionResult result={results.form} />
        <p style={styles.muted}>
          Calls <code>/api/v1/lti/platforms</code> (admin-only). LTI must be enabled on the backend
          (<code>LTI_ENABLED=true</code>).
        </p>
      </div>

      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Registered Platforms</h2>

        {loading ? (
          <div style={styles.muted}>Loading…</div>
        ) : platforms.length === 0 ? (
          <div style={styles.muted}>No platforms registered yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>URL</th>
                  <th style={styles.th}>Client ID</th>
                  <th style={styles.th}>Auth</th>
                  <th style={styles.th}>Token</th>
                  <th style={styles.th}>Keyset</th>
                  <th style={{ ...styles.th, width: 140 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {platforms.map((p) => {
                  const key = rowKey(p);
                  return (
                    <Fragment key={key}>
                      <tr>
                        <td style={styles.td}>{p.name || '-'}</td>
                        <td style={{ ...styles.td, ...styles.mono }}>{p.url || '-'}</td>
                        <td style={{ ...styles.td, ...styles.mono }}>{p.clientId || '-'}</td>
                        <td style={{ ...styles.td, ...styles.mono }}>
                          {p.authenticationEndpoint || '-'}
                        </td>
                        <td style={{ ...styles.td, ...styles.mono }}>
                          {p.accesstokenEndpoint || '-'}
                        </td>
                        <td style={{ ...styles.td, ...styles.mono }}>{p.authConfigKey || '-'}</td>
                        <td style={styles.td}>
                          <button
                            style={styles.btnLink}
                            disabled={testingKey === key}
                            onClick={() => testRow(p)}
                          >
                            <i className="fas fa-plug" /> {testingKey === key ? 'Testing…' : 'Test'}
                          </button>
                          <button style={styles.btnLink} onClick={() => prefill(p)}>
                            <i className="fas fa-pen" /> Edit
                          </button>
                          <button
                            style={{ ...styles.btnLink, ...styles.btnLinkDanger }}
                            disabled={deletingId === p.platformId}
                            onClick={() => remove(p)}
                          >
                            <i className="fas fa-trash" /> Delete
                          </button>
                        </td>
                      </tr>
                      {results[key] && (
                        <tr>
                          <td style={styles.td} colSpan={7}>
                            <ConnectionResult result={results[key]} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Field(props: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div style={props.wide ? { gridColumn: '1 / -1' } : undefined}>
      <label style={styles.fieldLabel}>{props.label}</label>
      {props.children}
    </div>
  );
}

function ConnectionResult(props: { result?: LtiConnectionTestResult }) {
  const { result } = props;
  if (!result) return null;
  const box = {
    ...styles.connResult,
    ...(result.success ? styles.connResultOk : styles.connResultBad),
  };
  return (
    <div style={box}>
      <div
        style={{
          ...styles.connSummary,
          color: result.success ? '#166534' : '#9f1239',
        }}
      >
        <i className={result.success ? 'fas fa-check-circle' : 'fas fa-exclamation-triangle'} />
        <span>{result.success ? 'Connection OK' : 'Issues found'}</span>
      </div>
      <ul style={styles.connChecks}>
        {result.checks.map((check) => (
          <li key={check.id} style={styles.connCheckItem}>
            <span
              style={{ ...styles.connDot, background: check.ok ? '#22c55e' : '#ef4444' }}
            />
            <span style={styles.connCheckLabel}>{check.label}:</span>
            <span style={{ color: check.ok ? '#475569' : '#9f1239' }}>{check.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { padding: 18 },
  panelHeader: {
    display: 'flex',
    gap: 16,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  panelTitle: { margin: 0, fontSize: 20, color: '#0f172a' },
  titleIcon: { marginRight: 8, color: '#0ea5e9' },
  panelSubtitle: { margin: '6px 0 0', color: '#64748b' },
  card: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
  },
  cardTitle: { margin: '0 0 12px', fontSize: 16, color: '#0f172a' },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 12,
  },
  fieldLabel: {
    display: 'block',
    fontWeight: 700,
    fontSize: 12,
    marginBottom: 6,
    color: '#334155',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #cbd5e1',
    borderRadius: 10,
    fontSize: 14,
    boxSizing: 'border-box',
  },
  actions: { display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  btn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 16px',
    borderRadius: 10,
    border: '1px solid #cbd5e1',
    background: '#fff',
    cursor: 'pointer',
    fontWeight: 600,
  },
  btnPrimary: { background: '#0ea5e9', color: '#fff', borderColor: '#0ea5e9' },
  btnSecondary: { background: '#fff', color: '#0f172a' },
  muted: { color: '#64748b', fontSize: 13 },
  alert: {
    padding: '10px 14px',
    borderRadius: 10,
    marginBottom: 12,
    display: 'flex',
    gap: 8,
    alignItems: 'flex-start',
    background: '#fff1f2',
    color: '#9f1239',
    border: '1px solid #fecdd3',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    borderBottom: '1px solid #e2e8f0',
    padding: '8px 10px',
    textAlign: 'left',
    verticalAlign: 'top',
    background: '#f8fafc',
    fontWeight: 700,
    color: '#334155',
  },
  td: {
    borderBottom: '1px solid #e2e8f0',
    padding: '8px 10px',
    textAlign: 'left',
    verticalAlign: 'top',
  },
  mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' },
  btnLink: {
    border: 0,
    background: 'transparent',
    color: '#0ea5e9',
    cursor: 'pointer',
    marginRight: 6,
    fontWeight: 600,
  },
  btnLinkDanger: { color: '#9f1239' },
  connResult: {
    marginTop: 10,
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: '10px 12px',
    background: '#f8fafc',
  },
  connResultOk: { borderColor: '#bbf7d0', background: '#f0fdf4' },
  connResultBad: { borderColor: '#fecdd3', background: '#fff1f2' },
  connSummary: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontWeight: 700,
    fontSize: 13,
    marginBottom: 8,
  },
  connChecks: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 },
  connCheckItem: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    fontSize: 12,
    color: '#475569',
  },
  connDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    flex: '0 0 auto',
    transform: 'translateY(1px)',
  },
  connCheckLabel: { fontWeight: 700, color: '#334155' },
};

export default LtiPlatformsAdmin;
