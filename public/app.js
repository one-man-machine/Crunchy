/* ── Constants ───────────────────────────────────────────── */
const PAGE_SIZE  = 50;
const BATCH_SIZE = 100;
const MAX_TOTAL  = 500;

/* ── Storage keys ────────────────────────────────────────── */
const KEY_HIDDEN = 'cr_not_interested';
const KEY_SEEN   = 'cr_seen';
const KEY_AUTH   = 'cr_auth';   // { token, tokenType, accountId, anon }

/* ── Auth helpers ────────────────────────────────────────── */
function getAuth()       { try { return JSON.parse(sessionStorage.getItem(KEY_AUTH)) || null; } catch { return null; } }
function saveAuth(obj)   { sessionStorage.setItem(KEY_AUTH, JSON.stringify(obj)); }
function clearAuth()     { sessionStorage.removeItem(KEY_AUTH); }
function authHeader()    { const a = getAuth(); return a ? `${a.tokenType} ${a.token}` : null; }
function isLoggedIn()    { const a = getAuth(); return a && !a.anon; }

/* ── Storage helpers ─────────────────────────────────────── */
function getHidden() { try { return new Set(JSON.parse(localStorage.getItem(KEY_HIDDEN)) || []); } catch { return new Set(); } }
function saveHidden(s) { localStorage.setItem(KEY_HIDDEN, JSON.stringify([...s])); }
function addHidden(id) { const s = getHidden(); s.add(String(id)); saveHidden(s); }
function clearHidden() { localStorage.removeItem(KEY_HIDDEN); }

function getSeen()       { try { return JSON.parse(localStorage.getItem(KEY_SEEN)) || {}; } catch { return {}; } }
function saveSeen(obj)   { localStorage.setItem(KEY_SEEN, JSON.stringify(obj)); }
function markSeen(item)  {
  const seen = getSeen();
  const id   = String(seriesId(item));
  const panel = item.panel ?? item;
  seen[id] = { episodeCount: extractEpisodes(item) ?? 0, title: panel.title ?? item.title ?? '', imgSrc: midImage(panel.images) || midImage(item.images), slug: panel.slug_title ?? item.slug_title ?? '', seenAt: new Date().toISOString() };
  saveSeen(seen);
}
function removeSeen(id) { const s = getSeen(); delete s[String(id)]; saveSeen(s); }

/* ── State ───────────────────────────────────────────────── */
let allSeries      = [];
let filteredSeries = [];
let displayedCount = 0;
let apiOffset      = 0;
let apiFetching    = false;
let currentTab     = 'browse';
const ratingsCache = {};   // { [seriesId]: { average, total } }

/* ── DOM refs ────────────────────────────────────────────── */
const loginScreen    = document.getElementById('login-screen');
const browseScreen   = document.getElementById('browse-screen');
const loginForm      = document.getElementById('login-form');
const loginBtn       = document.getElementById('login-btn');
const loginLabel     = document.getElementById('login-label');
const loginSpinner   = document.getElementById('login-spinner');
const loginError     = document.getElementById('login-error');
const browseAnonBtn  = document.getElementById('browse-anon-btn');
const logoutBtn      = document.getElementById('logout-btn');
const userGreeting   = document.getElementById('user-greeting');
const grid           = document.getElementById('grid');
const continueGrid   = document.getElementById('continue-grid');
const resultsTitle   = document.getElementById('results-title');
const resultsCount   = document.getElementById('results-count');
const emptyState     = document.getElementById('empty-state');
const emptyStateCont = document.getElementById('empty-state-continue');
const loadMoreWrap   = document.getElementById('load-more-wrap');
const loadMoreBtn    = document.getElementById('load-more-btn');
const applyBtn       = document.getElementById('apply-btn');
const resetBtn       = document.getElementById('reset-btn');
const ratingCheck    = document.getElementById('rating-filter');
const fullSeasonCheck= document.getElementById('full-season-filter');
const sortSelect     = document.getElementById('sort-select');
const searchInput    = document.getElementById('search-input');
const categorySelect = document.getElementById('category-select');
const hiddenInfo     = document.getElementById('hidden-info');
const hiddenCountEl  = document.getElementById('hidden-count');
const resetHiddenBtn = document.getElementById('reset-hidden-btn');
const cardMenu       = document.getElementById('card-menu');
const tabBrowse      = document.getElementById('tab-browse');
const tabContinue    = document.getElementById('tab-continue');
const panelBrowse    = document.getElementById('panel-browse');
const panelContinue  = document.getElementById('panel-continue');
const continueBadge  = document.getElementById('continue-badge');

