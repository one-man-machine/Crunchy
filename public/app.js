/* ── localStorage helpers ──────────────────────────────── */
const STORAGE_KEY = 'cr_not_interested';

function getHidden() {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY)) || []); }
  catch { return new Set(); }
}
function saveHidden(set) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}
function hideSeriesId(id) {
  const s = getHidden(); s.add(String(id)); saveHidden(s);
}
function restoreAll() {
  localStorage.removeItem(STORAGE_KEY);
}

/* ── State ─────────────────────────────────────────────── */
let allSeries      = [];
let filteredSeries = [];
let displayedCount = 0;
const PAGE_SIZE    = 20;

/* ── DOM refs ───────────────────────────────────────────── */
const grid          = document.getElementById('grid');
const resultsTitle  = document.getElementById('results-title');
const resultsCount  = document.getElementById('results-count');
const emptyState    = document.getElementById('empty-state');
const loadMoreWrap  = document.getElementById('load-more-wrap');
const loadMoreBtn   = document.getElementById('load-more-btn');
const applyBtn      = document.getElementById('apply-btn');
const resetBtn      = document.getElementById('reset-btn');
const ratingCheck   = document.getElementById('rating-filter');
const sortSelect    = document.getElementById('sort-select');
const searchInput   = document.getElementById('search-input');
const categorySelect = document.getElementById('category-select');
const hiddenInfo    = document.getElementById('hidden-info');
const hiddenCount   = document.getElementById('hidden-count');
const resetHiddenBtn = document.getElementById('reset-hidden-btn');
const cardMenu      = document.getElementById('card-menu');

