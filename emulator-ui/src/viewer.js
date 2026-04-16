// ─── Firestore Dev Viewer ─────────────────────────────────────────────────────
// Uses the Firestore emulator REST API directly (no Firebase SDK, no auth).
// The emulator REST API bypasses security rules completely — this is intentional
// and correct for a local-only dev tool. Production rules are NOT affected.
//
// REST base:  http://localhost:8080/v1/projects/{projectId}/databases/(default)/documents
// Docs: https://firebase.google.com/docs/emulator-suite/connect_firestore

const EMULATOR_HOST = 'http://localhost:8080';
const PROJECT_ID = 'demo-project'; // must match --project flag / .firebaserc
const REST_BASE = `${EMULATOR_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ─── Collections to show as pinned tabs ──────────────────────────────────────
const PINNED_COLLECTIONS = [
  'users',
  'pending_invites',
  'records',
  'app_settings',
];

// ─── State ────────────────────────────────────────────────────────────────────
let activeTab = PINNED_COLLECTIONS[0];
let collectionData = {}; // { name: { docs: [], columns: [] } }
let filter = '';
let sortCol = null;
let sortDir = 'asc';

const root = document.getElementById('viewer-app');

// ─── REST helpers ─────────────────────────────────────────────────────────────

/**
 * Fetch all documents from a top-level collection via emulator REST API.
 * Automatically follows `nextPageToken` to retrieve all pages.
 */
async function restListCollection(name) {
  const docs = [];
  let pageToken = null;

  do {
    const url = new URL(`${REST_BASE}/${name}`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    // 'Bearer owner' is the Firestore emulator's special bypass token.
    // It skips all security rules and is only honoured by the local emulator.
    const res = await fetch(url.toString(), {
      headers: { Authorization: 'Bearer owner' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for collection "${name}"`);
    const json = await res.json();

    for (const rawDoc of json.documents || []) {
      const id = rawDoc.name.split('/').pop();
      const fields = parseFields(rawDoc.fields || {});
      docs.push({ __id__: id, ...flattenDoc(fields) });
    }

    pageToken = json.nextPageToken || null;
  } while (pageToken);

  return docs;
}

// ─── Firestore value parser ───────────────────────────────────────────────────
// Converts Firestore REST typed values → plain JS values.

function parseFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = parseValue(v);
  }
  return out;
}

function parseValue(v) {
  if ('nullValue'      in v) return null;
  if ('booleanValue'   in v) return v.booleanValue;
  if ('integerValue'   in v) return Number(v.integerValue);
  if ('doubleValue'    in v) return v.doubleValue;
  if ('stringValue'    in v) return v.stringValue;
  if ('bytesValue'     in v) return '[bytes]';
  if ('referenceValue' in v) return v.referenceValue.split('/').pop();
  if ('timestampValue' in v) return new Date(v.timestampValue).toLocaleString();
  if ('geoPointValue'  in v) return `(${v.geoPointValue.latitude ?? 0}, ${v.geoPointValue.longitude ?? 0})`;
  if ('arrayValue'     in v) return (v.arrayValue.values || []).map(parseValue);
  if ('mapValue'       in v) return parseFields(v.mapValue.fields || {});
  return JSON.stringify(v);
}

// ─── Flatten nested maps one level for column display ─────────────────────────
function flattenDoc(data, prefix = '') {
  const result = {};
  for (const [k, v] of Object.entries(data)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(result, flattenDoc(v, key));
    } else {
      result[key] = v;
    }
  }
  return result;
}

function deriveColumns(docs) {
  const cols = new Set();
  for (const doc of docs) {
    for (const k of Object.keys(doc)) {
      if (k !== '__id__') cols.add(k);
    }
  }
  return Array.from(cols);
}

function formatValue(val) {
  if (val === null || val === undefined) return '';
  if (Array.isArray(val)) return JSON.stringify(val);
  if (typeof val === 'object') return JSON.stringify(val);
  if (typeof val === 'boolean') return String(val);
  return String(val);
}

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadCollection(name) {
  try {
    const docs = await restListCollection(name);
    collectionData[name] = { docs, columns: deriveColumns(docs) };
  } catch (err) {
    console.error(`Failed to load ${name}:`, err);
    collectionData[name] = { docs: [], columns: [], error: err.message };
  }
}

async function loadAll(collections) {
  const indicator = document.getElementById('loading-indicator');
  if (indicator) indicator.style.display = 'flex';
  await Promise.all(collections.map(loadCollection));
  renderTabs(collections);
  renderSheet();
  if (indicator) indicator.style.display = 'none';
}