/* ── Login flow ──────────────────────────────────────────── */
loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  setLoginLoading(true);
  loginError.classList.add('hidden');

  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res  = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    saveAuth({ token: data.access_token, tokenType: data.token_type || 'Bearer', accountId: data.account_id, anon: false });
    showBrowse(email);
  } catch (err) {
    loginError.textContent = err.message;
    loginError.classList.remove('hidden');
  } finally {
    setLoginLoading(false);
  }
});

browseAnonBtn.addEventListener('click', () => {
  saveAuth({ token: null, tokenType: null, accountId: null, anon: true });
  showBrowse(null);
});

function setLoginLoading(on) {
  loginBtn.disabled = on;
  loginLabel.textContent = on ? 'Signing in…' : 'Sign In';
  loginSpinner.classList.toggle('hidden', !on);
}

/* ── Password toggle ─────────────────────────────────────── */
document.getElementById('toggle-password').addEventListener('click', () => {
  const input = document.getElementById('password');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  document.getElementById('eye-open').classList.toggle('hidden', !showing);
  document.getElementById('eye-closed').classList.toggle('hidden', showing);
});

/* ── Navigation ──────────────────────────────────────────── */
function showBrowse(email) {
  loginScreen.classList.add('hidden');
  browseScreen.classList.remove('hidden');
  if (email) {
    userGreeting.textContent = email;
  } else {
    userGreeting.textContent = isLoggedIn() ? '' : 'Browsing anonymously';
    if (!isLoggedIn()) logoutBtn.textContent = 'Sign in';
  }
  loadCategories();
  initFetch();
}

logoutBtn.addEventListener('click', () => {
  clearAuth();
  browseScreen.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  allSeries = []; filteredSeries = []; grid.innerHTML = '';
});

/* ── Tabs ────────────────────────────────────────────────── */
tabBrowse.addEventListener('click', () => switchTab('browse'));
tabContinue.addEventListener('click', () => { switchTab('continue'); loadContinueTab(); });

function switchTab(tab) {
  currentTab = tab;
  tabBrowse.classList.toggle('active', tab === 'browse');
  tabContinue.classList.toggle('active', tab === 'continue');
  panelBrowse.classList.toggle('hidden', tab !== 'browse');
  panelContinue.classList.toggle('hidden', tab !== 'continue');
}

/* ── Image helpers ───────────────────────────────────────── */
function midImage(images) {
  const arr   = images?.poster_tall ?? images?.poster_wide ?? [];
  const sizes = Array.isArray(arr[0]) ? arr[0] : arr;
  if (!sizes.length) return '';
  return sizes[Math.floor((sizes.length - 1) / 2)]?.source ?? sizes[0]?.source ?? '';
}

/* ── Data extraction ─────────────────────────────────────── */
function seriesId(item) { return item.id ?? item.panel?.id ?? item.slug_title ?? String(Math.random()); }

function extractRating(item) {
  // First check ratings cache (populated after login)
  const id = String(seriesId(item));
  if (ratingsCache[id]?.average != null) return parseFloat(ratingsCache[id].average);
  const panel = item.panel ?? item;
  const meta  = panel.series_metadata ?? panel.metadata ?? {};
  for (const v of [meta.rating, item.rating, panel.rating]) {
    const n = parseFloat(v); if (!isNaN(n)) return n;
  }
  return null;
}

