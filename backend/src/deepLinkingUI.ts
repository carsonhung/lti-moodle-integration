/**
 * Deep Linking Selection UI Template
 *
 * Renders the HTML page shown during LTI Deep Linking, where the teacher
 * selects a course and resource (e.g. agent) to bind to a Moodle activity.
 *
 * This template is parameterized for portability — the caller supplies the
 * page title, resource label (e.g. "Agent", "Bot"), course lists, and
 * optional pre-selection state. All user-supplied strings are HTML-escaped.
 */

import { escapeHtml } from './helpers';

export function renderDeepLinkPage(params: {
  title: string;
  resourceLabel: string;
  email?: string;
  frontendBaseUrl?: string;
  popupMode?: boolean;
  courses: Array<{
    _id: string;
    course_id?: string;
    name: string;
    code: string;
    semester: string;
    year: string;
    section?: string;
  }>;
  suggestedCourses?: Array<{
    _id: string;
    course_id?: string;
    name: string;
    code: string;
    semester: string;
    year: string;
    section?: string;
  }>;
  preselectedCourseId?: string;
  error?: string;
}): string {
  const {
    title,
    resourceLabel,
    email,
    frontendBaseUrl,
    popupMode,
    courses,
    suggestedCourses,
    preselectedCourseId,
    error,
  } = params;
  const safeFrontendBase = String(frontendBaseUrl ?? '')
    .trim()
    .replace(/\/+$/g, '');
  const myCourseIds = new Set(courses.map((c) => String(c._id)));

  const safeLabel = escapeHtml(resourceLabel);
  const safeLabelLower = escapeHtml(resourceLabel.toLowerCase());
  const jsLabel = JSON.stringify(resourceLabel);
  const jsLabelLower = JSON.stringify(resourceLabel.toLowerCase());
  const article = /^[aeiou]/i.test(resourceLabel) ? 'an' : 'a';

  const myCourseOptions = courses
    .map((c) => {
      const cid = String((c as any)?.course_id ?? '').trim();
      const label = `${c.code} ${c.semester} ${c.section ?? ''} ${c.year} — ${c.name}`
        .replace(/\s+/g, ' ')
        .trim();
      const selected =
        preselectedCourseId && preselectedCourseId === String(c._id) ? ' selected' : '';
      return `<option value="${escapeHtml(String(c._id))}"${selected}>${escapeHtml(
        cid ? `[${cid}] ${label}` : label
      )}</option>`;
    })
    .join('\n');

  const suggested = Array.isArray(suggestedCourses) ? suggestedCourses : [];
  const suggestedFiltered = suggested.filter((c) => !myCourseIds.has(String(c._id)));
  const suggestedCourseOptions = suggestedFiltered
    .map((c) => {
      const cid = String((c as any)?.course_id ?? '').trim();
      const label = `${cid ? `[${cid}] ` : ''}${c.code} ${c.semester} ${c.section ?? ''} ${
        c.year
      } — ${c.name}`
        .replace(/\s+/g, ' ')
        .trim();
      const selected =
        preselectedCourseId && preselectedCourseId === String(c._id) ? ' selected' : '';
      return `<option value="${escapeHtml(String(c._id))}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join('\n');

  const courseOptions = suggestedCourseOptions
    ? `<optgroup label="My courses">${myCourseOptions}</optgroup>
<optgroup label="Suggested matches">${suggestedCourseOptions}</optgroup>`
    : myCourseOptions;

  const suggestedHintHtml = suggestedCourseOptions
    ? `<div class="muted" style="margin-top:6px;">Suggested matches are based on Moodle course identifiers. Selecting one will attach you to that course and map this Moodle course.</div>`
    : '';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 24px; color: #0f172a; }
      .card { max-width: 920px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; }
      h1 { margin: 0 0 10px; font-size: 18px; }
      p { margin: 8px 0; color: #334155; }
      .row { display: grid; grid-template-columns: 1fr; gap: 12px; margin-top: 14px; }
      label { font-weight: 600; font-size: 13px; }
      select, input { width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 14px; }
      .btn { display: inline-block; border: 0; background: #0ea5e9; color: #fff; padding: 10px 14px; border-radius: 10px; font-weight: 700; cursor: pointer; }
      .btn:disabled { opacity: 0.6; cursor: not-allowed; }
      .btn-secondary { background: #0f172a; }
      .muted { color: #64748b; font-size: 12px; }
      .error { background: #fff1f2; border: 1px solid #fecdd3; color: #9f1239; padding: 10px 12px; border-radius: 10px; }
      .grid2 { display: grid; grid-template-columns: 1fr; gap: 12px; }
      @media (min-width: 740px) { .grid2 { grid-template-columns: 1fr 1fr; } }
      .hr { height: 1px; background: #e2e8f0; margin: 14px 0; }
      .diag {
        margin-top: 12px;
        padding: 10px 12px;
        border: 1px dashed #cbd5e1;
        border-radius: 10px;
        background: #f8fafc;
        font-size: 12px;
        color: #334155;
        white-space: pre-wrap;
        display: none;
      }
      .diag.visible { display: block; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${escapeHtml(title)}</h1>
      ${email ? `<p class="muted">Signed in via Moodle as <strong>${escapeHtml(email)}</strong></p>` : ''}
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}

      <div class="row">
        <div class="grid2">
          <div>
            <label for="courseId">Course</label>
            <select id="courseId">
              <option value="">Select a course…</option>
              ${courseOptions}
            </select>
            <div class="muted">This maps the Moodle course to a course for student visibility.</div>
            ${suggestedHintHtml}
          </div>
          <div>
            <label for="agentId">${safeLabel}</label>
            <select id="agentId" disabled>
              <option value="">Select a course first…</option>
            </select>
            <div class="muted">Course ${safeLabelLower}s are already attached to this course. Public ${safeLabelLower}s are available system-wide. We'll attach the selected ${safeLabelLower} to the course so students can access it.</div>
            <label for="publicAgentQuery" style="margin-top:10px; display:block;">Search public ${safeLabelLower}s (optional)</label>
            <input id="publicAgentQuery" type="text" placeholder="Type at least 2 characters…" disabled />
            <div class="muted">Public ${safeLabelLower}s can be many — we only show public matches when you search.</div>
          </div>
        </div>

        <form id="submitForm" method="POST" action="./submit">
          <input type="hidden" name="courseId" id="courseIdHidden" />
          <input type="hidden" name="agentId" id="agentIdHidden" />
          <button class="btn" id="submitBtn" type="submit" disabled>${popupMode ? 'Save &amp; Close' : 'Save &amp; Return to Moodle'}</button>
        </form>
      </div>
    </div>

    <script>
      (function () {
        var RL = ${jsLabel};
        var RLL = ${jsLabelLower};
        var ARTICLE = '${article}';
        const qs = new URLSearchParams(window.location.search);
        const ltik = qs.get('ltik') || '';
        const createdAgentId = qs.get('createdAgentId') || '';
        const debugMode = qs.get('debug') === '1';
        const frontendBase = ${JSON.stringify(safeFrontendBase)};

        const courseId = document.getElementById('courseId');
        const agentId = document.getElementById('agentId');
        const publicAgentQuery = document.getElementById('publicAgentQuery');
        const submitBtn = document.getElementById('submitBtn');
        const submitForm = document.getElementById('submitForm');
        var diagEl = null;

        const courseIdHidden = document.getElementById('courseIdHidden');
        const agentIdHidden = document.getElementById('agentIdHidden');
        const pathBase = window.location.pathname.endsWith('/popup')
          ? window.location.pathname.slice(0, -6)
          : window.location.pathname;
        const submitBase = pathBase + '/submit';
        const diagBase = pathBase + '/diag';

        function diag(msg, data) {
          if (!debugMode) return;
          var line = '[LTI-DIAG] ' + msg;
          if (typeof data !== 'undefined') {
            try {
              line += ' ' + JSON.stringify(data);
            } catch (e) {
              line += ' (unserializable)';
            }
          }
          try { console.info(line); } catch (e) { /* ignore */ }
          if (!diagEl) {
            diagEl = document.createElement('div');
            diagEl.className = 'diag visible';
            var card = document.querySelector('.card');
            if (card) card.appendChild(diagEl);
          }
          if (diagEl) {
            diagEl.textContent += (diagEl.textContent ? '\\n' : '') + line;
          }
          try {
            var diagUrl = diagBase + (ltik ? ('?ltik=' + encodeURIComponent(ltik)) : '');
            fetch(diagUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event: msg,
                data: typeof data === 'undefined' ? null : data,
                href: window.location.href,
                top: window === window.top,
                ts: Date.now(),
              }),
              keepalive: true,
            }).catch(function () {
              // ignore diagnostics transport errors
            });
          } catch (e) {
            // ignore diagnostics transport errors
          }
        }

        function setSubmitEnabled(enabled) {
          submitBtn.disabled = !enabled;
        }

        function syncHidden() {
          courseIdHidden.value = courseId.value;
          agentIdHidden.value = agentId.value;
        }

        function updateUi() {
          const hasCourse = !!courseId.value;
          const hasAgent = !!agentId.value;
          setSubmitEnabled(hasCourse && hasAgent);
          if (publicAgentQuery) publicAgentQuery.disabled = !hasCourse;
        }

        async function loadAgents() {
          const cId = courseId.value;
          const q = publicAgentQuery ? String(publicAgentQuery.value || '').trim() : '';
          agentId.innerHTML = '<option value="">Loading ' + RLL + 's…</option>';
          agentId.disabled = true;
          setSubmitEnabled(false);
          if (!cId) return;
          try {
            const params = new URLSearchParams();
            if (ltik) params.set('ltik', ltik);
            if (q && q.length >= 2) params.set('q', q);
            const url =
              pathBase +
              '/course/' +
              encodeURIComponent(cId) +
              '/agents' +
              (params.toString() ? '?' + params.toString() : '');
            const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (!res.ok) throw new Error('Failed to load ' + RLL + 's');
            const data = await res.json();
            const agents = Array.isArray(data.agents) ? data.agents : [];
            const hasSource = agents.some(a => a && typeof a.source === 'string' && a.source);
            function opt(a) {
              return '<option value="' + String(a._id).replace(/"/g, '&quot;') + '">' + String(a.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</option>';
            }
            if (hasSource) {
              const groups = { course: [], public: [], other: [] };
              for (const a of agents) {
                const src = String((a && a.source) || 'other');
                if (src === 'course') groups.course.push(a);
                else if (src === 'public') groups.public.push(a);
                else groups.other.push(a);
              }
              let html = '<option value="">Select ' + ARTICLE + ' ' + RLL + '…</option>';
              if (groups.course.length) html += '<optgroup label="Course ' + RLL + 's">' + groups.course.map(opt).join('') + '</optgroup>';
              if (groups.public.length) {
                html += '<optgroup label="Public ' + RLL + 's">' + groups.public.map(opt).join('') + '</optgroup>';
              } else {
                const msg = (q && q.length >= 2) ? 'No public matches' : 'Type in the search box to find public ' + RLL + 's…';
                html += '<optgroup label="Public ' + RLL + 's"><option value="" disabled>' + msg.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</option></optgroup>';
              }
              if (groups.other.length) html += '<optgroup label="Other">' + groups.other.map(opt).join('') + '</optgroup>';
              agentId.innerHTML = html;
            } else {
              agentId.innerHTML = '<option value="">Select ' + ARTICLE + ' ' + RLL + '…</option>' + agents.map(opt).join('');
            }
            agentId.disabled = false;
            if (createdAgentId) {
              try {
                const match = agents.find(a => String(a._id) === String(createdAgentId));
                if (match) {
                  agentId.value = String(createdAgentId);
                }
              } catch (e) {
                // ignore
              }
            }
            updateUi();
            syncHidden();
          } catch (e) {
            agentId.innerHTML = '<option value="">Error loading ' + RLL + 's</option>';
            agentId.disabled = true;
            setSubmitEnabled(false);
          }
        }

        courseId.addEventListener('change', () => { syncHidden(); updateUi(); loadAgents(); });
        agentId.addEventListener('change', () => { syncHidden(); updateUi(); });
        if (publicAgentQuery) {
          let t = null;
          publicAgentQuery.addEventListener('input', () => {
            if (t) clearTimeout(t);
            t = setTimeout(() => {
              loadAgents();
            }, 250);
          });
        }

        var POPUP_MODE = ${popupMode ? 'true' : 'false'};

        if (submitForm && ltik) {
          try {
            const url = new URL(submitBase, window.location.origin);
            url.searchParams.set('ltik', ltik);
            submitForm.action = url.toString();
          } catch (e) {
            // ignore
          }
        }

        diag('page context', {
          href: window.location.href,
          referrer: document.referrer || '(none)',
          top: window === window.top,
          parent: window !== window.parent,
          hasLtik: !!ltik,
          popupMode: POPUP_MODE,
          submitAction: submitForm && submitForm.action ? submitForm.action : '(none)',
        });

        window.addEventListener('error', function (event) {
          diag('window error', {
            message: event.message || '(none)',
            filename: event.filename || '(none)',
            lineno: event.lineno || 0,
            colno: event.colno || 0,
          });
        });

        window.addEventListener('unhandledrejection', function (event) {
          var reason = event && event.reason;
          diag('unhandled rejection', {
            reason: reason && reason.message ? reason.message : String(reason),
          });
        });

        if (POPUP_MODE) {
          submitForm.addEventListener('submit', function (e) {
            e.preventDefault();
            syncHidden();
            if (!courseIdHidden.value || !agentIdHidden.value) return;
            if (window.opener) {
              window.opener.postMessage({
                type: 'lti-deeplink-selected',
                courseId: courseIdHidden.value,
                agentId: agentIdHidden.value,
              }, '*');
              submitBtn.disabled = true;
              submitBtn.textContent = 'Saved — closing…';
              setTimeout(function () { window.close(); }, 600);
            } else {
              submitForm.submit();
            }
          });
        } else {
          // Inline mode: fetch the signed JWT from our server via AJAX, then
          // submit a regular POST form in this iframe to Moodle's return URL.
          submitForm.addEventListener('submit', function (e) {
            e.preventDefault();
            syncHidden();
            if (!courseIdHidden.value || !agentIdHidden.value) return;

            submitBtn.disabled = true;
            submitBtn.textContent = 'Saving…';

            var fetchUrl = submitForm.action;
            if (fetchUrl.indexOf('?') !== -1) {
              fetchUrl += '&format=json';
            } else {
              fetchUrl += '?format=json';
            }
            diag('submit clicked', {
              submitAction: submitForm.action,
              fetchUrl: fetchUrl,
              courseId: courseIdHidden.value,
              agentId: agentIdHidden.value,
            });

            fetch(fetchUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                courseId: courseIdHidden.value,
                agentId: agentIdHidden.value,
              }),
            })
              .then(function (r) {
                if (!r.ok) {
                  return r.json().then(function (d) { throw new Error(d.error || 'Server error'); });
                }
                return r.json();
              })
              .then(function (data) {
                if (!data.jwt || !data.returnUrl) {
                  throw new Error('Missing jwt or returnUrl in response');
                }
                // Moodle contentitem_return.php reads JWT via optional_param(),
                // so query-string JWT works too. Use iframe GET navigation to
                // avoid blocked cross-origin form POST in some Chrome contexts.
                var separator = data.returnUrl.indexOf('?') >= 0 ? '&' : '?';
                var returnGetUrl = data.returnUrl + separator + 'JWT=' + encodeURIComponent(data.jwt);
                diag('navigating iframe to Moodle return URL (GET)', {
                  returnUrl: data.returnUrl,
                  returnGetUrl: returnGetUrl,
                  top: window === window.top,
                });
                try {
                  window.location.assign(returnGetUrl);
                } catch (navErr) {
                  diag('window.location.assign threw', {
                    message: navErr && navErr.message ? navErr.message : String(navErr),
                  });
                  throw navErr;
                }
              })
              .catch(function (err) {
                diag('submit failed', {
                  message: err && err.message ? err.message : String(err),
                });
                submitBtn.disabled = false;
                submitBtn.textContent = 'Save & Return to Moodle';
                alert('Error saving configuration: ' + (err.message || 'Unknown error'));
              });
          });
        }
        syncHidden();
        updateUi();
        if (courseId.value) loadAgents();
      })();
    </script>
  </body>
</html>`;
}

/**
 * Renders the teacher management page shown on normal LTI launch.
 * Displays the current course/agent or course/category binding with a unified
 * summary card and allows reconfiguration or student-view preview.
 */
export function renderTeacherManagePage(params: {
  title: string;
  resourceLabel: string;
  email?: string;
  courseName?: string;
  agentName?: string;
  configured: boolean;
  deepLinkUrl: string;
  previewUrl?: string;
  updateUrl: string;
  success?: boolean;
  bindingType?: string;
  agentCount?: number;
}): string {
  const {
    title,
    resourceLabel,
    email,
    courseName,
    agentName,
    configured,
    deepLinkUrl,
    previewUrl,
    updateUrl,
    success,
    bindingType = 'agent',
    agentCount,
  } = params;

  const safeTitle = escapeHtml(title.replace('Configure', 'Manage'));
  const isCategory = bindingType === 'category';
  const safeLabelLower = escapeHtml(isCategory ? 'category' : resourceLabel.toLowerCase());
  const safeCourseName = escapeHtml(courseName || 'Unknown');
  const safeAgentName = escapeHtml(agentName || 'Unknown');
  const jsDeepLinkUrl = JSON.stringify(deepLinkUrl);

  const agentIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 004.5 8.25v9a2.25 2.25 0 002.25 2.25z" /><circle cx="9.75" cy="11.25" r="1" /><circle cx="14.25" cy="11.25" r="1" /><path stroke-linecap="round" d="M9.75 15h4.5" /></svg>`;
  const categoryIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>`;

  const typeIcon = isCategory ? categoryIcon : agentIcon;
  const typeLabel = isCategory ? 'Agent Category' : 'Single Agent';
  const typeAccent = isCategory ? '#7c3aed' : '#0ea5e9';

  const agentCountStr =
    isCategory && typeof agentCount === 'number' && agentCount > 0
      ? `${agentCount} agent${agentCount !== 1 ? 's' : ''}`
      : '';

  const categoryHint =
    isCategory && configured
      ? `<div class="student-hint">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128H5.228A2.25 2.25 0 013 16.878V15c0-1.134.46-2.16 1.202-2.854C5.1 11.403 6.46 10.875 8 10.875c1.14 0 2.187.324 3.078.875M15 19.128c-.046-.138-.098-.275-.155-.41M12.828 11.75A3.375 3.375 0 109.953 5.374a3.375 3.375 0 002.875 6.376z" /></svg>
          Students will choose from ${agentCountStr || 'the agents in'} this category when they launch.
        </div>`
      : '';

  const configuredSection = configured
    ? `
      <div class="config-section">
        <div class="status-badge configured">Configured</div>
        <div class="binding-summary" style="border-color: ${typeAccent}20;">
          <div class="binding-header">
            <div class="binding-icon" style="background: ${typeAccent}12; color: ${typeAccent};">${typeIcon}</div>
            <div>
              <div class="binding-type" style="color: ${typeAccent};">${typeLabel}</div>
              ${agentCountStr ? `<div class="binding-meta">${agentCountStr} available</div>` : ''}
            </div>
          </div>
          <div class="binding-rows">
            <div class="binding-row">
              <span class="binding-label">Course</span>
              <span class="binding-value">${safeCourseName}</span>
            </div>
            <div class="binding-row">
              <span class="binding-label">${isCategory ? 'Category' : escapeHtml(resourceLabel)}</span>
              <span class="binding-value">${safeAgentName}</span>
            </div>
          </div>
          ${categoryHint}
        </div>
      </div>`
    : `
      <div class="config-section">
        <div class="status-badge not-configured">Not Configured</div>
        <p class="hint">This activity is not linked to ${
          /^[aeiou]/i.test(resourceLabel) ? 'an' : 'a'
        } ${safeLabelLower} yet. Click <strong>Configure</strong> to select a course and ${safeLabelLower}.</p>
      </div>`;

  const previewBtn =
    configured && previewUrl
      ? `<a class="btn btn-preview" href="${escapeHtml(previewUrl)}" target="_blank">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" width="15" height="15" style="margin-right:6px;"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          Preview as Student
        </a>`
      : '';

  const successBanner = success
    ? `<div class="banner success">Configuration updated successfully.</div>`
    : '';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        background: #f8fafc; color: #0f172a;
        display: flex; align-items: center; justify-content: center;
        min-height: 100vh; padding: 24px;
      }
      .card {
        max-width: 560px; width: 100%;
        background: #fff; border: 1px solid #e2e8f0;
        border-radius: 16px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);
      }
      h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
      .muted { color: #64748b; font-size: 13px; }
      .muted strong { color: #334155; }
      .hr { height: 1px; background: #e2e8f0; margin: 20px 0; }
      .config-section { margin-top: 8px; }
      .status-badge {
        display: inline-block; padding: 4px 12px; border-radius: 20px;
        font-size: 12px; font-weight: 600; letter-spacing: 0.02em; margin-bottom: 16px;
      }
      .status-badge.configured { background: #dcfce7; color: #166534; }
      .status-badge.not-configured { background: #fef3c7; color: #92400e; }
      .binding-summary {
        background: #f8fafc; border: 1px solid #e2e8f0;
        border-radius: 12px; padding: 20px; border-left: 3px solid;
      }
      .binding-header {
        display: flex; align-items: center; gap: 12px; margin-bottom: 16px;
      }
      .binding-icon {
        width: 40px; height: 40px; border-radius: 10px;
        display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      }
      .binding-icon svg { width: 22px; height: 22px; }
      .binding-type { font-size: 15px; font-weight: 700; }
      .binding-meta { font-size: 12px; color: #64748b; margin-top: 1px; }
      .binding-rows { display: flex; flex-direction: column; gap: 8px; }
      .binding-row {
        display: flex; align-items: baseline; gap: 12px;
      }
      .binding-label {
        font-size: 11px; font-weight: 600; color: #64748b;
        text-transform: uppercase; letter-spacing: 0.05em;
        min-width: 72px; flex-shrink: 0;
      }
      .binding-value {
        font-size: 14px; font-weight: 500; color: #0f172a; word-break: break-word;
      }
      .student-hint {
        display: flex; align-items: flex-start; gap: 8px;
        margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;
        font-size: 13px; color: #64748b; line-height: 1.4; font-style: italic;
      }
      .student-hint svg { flex-shrink: 0; margin-top: 1px; color: #94a3b8; }
      .hint { color: #475569; font-size: 14px; line-height: 1.5; }
      .hint strong { color: #0f172a; }
      .actions { display: flex; gap: 12px; margin-top: 24px; flex-wrap: wrap; }
      .btn {
        display: inline-flex; align-items: center; justify-content: center;
        border: 0; padding: 11px 22px; border-radius: 10px;
        font-size: 14px; font-weight: 600; cursor: pointer;
        text-decoration: none; transition: background 0.15s, opacity 0.15s;
      }
      .btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .btn-configure { background: #0f172a; color: #fff; }
      .btn-configure:hover { background: #1e293b; }
      .btn-preview {
        background: #fff; color: #334155;
        border: 1.5px solid #cbd5e1;
      }
      .btn-preview:hover { background: #f1f5f9; border-color: #94a3b8; }
      .banner {
        padding: 10px 14px; border-radius: 10px; font-size: 13px; font-weight: 500;
        margin-bottom: 16px;
      }
      .banner.success { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
      .banner.error { background: #fff1f2; color: #9f1239; border: 1px solid #fecdd3; }
      .status-msg { margin-top: 16px; font-size: 13px; color: #64748b; min-height: 20px; }
      .spinner {
        display: inline-block; width: 14px; height: 14px;
        border: 2px solid #cbd5e1; border-top-color: #0ea5e9;
        border-radius: 50%; animation: spin 0.6s linear infinite;
        vertical-align: middle; margin-right: 6px;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${safeTitle}</h1>
      ${email ? `<p class="muted">Signed in via Moodle as <strong>${escapeHtml(email)}</strong></p>` : ''}

      <div class="hr"></div>
      ${successBanner}
      ${configuredSection}

      <div class="actions">
        <button class="btn btn-configure" id="configureBtn">${configured ? 'Reconfigure' : 'Configure'}</button>
        ${previewBtn}
      </div>
      <div class="status-msg" id="statusMsg"></div>
    </div>

    <script>
      (function () {
        var configureBtn = document.getElementById('configureBtn');
        configureBtn.addEventListener('click', function () {
          window.location.href = ${jsDeepLinkUrl};
        });
      })();
    </script>
  </body>
</html>`;
}

/**
 * Renders a minimal launcher page shown inside the Moodle "Select content" iframe.
 * Instead of the full configuration UI, it displays a button that opens the
 * configuration in a new browser window (popup). When the teacher saves in the
 * popup, the selection is sent back to this iframe via postMessage, and the
 * iframe submits the deep link response form to Moodle.
 */
export function renderDeepLinkLauncher(params: {
  title: string;
  deepLinkUrl: string;
  submitUrl: string;
}): string {
  const { title, deepLinkUrl, submitUrl } = params;
  const safeTitle = escapeHtml(title);
  const safeSubmitUrl = escapeHtml(submitUrl);
  // JSON.stringify for values embedded in <script> — escapeHtml would break & in URLs
  const jsDeepLinkUrl = JSON.stringify(deepLinkUrl);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        display: flex; align-items: center; justify-content: center;
        min-height: 100vh; background: #f8fafc; color: #0f172a;
      }
      .launcher {
        text-align: center; padding: 40px 32px;
        max-width: 480px; width: 100%;
      }
      .icon {
        width: 56px; height: 56px; margin: 0 auto 20px;
        background: #e0f2fe; border-radius: 14px;
        display: flex; align-items: center; justify-content: center;
      }
      .icon svg { width: 28px; height: 28px; color: #0284c7; }
      h1 { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
      p { font-size: 14px; color: #475569; margin-bottom: 24px; line-height: 1.5; }
      .btn {
        display: inline-block; border: 0; background: #0ea5e9; color: #fff;
        padding: 12px 28px; border-radius: 10px; font-size: 15px;
        font-weight: 700; cursor: pointer; text-decoration: none;
        transition: background 0.15s;
      }
      .btn:hover { background: #0284c7; }
      .btn:disabled { opacity: 0.6; cursor: not-allowed; }
      .status {
        margin-top: 20px; font-size: 13px; color: #64748b;
        min-height: 20px;
      }
      .status.success { color: #059669; font-weight: 600; }
      .status.error { color: #dc2626; }
      .spinner {
        display: inline-block; width: 16px; height: 16px;
        border: 2px solid #cbd5e1; border-top-color: #0ea5e9;
        border-radius: 50%; animation: spin 0.6s linear infinite;
        vertical-align: middle; margin-right: 6px;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <div class="launcher">
      <div class="icon">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
        </svg>
      </div>
      <h1>${safeTitle}</h1>
      <p>Click the button below to open the configuration window. Select a course and agent, then save to link this activity.</p>
      <button class="btn" id="openBtn">Open Configuration</button>
      <div class="status" id="status"></div>
    </div>

    <form id="submitForm" method="POST" action="${safeSubmitUrl}" style="display:none;">
      <input type="hidden" name="courseId" id="courseIdHidden" />
      <input type="hidden" name="agentId" id="agentIdHidden" />
    </form>

    <script>
      (function () {
        var openBtn = document.getElementById('openBtn');
        var status = document.getElementById('status');
        var submitForm = document.getElementById('submitForm');
        var courseIdHidden = document.getElementById('courseIdHidden');
        var agentIdHidden = document.getElementById('agentIdHidden');
        var popup = null;

        openBtn.addEventListener('click', function () {
          var w = Math.min(800, screen.availWidth - 100);
          var h = Math.min(700, screen.availHeight - 100);
          var left = Math.round((screen.availWidth - w) / 2);
          var top = Math.round((screen.availHeight - h) / 2);
          popup = window.open(
            ${jsDeepLinkUrl},
            'lti_deeplink_config',
            'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=yes'
          );
          if (popup) {
            status.className = 'status';
            status.textContent = 'Configuration window opened — waiting for your selection…';
            openBtn.textContent = 'Window Open…';
            openBtn.disabled = true;
          } else {
            status.className = 'status error';
            status.textContent = 'Pop-up blocked. Please allow pop-ups for this site and try again.';
          }
        });

        // Check if popup was closed without sending a message
        var pollClosed = setInterval(function () {
          if (popup && popup.closed) {
            clearInterval(pollClosed);
            if (!courseIdHidden.value) {
              openBtn.textContent = 'Open Configuration';
              openBtn.disabled = false;
              status.className = 'status';
              status.textContent = 'Window closed. Click the button to try again.';
            }
          }
        }, 500);

        window.addEventListener('message', function (e) {
          if (!e.data || e.data.type !== 'lti-deeplink-selected') return;
          var courseId = String(e.data.courseId || '').trim();
          var agentId = String(e.data.agentId || '').trim();
          if (!courseId || !agentId) return;

          courseIdHidden.value = courseId;
          agentIdHidden.value = agentId;

          status.innerHTML = '<span class="spinner"></span> Saving configuration to Moodle…';
          status.className = 'status';
          openBtn.disabled = true;

          submitForm.submit();
        });
      })();
    </script>
  </body>
</html>`;
}
