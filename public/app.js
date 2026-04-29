/* ── State ─────────────────────────────────────────── */
let authToken = null;
let allSeries = [];         // full fetched batch
let filteredSeries = [];    // after client-side filters
let displayedCount = 0;
const PAGE_SIZE = 20;

/* ── Auth helpers ──────────────────────────────────── */
function saveSession(data) {
  authToken = `${data.token_type} ${data.access_token}`;
  sessionStorage.setItem('cr_token', authToken);
}
function loadSession() {
  const t = sessionStorage.getItem('cr_token');
  if (t) { authToken = t; return true; }
  return false;
}
function clearSession() {
  authToken = null;
  sessionStorage.removeItem('cr_token');
}

/* ── DOM refs ──────────────────────────────────────── */
const loginScreen  = document.getElementById('login-screen');
const browseScreen = document.getElementById('browse-screen');
const loginForm    = document.getElementById('login-form');
const loginBtn     = document.getElementById('login-btn');
const loginLabel   = document.getElementById('login-label');
const loginSpinner = document.getElementById('login-spinner');
const loginError   = document.getElementById('login-error');
const logoutBtn    = document.getElementById('logout-btn');
const userGreeting = document.getElementById('user-greeting');
const grid         = document.getElementById('grid');
const resultsTitle = document.getElementById('results-title');
const resultsCount = document.getElementById('results-count');
const emptyState   = document.getElementById('empty-state');
const loadMoreWrap = document.getElementById('load-more-wrap');
const loadMoreBtn  = document.getElementById('load-more-btn');
const applyBtn     = document.getElementById('apply-btn');
const resetBtn     = document.getElementById('reset-btn');
const ratingCheck  = document.getElementById('rating-filter');
const sortSelect   = document.getElementById('sort-select');
const searchInput  = document.getElementById('search-input');
const categorySelect = document.getElementById('category-select');

/* ── Login ─────────────────────────────────────────── */
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setLoginLoading(true);
  loginError.classList.add('hidden');

  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    saveSession(data);
    showBrowse(email);
  } catch (err) {
    showLoginError(err.message);
  } finally {
    setLoginLoading(false);
  }
});

function setLoginLoading(on) {
  loginBtn.disabled = on;
  loginLabel.textContent = on ? 'Signing in…' : 'Sign In';
  loginSpinner.classList.toggle('hidden', !on);
}

function showLoginError(msg) {
  loginError.textContent = msg;
  loginError.classList.remove('hidden');
}

/* ── Navigation ────────────────────────────────────── */
function showBrowse(email) {
  loginScreen.classList.add('hidden');
  browseScreen.classList.remove('hidden');
  if (email) userGreeting.textContent = email;
  loadCategories();
  fetchSeries();
}

function showLogin() {
  browseScreen.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  clearSession();
  allSeries = [];
  filteredSeries = [];
  grid.innerHTML = '';
}

logoutBtn.addEventListener('click', showLogin);

/* ── Categories ────────────────────────────────────── */
async function loadCategories() {
  try {
    const res = await fetch('/api/categories', {
      headers: { Authorization: authToken },
    });
    if (!res.ok) return;
    const data = await res.json();
    const items = data.data ?? data.items ?? [];
    items.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.slug ?? cat.id ?? cat.title;
      opt.textContent = cat.localization?.title ?? cat.title ?? cat.slug;
      categorySelect.appendChild(opt);
    });
  } catch (_) { /* categories are nice-to-have */ }
}