function extractEpisodes(item) {
  const panel = item.panel ?? item;
  const meta  = panel.series_metadata ?? panel.metadata ?? item.series_metadata ?? {};
  for (const v of [meta.episode_count, meta.num_episodes, item.episode_count, panel.episode_count]) {
    const n = parseInt(v, 10); if (!isNaN(n) && n > 0) return n;
  }
  return null;
}

/* ── API fetch (paginated) ───────────────────────────────── */
function apiHeaders() {
  const h = {};
  const tok = authHeader();
  if (tok) h['Authorization'] = tok;
  return h;
}

async function fetchBatch() {
  if (apiFetching || apiOffset >= MAX_TOTAL) return false;
  apiFetching = true;

  const sort_by  = sortSelect.value === 'rating' ? 'popularity' : sortSelect.value;
  const query    = searchInput.value.trim();
  const category = categorySelect.value;
  const params   = new URLSearchParams({ n: BATCH_SIZE, start: apiOffset, sort_by });
  if (query)    params.set('query', query);
  if (category) params.set('category', category);

  try {
    const res  = await fetch(`/api/series?${params}`, { headers: apiHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'API error');
    const items = data.items ?? [];
    allSeries.push(...items);
    apiOffset += BATCH_SIZE;
    return items.length > 0;
  } catch (err) {
    grid.innerHTML = `<p style="color:#ef4444;padding:2rem">Error: ${err.message}</p>`;
    return false;
  } finally {
    apiFetching = false;
  }
}

async function initFetch() {
  allSeries = []; filteredSeries = []; displayedCount = 0; apiOffset = 0;
  grid.innerHTML = '<p style="color:var(--cr-muted);padding:2rem">Loading…</p>';
  resultsTitle.textContent = 'Loading…';
  resultsCount.classList.add('hidden');
  emptyState.classList.add('hidden');
  loadMoreWrap.classList.add('hidden');

  await fetchBatch();
  applyFilters();

  // Fetch ratings in background after first batch (only when logged in)
  if (isLoggedIn()) fetchRatingsForVisible();
}

/* ── Ratings fetch ───────────────────────────────────────── */
async function fetchRatingsForVisible() {
  const auth = getAuth();
  if (!auth || auth.anon || !auth.accountId) return;

  const ids = filteredSeries.slice(0, displayedCount).map(i => String(seriesId(i)));
  if (!ids.length) return;

  try {
    const res  = await fetch(`/api/ratings?ids=${ids.join(',')}&accountId=${auth.accountId}`, { headers: apiHeaders() });
    const data = await res.json();
    Object.assign(ratingsCache, data);
    updateCardRatings(ids);

    // Re-sort if rating sort is active
    if (sortSelect.value === 'rating') applyFilters();
  } catch (_) {}
}

function updateCardRatings(ids) {
  ids.forEach(id => {
    const card = grid.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!card) return;
    const r = ratingsCache[id]?.average;
    if (r == null) return;
    const val    = parseFloat(r);
    const metaRow = card.querySelector('.card-meta-row');
    if (!metaRow) return;
    // Remove old rating span if any, insert fresh one
    const old = metaRow.querySelector('.card-rating-text');
    const dot = metaRow.querySelector('.dot');
    const newSpan = document.createElement('span');
    newSpan.className = `card-rating-text${val >= 4.4 ? ' high' : ''}`;
    newSpan.textContent = `★ ${val.toFixed(1)}`;
    if (old) old.replaceWith(newSpan);
    else {
      if (dot) metaRow.insertBefore(newSpan, dot);
      else metaRow.prepend(newSpan);
    }
  });
}

