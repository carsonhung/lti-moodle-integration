/**
 * LtiDeepLink — React port of LtiDeepLinkView.vue.
 *
 * Teacher-facing Deep Linking UI: pick a course, then a single resource
 * (agent) OR a category, then submit to bind the selection to the Moodle
 * activity and return to Moodle.
 *
 * All data flows through the shared `../api` module (same endpoints the Vue
 * view uses). Styling is inline so the component is drop-in with no CSS file;
 * restyle to match your design system as needed.
 *
 * NOTE: This screen is optional. The backend also ships a server-rendered
 * HTML deep-link page (`deepLinkingUI.ts`), so you can skip this component
 * entirely and let ltijs render the picker if you don't want it in React.
 *
 * Requires `react`, `react-dom`, `react-router-dom`, and `axios` (peer deps).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  getDeepLinkData,
  getDeepLinkAgents,
  getDeepLinkCategories,
  submitDeepLink,
  getLtiBase,
  type DeepLinkData,
  type DeepLinkAgent,
  type DeepLinkCourse,
  type DeepLinkCategory,
} from '../api';

const DEBOUNCE_SEARCH_MS = 300;

interface LtiDeepLinkProps {
  /**
   * Set to `false` to hide the category-binding toggle when your app
   * doesn't implement the adapter's category methods.
   */
  categorySupported?: boolean;
}

type BindingType = 'agent' | 'category';

function formatCourseLabel(c: DeepLinkCourse): string {
  const parts: string[] = [];
  if (c.course_id) parts.push(`[${c.course_id}]`);
  parts.push(c.name);
  const meta = [c.code, c.semester, c.year, c.section].filter(Boolean);
  if (meta.length) parts.push(`(${meta.join(' ')})`);
  return parts.join(' ');
}

