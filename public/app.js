/* ── Constants ───────────────────────────────────────────── */
const PAGE_SIZE  = 50;   // cards shown per "page"
const BATCH_SIZE = 100;  // items fetched per API call
const MAX_TOTAL  = 500;  // max items to ever fetch

/* ── Storage keys ────────────────────────────────────────── */
const KEY_HIDDEN = 'cr_not_interested';
const KEY_SEEN   = 'cr_seen';  // { [id]: { episodeCount, title, imgSrc, slug, seenAt } }

/* ── Storage helpers ─────────────────────────────────────── */
function getHidden() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY_HIDDEN)) || []); }
  catch { return new Set(); }
}
function saveHidden(s) { localStorage.setItem(KEY_HIDDEN, JSON.stringify([...s])); }
function addHidden(id) { const s = getHidden(); s.add(String(id)); saveHidden(s); }
function clearHidden() { localStorage.removeItem(KEY_HIDDEN); }

function getSeen() {
  try { return JSON.parse(localStorage.getItem(KEY_SEEN)) || {}; }
  catch { return {}; }
}
function saveSeen(obj) { localStorage.setItem(KEY_SEEN, JSON.stringify(obj)); }
function markSeen(item) {
  const seen = getSeen();
  const id   = String(seriesId(item));
  const panel = item.panel ?? item;
  seen[id] = {
    episodeCount: extractEpisodes(item) ?? 0,
    title:  panel.title ?? item.title ?? '',
    imgSrc: midImage(panel.images) || midImage(item.images),
    slug:   panel.slug_title ?? item.slug_title ?? '',
    seenAt: new Date().toISOString(),
  };
  saveSeen(seen);
}
function removeSeen(id) {
  const seen = getSeen();
  delete seen[String(id)];
  saveSeen(seen);
}

/* ── State ───────────────────────────────────────────────── */
let allSeries      = [];   // accumulated from API
let filteredSeries = [];   // after filters
let displayedCount = 0;    // how many cards rendered
let apiOffset      = 0;    // next API fetch start
let apiFetching    = false;
let currentTab     = 'browse';

/* ── DOM refs ────────────────────────────────────────────── */
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
const hiddenCount    = document.getElementById('hidden-count');
const resetHiddenBtn = document.getElementById('reset-hidden-btn');
const cardMenu       = document.getElementById('card-menu');
const tabBrowse      = document.getElementById('tab-browse');
const tabContinue    = document.getElementById('tab-continue');
const panelBrowse    = document.getElementById('panel-browse');
const panelContinue  = document.getElementById('panel-continue');
const continueBadge  = document.getElementById('continue-badge');

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
  const mid = Math.floor((sizes.length - 1) / 2);  // mid quality
  return sizes[mid]?.source ?? sizes[0]?.source ?? '';
}

/* ── Data extraction ─────────────────────────────────────── */
function seriesId(item) {
  return item.id ?? item.panel?.id ?? item.slug_title ?? String(Math.random());
}

function extractRating(item) {
  const panel = item.panel ?? item;
  const meta  = panel.series_metadata ?? panel.metadata ?? {};
  const candidates = [
    meta.rating, item.rating,
    panel.rating, item.series_metadata?.rating,
  ];
  for (const v of candidates) {
    const n = parseFloat(v);
    if (!isNaN(n)) return n;
  }
  return null;
}