/* ── Filters ─────────────────────────────────────────────── */
function applyFilters() {
  const hidden           = getHidden();
  const filterRating     = ratingCheck.checked;
  const filterFullSeason = fullSeasonCheck.checked;

  filteredSeries = allSeries.filter(item => {
    if (hidden.has(String(seriesId(item)))) return false;
    if (filterRating) { const r = extractRating(item); if (r === null || r < 4.4) return false; }
    if (filterFullSeason) { const e = extractEpisodes(item); if (e === null || e < 12) return false; }
    return true;
  });

  if (sortSelect.value === 'rating')
    filteredSeries.sort((a, b) => (extractRating(b) ?? -1) - (extractRating(a) ?? -1));

  displayedCount = 0; grid.innerHTML = '';
  renderNextPage();

  const total = filteredSeries.length;
  resultsTitle.textContent = filterRating ? 'Series rated ≥ 4.4' : 'Top Series';
  resultsCount.textContent = `${total} shown`;
  resultsCount.classList.toggle('hidden', total === 0);
  emptyState.classList.toggle('hidden', total > 0);
  updateHiddenBadge();
}

function renderNextPage() {
  const batch = filteredSeries.slice(displayedCount, displayedCount + PAGE_SIZE);
  batch.forEach(item => grid.appendChild(buildCard(item)));
  displayedCount += batch.length;
  const uiHasMore  = displayedCount < filteredSeries.length;
  const apiHasMore = apiOffset < MAX_TOTAL;
  loadMoreWrap.classList.toggle('hidden', !uiHasMore && !apiHasMore);
}

loadMoreBtn.addEventListener('click', async () => {
  if (displayedCount >= filteredSeries.length && apiOffset < MAX_TOTAL) {
    loadMoreBtn.textContent = 'Loading…'; loadMoreBtn.disabled = true;
    const got = await fetchBatch();
    loadMoreBtn.textContent = 'Load more'; loadMoreBtn.disabled = false;
    if (got) { applyFilters(); if (isLoggedIn()) fetchRatingsForVisible(); }
    return;
  }
  renderNextPage();
  if (isLoggedIn()) fetchRatingsForVisible();
});

/* ── Hidden badge ────────────────────────────────────────── */
function updateHiddenBadge() {
  const n = getHidden().size;
  hiddenCountEl.textContent = n;
  hiddenInfo.classList.toggle('hidden', n === 0);
}
resetHiddenBtn.addEventListener('click', () => { clearHidden(); applyFilters(); });

/* ── Card builder ────────────────────────────────────────── */
function buildCard(item, opts = {}) {
  const panel    = item.panel ?? item;
  const meta     = panel.series_metadata ?? panel.metadata ?? {};
  const title    = panel.title ?? item.title ?? 'Unknown';
  const provider = meta.content_provider ?? item.content_provider ?? '';
  const rating   = extractRating(item);
  const episodes = extractEpisodes(item);
  const id       = String(seriesId(item));
  const imgSrc   = midImage(panel.images) || midImage(item.images);

  const metaParts = [];
  if (rating   !== null) metaParts.push(`<span class="card-rating-text${rating >= 4.4 ? ' high' : ''}">★ ${rating.toFixed(1)}</span>`);
  if (episodes !== null) metaParts.push(`<span class="card-eps">${episodes} eps</span>`);

  const card = document.createElement('div');
  card.className = 'series-card'; card.dataset.id = id;
  card.innerHTML = `
    <div class="card-img-wrap">
      ${imgSrc ? `<img src="${escHtml(imgSrc)}" alt="${escHtml(title)}" loading="lazy" />` : `<div class="no-img">🎬</div>`}
      ${opts.newEpisodes ? `<div class="new-eps-badge">New episodes!</div>` : ''}
      <button class="card-menu-btn" aria-label="Options" title="Options">⋮</button>
    </div>
    <div class="card-info">
      <div class="card-title">${escHtml(title)}</div>
      ${metaParts.length ? `<div class="card-meta-row">${metaParts.join('<span class="dot">·</span>')}</div>` : ''}
      ${provider ? `<div class="card-provider">${escHtml(provider)}</div>` : ''}
    </div>`;

  card.addEventListener('click', e => { if (!e.target.closest('.card-menu-btn')) openModal(item); });
  card.querySelector('.card-menu-btn').addEventListener('click', e => { e.stopPropagation(); openCardMenu(e.currentTarget, id, item); });
  return card;
}