/* ── Fetch series ──────────────────────────────────── */
async function fetchSeries() {
  grid.innerHTML = '<p style="color:var(--cr-muted);padding:2rem">Loading…</p>';
  resultsTitle.textContent = 'Loading series…';
  resultsCount.classList.add('hidden');
  emptyState.classList.add('hidden');
  loadMoreWrap.classList.add('hidden');

  const query    = searchInput.value.trim();
  const sort_by  = sortSelect.value;
  const category = categorySelect.value;

  const params = new URLSearchParams({ n: 100, start: 0, sort_by });
  if (query)    params.set('query', query);
  if (category) params.set('category', category);

  try {
    const res = await fetch(`/api/series?${params}`, {
      headers: { Authorization: authToken },
    });
    if (res.status === 401) { showLogin(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load series');

    allSeries = data.items ?? [];
    applyFilters();
  } catch (err) {
    grid.innerHTML = `<p style="color:#ff7070;padding:2rem">Error: ${err.message}</p>`;
    resultsTitle.textContent = 'Error loading series';
  }
}

/* ── Client-side filtering ─────────────────────────── */
function applyFilters() {
  const filterByRating = ratingCheck.checked;

  filteredSeries = allSeries.filter(item => {
    if (!filterByRating) return true;
    const rating = extractRating(item);
    return rating !== null && rating >= 4.4;
  });

  displayedCount = 0;
  grid.innerHTML = '';
  renderNextPage();

  const total = filteredSeries.length;
  resultsTitle.textContent = ratingCheck.checked
    ? `Series rated ≥ 4.4`
    : `Top ${allSeries.length} Series`;

  if (total > 0) {
    resultsCount.textContent = `${total} shown`;
    resultsCount.classList.remove('hidden');
    emptyState.classList.add('hidden');
  } else {
    resultsCount.classList.add('hidden');
    emptyState.classList.remove('hidden');
  }
}

function renderNextPage() {
  const batch = filteredSeries.slice(displayedCount, displayedCount + PAGE_SIZE);
  batch.forEach(item => grid.appendChild(buildCard(item)));
  displayedCount += batch.length;

  const hasMore = displayedCount < filteredSeries.length;
  loadMoreWrap.classList.toggle('hidden', !hasMore);
}

loadMoreBtn.addEventListener('click', renderNextPage);

/* ── Rating extraction ─────────────────────────────── */
function extractRating(item) {
  const candidates = [
    item.rating,
    item.series_metadata?.rating,
    item.metadata?.rating,
    item.search_metadata?.rating,
    item.panel?.series_metadata?.rating,
    item.panel?.rating,
  ];
  for (const v of candidates) {
    const n = parseFloat(v);
    if (!isNaN(n)) return n;
  }
  return null;
}

/* ── Card builder ──────────────────────────────────── */
function buildCard(item) {
  const panel = item.panel ?? item;
  const meta  = panel.series_metadata ?? panel.metadata ?? {};

  const title    = panel.title ?? item.title ?? 'Unknown';
  const slug     = panel.slug_title ?? item.slug_title ?? '';
  const provider = meta.content_provider ?? item.content_provider ?? '';
  const rating   = extractRating(item);

  // Image — prefer wide poster fallback to tall
  const posterArr = panel.images?.poster_tall ?? panel.images?.poster_wide ?? item.images?.poster_tall ?? item.images?.poster_wide ?? [];
  const imgSrc = posterArr[0]?.[0]?.source ?? posterArr[0]?.source ?? '';

  const card = document.createElement('div');
  card.className = 'series-card';
  card.innerHTML = `
    <div class="card-img-wrap">
      ${imgSrc
        ? `<img src="${imgSrc}" alt="${escHtml(title)}" loading="lazy" />`
        : `<div class="no-img">🎬</div>`}
      ${rating !== null
        ? `<div class="card-rating ${rating >= 4.4 ? 'high' : ''}">★ ${rating.toFixed(1)}</div>`
        : ''}
    </div>
    <div class="card-info">
      <div class="card-title">${escHtml(title)}</div>
      ${provider ? `<div class="card-provider">${escHtml(provider)}</div>` : ''}
    </div>
  `;
  card.addEventListener('click', () => openModal(item));
  return card;
}

/* ── Modal ─────────────────────────────────────────── */
const modalOverlay = document.getElementById('modal-overlay');
const modalClose   = document.getElementById('modal-close');

function openModal(item) {
  const panel = item.panel ?? item;
  const meta  = panel.series_metadata ?? panel.metadata ?? {};

  const title       = panel.title ?? item.title ?? '';
  const slug        = panel.slug_title ?? item.slug_title ?? '';
  const description = meta.extended_description ?? meta.short_description ?? panel.description ?? item.description ?? 'No description available.';
  const provider    = meta.content_provider ?? item.content_provider ?? '';
  const year        = meta.series_launch_year ?? meta.year ?? '';
  const genres      = meta.genres ?? item.genres ?? [];
  const rating      = extractRating(item);
  const posterArr   = panel.images?.poster_tall ?? panel.images?.poster_wide ?? item.images?.poster_tall ?? item.images?.poster_wide ?? [];
  const imgSrc      = posterArr[0]?.[0]?.source ?? posterArr[0]?.source ?? '';

  document.getElementById('modal-title').textContent    = title;
  document.getElementById('modal-desc').textContent     = description;
  document.getElementById('modal-provider').textContent = provider;
  document.getElementById('modal-year').textContent     = year ? `(${year})` : '';

  const ratingEl = document.getElementById('modal-rating');
  ratingEl.textContent = rating !== null ? `★ ${rating.toFixed(1)}` : '';
  ratingEl.style.display = rating !== null ? '' : 'none';

  const imgEl = document.getElementById('modal-img');
  if (imgSrc) { imgEl.src = imgSrc; imgEl.style.display = ''; }
  else { imgEl.style.display = 'none'; }

  const genresEl = document.getElementById('modal-genres');
  genresEl.innerHTML = genres.map(g => `<span class="genre-tag">${escHtml(g)}</span>`).join('');

  const linkEl = document.getElementById('modal-link');
  linkEl.href = slug ? `https://www.crunchyroll.com/series/${slug}` : 'https://www.crunchyroll.com';

  modalOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modalOverlay.classList.add('hidden');
  document.body.style.overflow = '';
}

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* ── Filter controls ───────────────────────────────── */
applyBtn.addEventListener('click', fetchSeries);
resetBtn.addEventListener('click', () => {
  searchInput.value  = '';
  sortSelect.value   = 'popularity';
  ratingCheck.checked = false;
  categorySelect.value = '';
  fetchSeries();
});

// Reapply rating filter without re-fetching
ratingCheck.addEventListener('change', applyFilters);

// Fetch on Enter in search box
searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchSeries(); });

/* ── Utility ───────────────────────────────────────── */
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Password toggle ───────────────────────────────── */
document.getElementById('toggle-password').addEventListener('click', () => {
  const input     = document.getElementById('password');
  const eyeOpen   = document.getElementById('eye-open');
  const eyeClosed = document.getElementById('eye-closed');
  const showing   = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  eyeOpen.classList.toggle('hidden', !showing);
  eyeClosed.classList.toggle('hidden', showing);
});

/* ── Boot ──────────────────────────────────────────── */
if (loadSession()) {
  showBrowse();
}