function extractEpisodes(item) {
  const panel = item.panel ?? item;
  const meta  = panel.series_metadata ?? panel.metadata ?? item.series_metadata ?? {};
  const candidates = [
    meta.episode_count, meta.num_episodes,
    item.episode_count, panel.episode_count,
  ];
  for (const v of candidates) {
    const n = parseInt(v, 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return null;
}

/* ── API fetch (paginated) ───────────────────────────────── */
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
    const res  = await fetch(`/api/series?${params}`);
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
  allSeries      = [];
  filteredSeries = [];
  displayedCount = 0;
  apiOffset      = 0;
  grid.innerHTML = '<p style="color:var(--cr-muted);padding:2rem">Loading…</p>';
  resultsTitle.textContent = 'Loading…';
  resultsCount.classList.add('hidden');
  emptyState.classList.add('hidden');
  loadMoreWrap.classList.add('hidden');

  await fetchBatch();
  applyFilters();
}

/* ── Filters ─────────────────────────────────────────────── */
function applyFilters() {
  const hidden          = getHidden();
  const filterRating    = ratingCheck.checked;
  const filterFullSeason= fullSeasonCheck.checked;

  filteredSeries = allSeries.filter(item => {
    if (hidden.has(String(seriesId(item)))) return false;
    if (filterRating) {
      const r = extractRating(item);
      if (r === null || r < 4.4) return false;
    }
    if (filterFullSeason) {
      const eps = extractEpisodes(item);
      if (eps === null || eps < 12) return false;
    }
    return true;
  });

  if (sortSelect.value === 'rating') {
    filteredSeries.sort((a, b) => (extractRating(b) ?? -1) - (extractRating(a) ?? -1));
  }

  displayedCount = 0;
  grid.innerHTML = '';
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
  // If we've shown all currently filtered items, fetch a new batch first
  if (displayedCount >= filteredSeries.length && apiOffset < MAX_TOTAL) {
    loadMoreBtn.textContent = 'Loading…';
    loadMoreBtn.disabled    = true;
    const got = await fetchBatch();
    loadMoreBtn.textContent = 'Load more';
    loadMoreBtn.disabled    = false;
    if (got) applyFilters();  // re-filter with new items then fall through to render
    return;
  }
  renderNextPage();
});

/* ── Hidden badge ────────────────────────────────────────── */
function updateHiddenBadge() {
  const n = getHidden().size;
  hiddenCount.textContent = n;
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
  if (rating   !== null) metaParts.push(`<span class="card-rating-text ${rating >= 4.4 ? 'high' : ''}">★ ${rating.toFixed(1)}</span>`);
  if (episodes !== null) metaParts.push(`<span class="card-eps">${episodes} eps</span>`);

  const newEpsBadge = opts.newEpisodes
    ? `<div class="new-eps-badge">New episodes!</div>` : '';

  const card = document.createElement('div');
  card.className   = 'series-card';
  card.dataset.id  = id;
  card.innerHTML = `
    <div class="card-img-wrap">
      ${imgSrc
        ? `<img src="${escHtml(imgSrc)}" alt="${escHtml(title)}" loading="lazy" />`
        : `<div class="no-img">🎬</div>`}
      ${newEpsBadge}
      <button class="card-menu-btn" aria-label="Options" title="Options">⋮</button>
    </div>
    <div class="card-info">
      <div class="card-title">${escHtml(title)}</div>
      ${metaParts.length
        ? `<div class="card-meta-row">${metaParts.join('<span class="dot">·</span>')}</div>`
        : ''}
      ${provider ? `<div class="card-provider">${escHtml(provider)}</div>` : ''}
    </div>
  `;

  card.addEventListener('click', e => {
    if (e.target.closest('.card-menu-btn')) return;
    openModal(item);
  });
  card.querySelector('.card-menu-btn').addEventListener('click', e => {
    e.stopPropagation();
    openCardMenu(e.currentTarget, id, item);
  });
  return card;
}