/* ── Continue tab ────────────────────────────────────────── */
async function loadContinueTab() {
  const seen = getSeen();
  const ids  = Object.keys(seen);
  continueGrid.innerHTML = '<p style="color:var(--cr-muted);padding:2rem">Checking for new episodes…</p>';
  emptyStateCont.classList.add('hidden');

  if (!ids.length) {
    continueGrid.innerHTML = '';
    emptyStateCont.classList.remove('hidden');
    continueBadge.classList.add('hidden');
    return;
  }

  const results = await Promise.all(ids.map(async id => {
    const local = allSeries.find(s => String(seriesId(s)) === id);
    if (local) return { id, item: local, stored: seen[id] };
    try {
      const h = apiHeaders();
      const res  = await fetch(`/api/series-single?id=${encodeURIComponent(id)}`, { headers: h });
      const data = await res.json();
      return { id, item: data.data?.[0] ?? data, stored: seen[id] };
    } catch { return { id, item: null, stored: seen[id] }; }
  }));

  continueGrid.innerHTML = '';
  let newCount = 0;

  results.forEach(({ id, item, stored }) => {
    const currentEps  = item ? (extractEpisodes(item) ?? stored.episodeCount) : stored.episodeCount;
    const newEpisodes = currentEps > stored.episodeCount;
    if (newEpisodes) newCount++;

    const displayItem = item ?? { id, title: stored.title, images: stored.imgSrc ? { poster_tall: [[{ source: stored.imgSrc }]] } : {}, slug_title: stored.slug, series_metadata: { episode_count: currentEps } };
    const card = buildCard(displayItem, { newEpisodes });

    if (newEpisodes) {
      const info = card.querySelector('.card-info');
      const diff = document.createElement('div');
      diff.className = 'eps-diff';
      diff.innerHTML = `<span class="old-eps">${stored.episodeCount} eps seen</span> → <span class="new-eps">${currentEps} now</span>`;
      info.appendChild(diff);
      const markBtn = document.createElement('button');
      markBtn.className = 'btn-mark-seen'; markBtn.textContent = '✓ Mark as seen';
      markBtn.addEventListener('click', e => { e.stopPropagation(); markSeen(displayItem); loadContinueTab(); });
      info.appendChild(markBtn);
    }
    continueGrid.appendChild(card);
  });

  continueBadge.textContent = newCount > 0 ? newCount : '';
  continueBadge.classList.toggle('hidden', newCount === 0);
  emptyStateCont.classList.toggle('hidden', results.length > 0);
}

/* ── Card context menu ───────────────────────────────────── */
let activeMenuId = null, activeMenuItem = null;

function openCardMenu(btn, id, item) {
  if (activeMenuId === id && !cardMenu.classList.contains('hidden')) { closeCardMenu(); return; }
  activeMenuId = id; activeMenuItem = item;
  cardMenu.dataset.targetId = id;
  const seen = getSeen();
  cardMenu.querySelector('[data-action="seen"]').textContent = seen[id] ? '✓ Update seen' : '👁 Mark as Seen';
  const rect = btn.getBoundingClientRect();
  cardMenu.classList.remove('hidden');
  let top = rect.bottom + 4 + window.scrollY, left = rect.left + window.scrollX;
  if (left + 185 > window.innerWidth) left = rect.right + window.scrollX - 185;
  cardMenu.style.top = `${top}px`; cardMenu.style.left = `${left}px`;
}
function closeCardMenu() { cardMenu.classList.add('hidden'); activeMenuId = null; activeMenuItem = null; }