/* ── Fetch series ───────────────────────────────────────── */
async function fetchSeries() {
  grid.innerHTML = '<p style="color:var(--cr-muted);padding:2rem">Loading…</p>';
  resultsTitle.textContent = 'Loading…';
  resultsCount.classList.add('hidden');
  emptyState.classList.add('hidden');
  loadMoreWrap.classList.add('hidden');

  const query    = searchInput.value.trim();
  const sort_by  = sortSelect.value;
  const category = categorySelect.value;
  const params   = new URLSearchParams({ n: 100, start: 0, sort_by });
  if (query)    params.set('query', query);
  if (category) params.set('category', category);

  try {
    const res  = await fetch(`/api/series?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load');
    allSeries = data.items ?? [];
    applyFilters();
  } catch (err) {
    grid.innerHTML = `<p style="color:#ef4444;padding:2rem">Error: ${err.message}</p>`;
    resultsTitle.textContent = 'Error';
  }
}

/* ── Client-side filtering ──────────────────────────────── */
function applyFilters() {
  const hidden        = getHidden();
  const filterRating  = ratingCheck.checked;

  filteredSeries = allSeries.filter(item => {
    const id = String(seriesId(item));
    if (hidden.has(id)) return false;
    if (filterRating) {
      const r = extractRating(item);
      if (r === null || r < 4.4) return false;
    }
    return true;
  });

  displayedCount = 0;
  grid.innerHTML = '';
  renderNextPage();

  const total = filteredSeries.length;
  resultsTitle.textContent = filterRating ? 'Series rated ≥ 4.4' : 'Top Series';
  if (total > 0) {
    resultsCount.textContent = `${total} shown`;
    resultsCount.classList.remove('hidden');
    emptyState.classList.add('hidden');
  } else {
    resultsCount.classList.add('hidden');
    emptyState.classList.remove('hidden');
  }

  updateHiddenBadge();
}

function renderNextPage() {
  const batch = filteredSeries.slice(displayedCount, displayedCount + PAGE_SIZE);
  batch.forEach(item => grid.appendChild(buildCard(item)));
  displayedCount += batch.length;
  loadMoreWrap.classList.toggle('hidden', displayedCount >= filteredSeries.length);
}

loadMoreBtn.addEventListener('click', renderNextPage);

/* ── Hidden badge ───────────────────────────────────────── */
function updateHiddenBadge() {
  const n = getHidden().size;
  if (n > 0) {
    hiddenCount.textContent = n;
    hiddenInfo.classList.remove('hidden');
  } else {
    hiddenInfo.classList.add('hidden');
  }
}

resetHiddenBtn.addEventListener('click', () => {
  restoreAll();
  applyFilters();
});

/* ── Series ID ──────────────────────────────────────────── */
function seriesId(item) {
  return item.id ?? item.panel?.id ?? item.slug_title ?? Math.random();
}

/* ── Rating extraction ──────────────────────────────────── */
function extractRating(item) {
  const candidates = [
    item.rating,
    item.series_metadata?.rating,
    item.metadata?.rating,
    item.panel?.series_metadata?.rating,
    item.panel?.rating,
  ];
  for (const v of candidates) {
    const n = parseFloat(v);
    if (!isNaN(n)) return n;
  }
  return null;
}

/* ── Card builder ───────────────────────────────────────── */
function buildCard(item) {
  const panel    = item.panel ?? item;
  const meta     = panel.series_metadata ?? panel.metadata ?? {};
  const title    = panel.title ?? item.title ?? 'Unknown';
  const slug     = panel.slug_title ?? item.slug_title ?? '';
  const provider = meta.content_provider ?? item.content_provider ?? '';
  const rating   = extractRating(item);
  const id       = seriesId(item);

  const posterArr = panel.images?.poster_tall ?? panel.images?.poster_wide
    ?? item.images?.poster_tall ?? item.images?.poster_wide ?? [];
  const imgSrc = posterArr[0]?.[0]?.source ?? posterArr[0]?.source ?? '';

  const card = document.createElement('div');
  card.className = 'series-card';
  card.dataset.id = id;
  card.innerHTML = `
    <div class="card-img-wrap">
      ${imgSrc
        ? `<img src="${escHtml(imgSrc)}" alt="${escHtml(title)}" loading="lazy" />`
        : `<div class="no-img">🎬</div>`}
      ${rating !== null
        ? `<div class="card-rating ${rating >= 4.4 ? 'high' : ''}">★ ${rating.toFixed(1)}</div>`
        : ''}
      <button class="card-menu-btn" aria-label="Options" title="Options">⋮</button>
    </div>
    <div class="card-info">
      <div class="card-title">${escHtml(title)}</div>
      ${provider ? `<div class="card-provider">${escHtml(provider)}</div>` : ''}
    </div>
  `;

  // Open detail modal on card click (but not the menu button)
  card.addEventListener('click', (e) => {
    if (e.target.closest('.card-menu-btn')) return;
    openModal(item);
  });

  // Menu button opens context menu
  card.querySelector('.card-menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openCardMenu(e.currentTarget, id, card);
  });

  return card;
}

/* ── Card context menu ──────────────────────────────────── */
let activeMenuId = null;

function openCardMenu(btn, id, card) {
  // Toggle off if already open for this card
  if (activeMenuId === id && !cardMenu.classList.contains('hidden')) {
    closeCardMenu();
    return;
  }
  activeMenuId = id;

  // Store which card this menu targets
  cardMenu.dataset.targetId = id;

  // Position menu near the button
  const rect = btn.getBoundingClientRect();
  cardMenu.classList.remove('hidden');

  // Default: below-right of button
  let top  = rect.bottom + 4;
  let left = rect.left;

  // Keep within viewport
  const menuW = 180, menuH = 50;
  if (left + menuW > window.innerWidth)  left  = rect.right - menuW;
  if (top  + menuH > window.innerHeight) top   = rect.top - menuH - 4;

  cardMenu.style.top  = `${top  + window.scrollY}px`;
  cardMenu.style.left = `${left + window.scrollX}px`;
}

function closeCardMenu() {
  cardMenu.classList.add('hidden');
  activeMenuId = null;
}

// Handle menu actions
cardMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('.card-menu-item');
  if (!btn) return;
  const action = btn.dataset.action;
  const id     = cardMenu.dataset.targetId;
  closeCardMenu();

  if (action === 'hide') {
    hideSeriesId(id);
    // Remove card from DOM immediately
    const card = grid.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (card) card.remove();
    // Update count display
    filteredSeries = filteredSeries.filter(i => String(seriesId(i)) !== String(id));
    resultsCount.textContent = `${filteredSeries.length} shown`;
    updateHiddenBadge();
  }
});

// Close menu when clicking outside
document.addEventListener('click', (e) => {
  if (!cardMenu.classList.contains('hidden') && !cardMenu.contains(e.target)) {
    closeCardMenu();
  }
});

// Close on scroll
window.addEventListener('scroll', closeCardMenu, { passive: true });

/* ── Detail modal ───────────────────────────────────────── */
const modalOverlay = document.getElementById('modal-overlay');
const modalClose   = document.getElementById('modal-close');

function openModal(item) {
  const panel       = item.panel ?? item;
  const meta        = panel.series_metadata ?? panel.metadata ?? {};
  const title       = panel.title ?? item.title ?? '';
  const slug        = panel.slug_title ?? item.slug_title ?? '';
  const description = meta.extended_description ?? meta.short_description ?? panel.description ?? item.description ?? 'No description available.';
  const provider    = meta.content_provider ?? item.content_provider ?? '';
  const year        = meta.series_launch_year ?? meta.year ?? '';
  const genres      = meta.genres ?? item.genres ?? [];
  const rating      = extractRating(item);
  const posterArr   = panel.images?.poster_tall ?? panel.images?.poster_wide
    ?? item.images?.poster_tall ?? item.images?.poster_wide ?? [];
  const imgSrc      = posterArr[0]?.[0]?.source ?? posterArr[0]?.source ?? '';

  document.getElementById('modal-title').textContent    = title;
  document.getElementById('modal-desc').textContent     = description;
  document.getElementById('modal-provider').textContent = provider;
  document.getElementById('modal-year').textContent     = year ? `(${year})` : '';

  const ratingEl = document.getElementById('modal-rating');
  ratingEl.textContent    = rating !== null ? `★ ${rating.toFixed(1)}` : '';
  ratingEl.style.display  = rating !== null ? '' : 'none';

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
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeCardMenu(); } });

/* ── Filter controls ────────────────────────────────────── */
applyBtn.addEventListener('click', fetchSeries);
resetBtn.addEventListener('click', () => {
  searchInput.value    = '';
  sortSelect.value     = 'popularity';
  ratingCheck.checked  = false;
  categorySelect.value = '';
  fetchSeries();
});
ratingCheck.addEventListener('change', applyFilters);
searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchSeries(); });

/* ── Categories ─────────────────────────────────────────── */
async function loadCategories() {
  try {
    const res  = await fetch('/api/categories');
    if (!res.ok) return;
    const data = await res.json();
    const items = data.data ?? data.items ?? [];
    items.forEach(cat => {
      const opt = document.createElement('option');
      opt.value       = cat.slug ?? cat.id ?? cat.title;
      opt.textContent = cat.localization?.title ?? cat.title ?? cat.slug;
      categorySelect.appendChild(opt);
    });
  } catch (_) {}
}

/* ── Utility ─────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Boot ────────────────────────────────────────────────── */
updateHiddenBadge();
loadCategories();
fetchSeries();