/* ── Continue tab ────────────────────────────────────────── */
async function loadContinueTab() {
  const seen = getSeen();
  const ids  = Object.keys(seen);
  continueGrid.innerHTML = '<p style="color:var(--cr-muted);padding:2rem">Checking for new episodes…</p>';
  emptyStateCont.classList.add('hidden');

  if (ids.length === 0) {
    continueGrid.innerHTML = '';
    emptyStateCont.classList.remove('hidden');
    continueBadge.classList.add('hidden');
    return;
  }

  // Fetch current data for each seen series
  const results = await Promise.all(ids.map(async id => {
    // First check if already in allSeries (saves a fetch)
    const local = allSeries.find(s => String(seriesId(s)) === id);
    if (local) return { id, item: local, stored: seen[id] };

    try {
      const res  = await fetch(`/api/series-single?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      const item = data.data?.[0] ?? data;
      return { id, item, stored: seen[id] };
    } catch {
      return { id, item: null, stored: seen[id] };
    }
  }));

  continueGrid.innerHTML = '';
  let newCount = 0;

  results.forEach(({ id, item, stored }) => {
    const currentEps  = item ? (extractEpisodes(item) ?? stored.episodeCount) : stored.episodeCount;
    const newEpisodes = currentEps > stored.episodeCount;
    if (newEpisodes) newCount++;

    // Use fresh item if available, else reconstruct a minimal object from stored data
    const displayItem = item ?? {
      id,
      title:  stored.title,
      images: stored.imgSrc ? { poster_tall: [[{ source: stored.imgSrc }]] } : {},
      slug_title: stored.slug,
      series_metadata: { episode_count: currentEps },
    };

    const card = buildCard(displayItem, { newEpisodes });

    // Add "Mark as seen" button if new episodes exist
    if (newEpisodes) {
      const info = card.querySelector('.card-info');
      const oldEps = stored.episodeCount;
      const diff = document.createElement('div');
      diff.className = 'eps-diff';
      diff.innerHTML = `<span class="old-eps">${oldEps} eps seen</span> → <span class="new-eps">${currentEps} eps now</span>`;
      info.appendChild(diff);

      const markBtn = document.createElement('button');
      markBtn.className   = 'btn-mark-seen';
      markBtn.textContent = '✓ Mark as seen';
      markBtn.addEventListener('click', e => {
        e.stopPropagation();
        markSeen(displayItem);
        loadContinueTab();
      });
      info.appendChild(markBtn);
    }

    continueGrid.appendChild(card);
  });

  continueBadge.textContent = newCount > 0 ? newCount : '';
  continueBadge.classList.toggle('hidden', newCount === 0);
  emptyStateCont.classList.toggle('hidden', results.length > 0);
}

/* ── Card context menu ───────────────────────────────────── */
let activeMenuId   = null;
let activeMenuItem = null;  // the raw item object

function openCardMenu(btn, id, item) {
  if (activeMenuId === id && !cardMenu.classList.contains('hidden')) {
    closeCardMenu(); return;
  }
  activeMenuId   = id;
  activeMenuItem = item;
  cardMenu.dataset.targetId = id;

  // Update "Seen" label based on current state
  const seen = getSeen();
  const seenBtn = cardMenu.querySelector('[data-action="seen"]');
  seenBtn.textContent = seen[id] ? '✓ Update seen' : '👁 Mark as Seen';

  const rect = btn.getBoundingClientRect();
  cardMenu.classList.remove('hidden');
  let top = rect.bottom + 4 + window.scrollY;
  let left = rect.left + window.scrollX;
  const menuW = 185;
  if (left + menuW > window.innerWidth) left = rect.right + window.scrollX - menuW;
  cardMenu.style.top  = `${top}px`;
  cardMenu.style.left = `${left}px`;
}

function closeCardMenu() {
  cardMenu.classList.add('hidden');
  activeMenuId   = null;
  activeMenuItem = null;
}

cardMenu.addEventListener('click', e => {
  const btn = e.target.closest('.card-menu-item');
  if (!btn) return;
  const action = btn.dataset.action;
  const id     = cardMenu.dataset.targetId;
  const item   = activeMenuItem;
  closeCardMenu();

  if (action === 'hide') {
    addHidden(id);
    grid.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove();
    filteredSeries = filteredSeries.filter(i => String(seriesId(i)) !== id);
    resultsCount.textContent = `${filteredSeries.length} shown`;
    updateHiddenBadge();
  }

  if (action === 'seen') {
    if (item) markSeen(item);
    // Flash the card border briefly as feedback
    const card = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (card) {
      card.style.borderColor = '#4ade80';
      setTimeout(() => (card.style.borderColor = ''), 1000);
    }
    // Update continue badge
    updateContinueBadgeCount();
  }
});

function updateContinueBadgeCount() {
  const count = Object.keys(getSeen()).length;
  continueBadge.textContent = count > 0 ? '' : '';
  // Full check only done when tab is opened
}

document.addEventListener('click', e => {
  if (!cardMenu.classList.contains('hidden') && !cardMenu.contains(e.target)) closeCardMenu();
});
window.addEventListener('scroll', closeCardMenu, { passive: true });

/* ── Detail modal ────────────────────────────────────────── */
const modalOverlay = document.getElementById('modal-overlay');
const modalClose   = document.getElementById('modal-close');

function openModal(item) {
  const panel    = item.panel ?? item;
  const meta     = panel.series_metadata ?? panel.metadata ?? {};
  const title    = panel.title ?? item.title ?? '';
  const slug     = panel.slug_title ?? item.slug_title ?? '';
  const desc     = meta.extended_description ?? meta.short_description ?? panel.description ?? 'No description available.';
  const provider = meta.content_provider ?? item.content_provider ?? '';
  const year     = meta.series_launch_year ?? '';
  const genres   = meta.genres ?? item.genres ?? [];
  const rating   = extractRating(item);
  const imgSrc   = midImage(panel.images) || midImage(item.images);

  document.getElementById('modal-title').textContent    = title;
  document.getElementById('modal-desc').textContent     = desc;
  document.getElementById('modal-provider').textContent = provider;
  document.getElementById('modal-year').textContent     = year ? `(${year})` : '';

  const ratingEl        = document.getElementById('modal-rating');
  ratingEl.textContent  = rating !== null ? `★ ${rating.toFixed(1)}` : '';
  ratingEl.style.display= rating !== null ? '' : 'none';

  const imgEl = document.getElementById('modal-img');
  if (imgSrc) { imgEl.src = escHtml(imgSrc); imgEl.style.display = ''; }
  else        { imgEl.style.display = 'none'; }

  document.getElementById('modal-genres').innerHTML =
    genres.map(g => `<span class="genre-tag">${escHtml(g)}</span>`).join('');
  document.getElementById('modal-link').href =
    slug ? `https://www.crunchyroll.com/series/${slug}` : 'https://www.crunchyroll.com';

  modalOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modalOverlay.classList.add('hidden');
  document.body.style.overflow = '';
}

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeCardMenu(); }
});

/* ── Filter controls ─────────────────────────────────────── */
applyBtn.addEventListener('click', () => initFetch());
resetBtn.addEventListener('click', () => {
  searchInput.value      = '';
  sortSelect.value       = 'rating';
  ratingCheck.checked    = false;
  fullSeasonCheck.checked= false;
  categorySelect.value   = '';
  initFetch();
});
ratingCheck.addEventListener('change', applyFilters);
fullSeasonCheck.addEventListener('change', applyFilters);
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') initFetch(); });

/* ── Categories ──────────────────────────────────────────── */
async function loadCategories() {
  try {
    const res  = await fetch('/api/categories');
    if (!res.ok) return;
    const data = await res.json();
    const items = data.data ?? data.items ?? [];
    items.forEach(cat => {
      const opt       = document.createElement('option');
      opt.value       = cat.slug ?? cat.id ?? cat.title;
      opt.textContent = cat.localization?.title ?? cat.title ?? cat.slug;
      categorySelect.appendChild(opt);
    });
  } catch (_) {}
}

/* ── Utility ─────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── Boot ────────────────────────────────────────────────── */
updateHiddenBadge();
loadCategories();
initFetch();