cardMenu.addEventListener('click', e => {
  const btn = e.target.closest('.card-menu-item'); if (!btn) return;
  const action = btn.dataset.action, id = cardMenu.dataset.targetId, item = activeMenuItem;
  closeCardMenu();
  if (action === 'hide') {
    addHidden(id);
    grid.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove();
    filteredSeries = filteredSeries.filter(i => String(seriesId(i)) !== id);
    resultsCount.textContent = `${filteredSeries.length} shown`;
    updateHiddenBadge();
  }
  if (action === 'seen' && item) {
    markSeen(item);
    const card = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (card) { card.style.borderColor = '#4ade80'; setTimeout(() => card.style.borderColor = '', 1200); }
  }
});

document.addEventListener('click', e => { if (!cardMenu.classList.contains('hidden') && !cardMenu.contains(e.target)) closeCardMenu(); });
window.addEventListener('scroll', closeCardMenu, { passive: true });

/* ── Detail modal ────────────────────────────────────────── */
const modalOverlay = document.getElementById('modal-overlay');
const modalClose   = document.getElementById('modal-close');

function openModal(item) {
  const panel = item.panel ?? item, meta = panel.series_metadata ?? panel.metadata ?? {};
  const title = panel.title ?? item.title ?? '', slug = panel.slug_title ?? item.slug_title ?? '';
  const rating = extractRating(item), imgSrc = midImage(panel.images) || midImage(item.images);

  document.getElementById('modal-title').textContent    = title;
  document.getElementById('modal-desc').textContent     = meta.extended_description ?? meta.short_description ?? 'No description available.';
  document.getElementById('modal-provider').textContent = meta.content_provider ?? '';
  document.getElementById('modal-year').textContent     = meta.series_launch_year ? `(${meta.series_launch_year})` : '';

  const rEl = document.getElementById('modal-rating');
  rEl.textContent = rating !== null ? `★ ${rating.toFixed(1)}` : ''; rEl.style.display = rating !== null ? '' : 'none';

  const imgEl = document.getElementById('modal-img');
  if (imgSrc) { imgEl.src = escHtml(imgSrc); imgEl.style.display = ''; } else imgEl.style.display = 'none';

  document.getElementById('modal-genres').innerHTML = (meta.genres ?? []).map(g => `<span class="genre-tag">${escHtml(g)}</span>`).join('');
  document.getElementById('modal-link').href = slug ? `https://www.crunchyroll.com/series/${slug}` : 'https://www.crunchyroll.com';
  modalOverlay.classList.remove('hidden'); document.body.style.overflow = 'hidden';
}
function closeModal() { modalOverlay.classList.add('hidden'); document.body.style.overflow = ''; }
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeCardMenu(); } });

/* ── Filter controls ─────────────────────────────────────── */
applyBtn.addEventListener('click', initFetch);
resetBtn.addEventListener('click', () => {
  searchInput.value = ''; sortSelect.value = 'rating'; ratingCheck.checked = false;
  fullSeasonCheck.checked = false; categorySelect.value = ''; initFetch();
});
ratingCheck.addEventListener('change', applyFilters);
fullSeasonCheck.addEventListener('change', applyFilters);
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') initFetch(); });

/* ── Categories ──────────────────────────────────────────── */
async function loadCategories() {
  try {
    const res = await fetch('/api/categories', { headers: apiHeaders() }); if (!res.ok) return;
    const data = await res.json();
    (data.data ?? data.items ?? []).forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.slug ?? cat.id ?? cat.title;
      opt.textContent = cat.localization?.title ?? cat.title ?? cat.slug;
      categorySelect.appendChild(opt);
    });
  } catch (_) {}
}

/* ── Utility ─────────────────────────────────────────────── */
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* ── Boot ────────────────────────────────────────────────── */
updateHiddenBadge();
const saved = getAuth();
if (saved) {
  showBrowse(saved.anon ? null : null);  // restore session without re-showing email
} else {
  loginScreen.classList.remove('hidden');
}