export function LtiDeepLink({ categorySupported = true }: LtiDeepLinkProps) {
  const [searchParams] = useSearchParams();
  const ltik = useMemo(() => (searchParams.get('ltik') ?? '').trim(), [searchParams]);
  const createdAgentId = useMemo(
    () => (searchParams.get('createdAgentId') ?? '').trim(),
    [searchParams]
  );

  const [pageData, setPageData] = useState<DeepLinkData | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [bindingType, setBindingType] = useState<BindingType>('agent');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [agents, setAgents] = useState<DeepLinkAgent[]>([]);
  const [categories, setCategories] = useState<DeepLinkCategory[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [publicSearchQuery, setPublicSearchQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const courseAgents = useMemo(() => agents.filter((a) => a.source === 'course'), [agents]);
  const publicAgents = useMemo(() => agents.filter((a) => a.source === 'public'), [agents]);

  const canSubmit = useMemo(() => {
    if (!selectedCourseId) return false;
    if (bindingType === 'category') return !!selectedCategoryId;
    return !!selectedAgentId;
  }, [selectedCourseId, bindingType, selectedCategoryId, selectedAgentId]);

  const loadAgents = useCallback(
    async (courseId: string, query: string) => {
      if (!courseId || !ltik) return;
      setIsLoadingAgents(true);
      setSelectedAgentId('');
      try {
        const next = await getDeepLinkAgents(ltik, courseId, query);
        setAgents(next);
        if (createdAgentId) {
          const match = next.find((a) => a._id === createdAgentId);
          if (match) setSelectedAgentId(match._id);
        }
      } catch {
        setAgents([]);
        setErrorMessage('Failed to load resources.');
      } finally {
        setIsLoadingAgents(false);
      }
    },
    [ltik, createdAgentId]
  );

  const loadCategories = useCallback(
    async (courseId: string) => {
      if (!categorySupported) return;
      if (!courseId || !ltik) return;
      setIsLoadingCategories(true);
      setSelectedCategoryId('');
      try {
        setCategories(await getDeepLinkCategories(ltik, courseId));
      } catch {
        setCategories([]);
      } finally {
        setIsLoadingCategories(false);
      }
    },
    [ltik, categorySupported]
  );

  function onCourseChange(courseId: string) {
    setSelectedCourseId(courseId);
    setPublicSearchQuery('');
    setSelectedAgentId('');
    setSelectedCategoryId('');
    loadAgents(courseId, '');
    loadCategories(courseId);
  }

  function onSearchInput(value: string) {
    setPublicSearchQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadAgents(selectedCourseId, value), DEBOUNCE_SEARCH_MS);
  }

  function onBindingTypeChange(next: BindingType) {
    setBindingType(next);
    setSelectedAgentId('');
    setSelectedCategoryId('');
  }

  async function handleSubmit() {
    if (!ltik || !selectedCourseId) return;
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const result = await submitDeepLink(
        ltik,
        selectedCourseId,
        bindingType === 'agent' ? selectedAgentId : undefined,
        bindingType === 'category' ? selectedCategoryId : undefined
      );

      if (result.jwt && result.returnUrl) {
        const sep = result.returnUrl.includes('?') ? '&' : '?';
        window.location.assign(`${result.returnUrl}${sep}JWT=${encodeURIComponent(result.jwt)}`);
      } else {
        // Popup reconfigure flow — return to the teacher manage page.
        const manageUrl = `${getLtiBase()}/launch/manage?ltik=${encodeURIComponent(ltik)}&updated=1`;
        window.location.assign(manageUrl);
      }
    } catch (e: any) {
      setErrorMessage(e?.message || 'Failed to save selection.');
    } finally {
      setIsSubmitting(false);
    }
  }

  useEffect(() => {
    if (!ltik) {
      setErrorMessage('Missing LTI context token.');
      setIsLoadingData(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await getDeepLinkData(ltik);
        if (cancelled) return;
        setPageData(data);
        if (data.error) setErrorMessage(data.error);
        if (data.preselectedCourseId) {
          setSelectedCourseId(data.preselectedCourseId);
          await Promise.all([
            loadAgents(data.preselectedCourseId, ''),
            loadCategories(data.preselectedCourseId),
          ]);
        }
      } catch (e: any) {
        if (!cancelled) setErrorMessage(e?.message || 'Failed to load configuration data.');
      } finally {
        if (!cancelled) setIsLoadingData(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ltik, loadAgents, loadCategories]);

  const suggested = pageData?.suggestedCourses ?? [];

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <header style={styles.header}>
          <div style={styles.headerIcon}>
            <i className="fa-solid fa-link" />
          </div>
          <div>
            <h1 style={styles.title}>{pageData?.title || 'Configure Activity'}</h1>
            {pageData?.email && (
              <p style={styles.subtitle}>
                Signed in via Moodle as <strong>{pageData.email}</strong>
              </p>
            )}
          </div>
        </header>

        {errorMessage && (
          <div style={styles.errorBar}>
            <i className="fa-solid fa-circle-exclamation" />
            <span>{errorMessage}</span>
          </div>
        )}

        {isLoadingData ? (
          <div style={styles.loading}>
            <i className="fa-solid fa-spinner fa-spin" />
            <span>Loading…</span>
          </div>
        ) : (
          pageData &&
          !pageData.error && (
            <>
              <div style={styles.section}>
                <label htmlFor="dl-course" style={styles.label}>
                  <i className="fa-solid fa-graduation-cap" /> Course
                </label>
                <select
                  id="dl-course"
                  value={selectedCourseId}
                  style={styles.select}
                  onChange={(e) => onCourseChange(e.target.value)}
                >
                  <option value="">Select a course…</option>
                  {suggested.length > 0 ? (
                    <>
                      <optgroup label="My courses">
                        {pageData.courses.map((c) => (
                          <option key={c._id} value={c._id}>
                            {formatCourseLabel(c)}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Suggested matches">
                        {suggested.map((c) => (
                          <option key={c._id} value={c._id}>
                            {formatCourseLabel(c)}
                          </option>
                        ))}
                      </optgroup>
                    </>
                  ) : (
                    pageData.courses.map((c) => (
                      <option key={c._id} value={c._id}>
                        {formatCourseLabel(c)}
                      </option>
                    ))
                  )}
                </select>
                <p style={styles.hint}>Maps this Moodle course to a course in the app.</p>
              </div>

              {selectedCourseId && categorySupported && (
                <div style={styles.section}>
                  <div style={styles.toggle}>
                    <button
                      type="button"
                      style={{
                        ...styles.toggleBtn,
                        ...(bindingType === 'agent' ? styles.toggleBtnActive : {}),
                      }}
                      onClick={() => onBindingTypeChange('agent')}
                    >
                      <i className="fa-solid fa-robot" /> Single{' '}
                      {pageData.resourceLabel || 'resource'}
                    </button>
                    <button
                      type="button"
                      style={{
                        ...styles.toggleBtn,
                        ...(bindingType === 'category' ? styles.toggleBtnActive : {}),
                      }}
                      onClick={() => onBindingTypeChange('category')}
                    >
                      <i className="fa-solid fa-folder-open" /> Category
                    </button>
                  </div>
                </div>
              )}

              {bindingType === 'agent' && (
                <div style={styles.section}>
                  <label style={styles.label}>
                    <i className="fa-solid fa-robot" /> {pageData.resourceLabel || 'Resource'}
                  </label>

                  {selectedCourseId && (
                    <div style={styles.searchRow}>
                      <i className="fa-solid fa-magnifying-glass" style={styles.searchIcon} />
                      <input
                        value={publicSearchQuery}
                        type="text"
                        placeholder="Search public resources (type 2+ chars)"
                        style={styles.searchInput}
                        onChange={(e) => onSearchInput(e.target.value)}
                      />
                    </div>
                  )}

                  {isLoadingAgents ? (
                    <div style={styles.loadingInline}>
                      <i className="fa-solid fa-spinner fa-spin" />
                      <span>Loading resources…</span>
                    </div>
                  ) : !selectedCourseId ? (
                    <div style={styles.empty}>
                      <i className="fa-solid fa-arrow-up-long" />
                      <span>Select a course first.</span>
                    </div>
                  ) : agents.length === 0 ? (
                    <div style={styles.empty}>
                      <i className="fa-solid fa-robot" />
                      <span>No resources found.</span>
                    </div>
                  ) : (
                    <div style={styles.list}>
                      {courseAgents.length > 0 && (
                        <>
                          <div style={styles.groupHeader}>Course resources</div>
                          {courseAgents.map((a) => (
                            <button
                              key={a._id}
                              type="button"
                              style={{
                                ...styles.item,
                                ...(selectedAgentId === a._id ? styles.itemSelected : {}),
                              }}
                              onClick={() => setSelectedAgentId(a._id)}
                            >
                              <span style={styles.itemName}>{a.name}</span>
                              {selectedAgentId === a._id && (
                                <i className="fa-solid fa-circle-check" style={styles.check} />
                              )}
                            </button>
                          ))}
                        </>
                      )}

                      {publicAgents.length > 0 && (
                        <>
                          <div style={styles.groupHeader}>Public resources</div>
                          {publicAgents.map((a) => (
                            <button
                              key={a._id}
                              type="button"
                              style={{
                                ...styles.item,
                                ...(selectedAgentId === a._id ? styles.itemSelected : {}),
                              }}
                              onClick={() => setSelectedAgentId(a._id)}
                            >
                              <span style={styles.itemName}>{a.name}</span>
                              <span style={styles.badge}>Public</span>
                              {selectedAgentId === a._id && (
                                <i className="fa-solid fa-circle-check" style={styles.check} />
                              )}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {bindingType === 'category' && (
                <div style={styles.section}>
                  <label style={styles.label}>
                    <i className="fa-solid fa-folder-open" /> Select a category
                  </label>

                  {isLoadingCategories ? (
                    <div style={styles.loadingInline}>
                      <i className="fa-solid fa-spinner fa-spin" />
                      <span>Loading categories…</span>
                    </div>
                  ) : categories.length === 0 ? (
                    <div style={styles.empty}>
                      <span>No categories found for this course.</span>
                    </div>
                  ) : (
                    <div style={styles.list}>
                      {categories.map((cat) => (
                        <button
                          key={cat._id}
                          type="button"
                          style={{
                            ...styles.item,
                            ...(selectedCategoryId === cat._id ? styles.itemSelected : {}),
                          }}
                          onClick={() => setSelectedCategoryId(cat._id)}
                        >
                          <span style={styles.itemName}>{cat.name}</span>
                          <span style={styles.itemDesc}>
                            {cat.agentCount} {cat.agentCount === 1 ? 'item' : 'items'}
                          </span>
                          {selectedCategoryId === cat._id && (
                            <i className="fa-solid fa-circle-check" style={styles.check} />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div style={styles.footer}>
                <button
                  style={{
                    ...styles.submitBtn,
                    ...(!canSubmit || isSubmitting ? styles.submitBtnDisabled : {}),
                  }}
                  disabled={!canSubmit || isSubmitting}
                  onClick={handleSubmit}
                >
                  {isSubmitting ? (
                    <i className="fa-solid fa-spinner fa-spin" />
                  ) : (
                    <i className="fa-solid fa-check" />
                  )}
                  Save &amp; Return to Moodle
                </button>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '32px 16px',
    background: '#f9fafb',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  card: {
    width: '100%',
    maxWidth: 680,
    background: '#fff',
    borderRadius: 16,
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
    border: '1px solid #e5e7eb',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '24px 28px',
    background: 'linear-gradient(135deg, #6dbc2f 0%, #5aa025 100%)',
    color: '#fff',
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    background: 'rgba(255,255,255,0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.1rem',
  },
  title: { margin: 0, fontSize: '1.2rem', fontWeight: 700 },
  subtitle: { margin: '4px 0 0', fontSize: '0.82rem', opacity: 0.85 },
  errorBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 28px',
    background: '#fef2f2',
    color: '#dc2626',
    fontSize: '0.88rem',
    borderBottom: '1px solid #fecaca',
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '56px 28px',
    color: '#9ca3af',
    fontSize: '0.95rem',
  },
  loadingInline: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '28px 0',
    color: '#9ca3af',
    fontSize: '0.95rem',
  },
  section: { padding: '18px 28px', borderBottom: '1px solid #f3f4f6' },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontWeight: 600,
    fontSize: '0.9rem',
    marginBottom: 8,
    color: '#374151',
  },
  select: {
    width: '100%',
    padding: '10px 14px',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    fontSize: '0.9rem',
    background: '#fff',
  },
  hint: { margin: '6px 0 0', fontSize: '0.78rem', color: '#9ca3af' },
  toggle: { display: 'flex', background: '#f3f4f6', borderRadius: 12, padding: 3, gap: 3 },
  toggleBtn: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '10px 16px',
    border: 'none',
    borderRadius: 8,
    background: 'transparent',
    color: '#6b7280',
    fontSize: '0.88rem',
    fontWeight: 500,
    cursor: 'pointer',
  },
  toggleBtnActive: { background: '#6dbc2f', color: '#fff', fontWeight: 600 },
  searchRow: { position: 'relative', marginBottom: 12 },
  searchIcon: {
    position: 'absolute',
    left: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#9ca3af',
    pointerEvents: 'none',
  },
  searchInput: {
    width: '100%',
    padding: '10px 12px 10px 36px',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    fontSize: '0.88rem',
    boxSizing: 'border-box',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    padding: '28px 0',
    color: '#9ca3af',
    fontSize: '0.88rem',
  },
  list: {
    maxHeight: 360,
    overflowY: 'auto',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
  },
  groupHeader: {
    padding: '8px 14px',
    fontSize: '0.75rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: '#9ca3af',
    background: '#f9fafb',
    borderBottom: '1px solid #f3f4f6',
    position: 'sticky',
    top: 0,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    padding: '12px 14px',
    border: 'none',
    borderBottom: '1px solid #f3f4f6',
    background: '#fff',
    cursor: 'pointer',
    textAlign: 'left',
  },
  itemSelected: {
    background: 'rgba(109,188,47,0.05)',
    borderLeft: '3px solid #6dbc2f',
  },
  itemName: { flex: 1, fontWeight: 600, fontSize: '0.9rem', color: '#1f2937' },
  itemDesc: { fontSize: '0.78rem', color: '#9ca3af' },
  badge: {
    fontSize: '0.7rem',
    fontWeight: 600,
    padding: '3px 8px',
    borderRadius: 100,
    background: '#eff6ff',
    color: '#2563eb',
  },
  check: { color: '#6dbc2f', fontSize: '1.15rem' },
  footer: { padding: '16px 28px 24px', borderTop: '1px solid #f3f4f6' },
  submitBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '12px 28px',
    background: '#6dbc2f',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: '0.92rem',
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%',
  },
  submitBtnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
};

export default LtiDeepLink;