// ─── Render shell ─────────────────────────────────────────────────────────────
function renderShell(collections) {
  root.innerHTML = `
    <div class="viewer">
      <header class="viewer-header">
        <span class="viewer-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg>
          Firestore Dev Viewer
        </span>
        <div class="viewer-header-actions">
          <input id="filter-input" class="filter-input" type="search" placeholder="Filter rows…" value="${escHtml(filter)}" />
          <button id="btn-refresh" class="btn-icon" title="Refresh all">↻</button>
          <span class="emulator-badge">Emulator · REST</span>
        </div>
      </header>

      <nav class="tab-bar" id="tab-bar"></nav>

      <div class="sheet-wrapper" id="sheet-wrapper">
        <div class="loading" id="loading-indicator" style="display:none">Loading…</div>
        <div id="sheet-content"></div>
      </div>

      <footer class="viewer-footer" id="viewer-footer"></footer>
    </div>
  `;

  document.getElementById('btn-refresh').addEventListener('click', () => loadAll(collections));
  document.getElementById('filter-input').addEventListener('input', (e) => {
    filter = e.target.value;
    renderSheet();
  });
}

function renderTabs(collections) {
  const bar = document.getElementById('tab-bar');
  if (!bar) return;

  bar.innerHTML = collections.map((c) => {
    const d = collectionData[c];
    const count = d ? `<span class="tab-count">${d.error ? '!' : d.docs.length}</span>` : '';
    return `<button class="tab ${c === activeTab ? 'tab--active' : ''}" data-collection="${escHtml(c)}">${escHtml(c)}${count}</button>`;
  }).join('') + `<button id="btn-add-collection" class="tab tab--add" title="Add collection">＋</button>`;

  bar.querySelectorAll('[data-collection]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.collection;
      sortCol = null;
      sortDir = 'asc';
      renderTabs(collections);
      renderSheet();
    });
  });

  document.getElementById('btn-add-collection').addEventListener('click', () => {
    const name = prompt('Collection name:')?.trim();
    if (name && !collections.includes(name)) {
      collections.push(name);
      activeTab = name;
      loadCollection(name).then(() => { renderTabs(collections); renderSheet(); });
    }
  });
}

// ─── Render sheet ─────────────────────────────────────────────────────────────
function renderSheet() {
  const content = document.getElementById('sheet-content');
  const footer  = document.getElementById('viewer-footer');
  if (!content) return;

  const data = collectionData[activeTab];
  if (!data) {
    content.innerHTML = `<div class="empty">Select a tab to load data.</div>`;
    return;
  }

  if (data.error) {
    content.innerHTML = `<div class="empty error-msg">Error: ${escHtml(data.error)}</div>`;
    return;
  }

  const { docs, columns } = data;

  const filterLower = filter.toLowerCase();
  const filtered = filterLower
    ? docs.filter((row) => Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(filterLower)))
    : docs;

  const sorted = sortCol
    ? [...filtered].sort((a, b) => {
        const av = String(a[sortCol] ?? '');
        const bv = String(b[sortCol] ?? '');
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      })
    : filtered;

  if (sorted.length === 0) {
    content.innerHTML = `<div class="empty">${filter ? 'No rows match filter.' : 'Collection is empty.'}</div>`;
    footer.textContent = '';
    return;
  }

  const allCols = ['__id__', ...columns];

  const thCells = allCols.map((col) => {
    const isSorted = sortCol === col;
    const arrow = isSorted ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th class="sheet-th${isSorted ? ' sorted' : ''}" data-col="${escHtml(col)}">${escHtml(col === '__id__' ? '# doc id' : col)}${arrow}</th>`;
  }).join('');

  const bodyRows = sorted.map((row) =>
    `<tr class="sheet-tr">${allCols.map((col) => {
      const val = row[col];
      return `<td class="sheet-td" title="${escHtml(String(val ?? ''))}">${escHtml(formatValue(val))}</td>`;
    }).join('')}</tr>`
  ).join('');

  content.innerHTML = `
    <div class="sheet-scroll">
      <table class="sheet-table">
        <thead><tr>${thCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;

  footer.textContent = `${sorted.length} of ${docs.length} document${docs.length !== 1 ? 's' : ''}`;

  content.querySelectorAll('.sheet-th').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      sortDir = sortCol === col && sortDir === 'asc' ? 'desc' : 'asc';
      sortCol = col;
      renderSheet();
    });
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
(async () => {
  const collections = [...PINNED_COLLECTIONS];
  renderShell(collections);
  await loadAll(collections);
})();

