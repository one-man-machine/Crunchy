require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CR_AUTH_BASE    = 'https://www.crunchyroll.com';
const CR_CONTENT_BASE = 'https://beta-api.crunchyroll.com';
const CR_USER_AGENT   = 'Crunchyroll/ANDROIDTV/3.59.0_22338 (Android 13.0; en-US; TCL-S5400AF Build/TP1A.220624.014)';

// Login client credentials (crunchyroll-rs v0.17.2, April 2026)
const LOGIN_CLIENT_ID     = process.env.CR_CLIENT_ID     || 'y2arvjb0h0rgvtizlovy';
const LOGIN_CLIENT_SECRET = process.env.CR_CLIENT_SECRET || 'JVLvwdIpXvxU-qIBvT1M8oQTr1qlQJX2';
const LOGIN_BASIC         = Buffer.from(`${LOGIN_CLIENT_ID}:${LOGIN_CLIENT_SECRET}`).toString('base64');

// Anonymous client (fallback browsing, no secret)
const ANON_CLIENT_ID = 'noaihdevm_6iyg0a8l0q';
const ANON_BASIC     = Buffer.from(`${ANON_CLIENT_ID}:`).toString('base64');

// Server-side anonymous token cache
let anonCache = { token: null, expiresAt: 0 };

async function getAnonToken() {
  if (anonCache.token && Date.now() < anonCache.expiresAt) return anonCache.token;
  const { data } = await axios.post(
    `${CR_AUTH_BASE}/auth/v1/token`,
    new URLSearchParams({ grant_type: 'client_credentials', scope: 'offline_access' }),
    { headers: { Authorization: `Basic ${ANON_BASIC}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': CR_USER_AGENT, 'ETP-Anonymous-ID': crypto.randomUUID() } }
  );
  anonCache = { token: `${data.token_type} ${data.access_token}`, expiresAt: Date.now() + Math.max((data.expires_in - 60) * 1000, 0) };
  return anonCache.token;
}

function crHeaders(authToken) {
  return { Authorization: authToken, 'User-Agent': CR_USER_AGENT };
}

// ── Login ────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const { data } = await axios.post(
      `${CR_AUTH_BASE}/auth/v1/token`,
      new URLSearchParams({
        grant_type:  'password',
        username:     email,
        password,
        scope:        'offline_access',
        device_id:    crypto.randomUUID(),
        device_type:  'com.crunchyroll.androidtv',
        device_name:  'CrunchyBrowser',
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${LOGIN_BASIC}`,
          'User-Agent':    CR_USER_AGENT,
        },
      }
    );
    res.json({
      access_token: data.access_token,
      token_type:   data.token_type,
      expires_in:   data.expires_in,
      account_id:   data.account_id,
    });
  } catch (err) {
    const status  = err.response?.status || 500;
    const message = err.response?.data?.error_description || err.response?.data?.message || err.message;
    res.status(status).json({ error: message });
  }
});

// ── Browse / search ──────────────────────────────────────
app.get('/api/series', async (req, res) => {
  const { start = 0, n = 100, sort_by = 'popularity', category = '', query = '' } = req.query;
  const userAuth = req.headers.authorization;

  try {
    const auth = userAuth || await getAnonToken();
    let endpoint, params;

    if (query) {
      endpoint = `${CR_CONTENT_BASE}/content/v2/discover/search`;
      params   = { q: query, n, start, locale: 'en-US', type: 'series' };
    } else {
      endpoint = `${CR_CONTENT_BASE}/content/v2/discover/browse`;
      params   = { n, start, sort_by, locale: 'en-US', type: 'series' };
      if (category) params.categories = category;
    }

    const { data } = await axios.get(endpoint, { params, headers: crHeaders(auth) });
    const items = data.data ?? data.items ?? [];
    res.json({ total: data.total ?? items.length, items });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.message || err.message });
  }
});

// ── Batch ratings ────────────────────────────────────────
// Expects: GET /api/ratings?ids=id1,id2,...&accountId=xxx
// Authorization: Bearer <user_token>
app.get('/api/ratings', async (req, res) => {
  const { ids, accountId } = req.query;
  const userAuth = req.headers.authorization;
  if (!ids || !accountId || !userAuth) return res.status(400).json({ error: 'ids, accountId and Authorization required' });

  const idList = ids.split(',').filter(Boolean);

  // Fan out in parallel (Crunchyroll has been tolerant of ~50 concurrent)
  const results = await Promise.allSettled(
    idList.map(id =>
      axios.get(
        `${CR_CONTENT_BASE}/content-reviews/v2/user/${accountId}/rating/series/${id}`,
        { headers: crHeaders(userAuth) }
      ).then(r => ({ id, average: r.data?.average ?? null, total: r.data?.total ?? 0 }))
       .catch(() => ({ id, average: null, total: 0 }))
    )
  );

  const ratings = {};
  results.forEach(r => { if (r.status === 'fulfilled') ratings[r.value.id] = r.value; });
  res.json(ratings);
});

// ── Categories ───────────────────────────────────────────
app.get('/api/categories', async (req, res) => {
  const userAuth = req.headers.authorization;
  try {
    const auth     = userAuth || await getAnonToken();
    const { data } = await axios.get(`${CR_CONTENT_BASE}/content/v1/tenant_categories`, {
      params: { locale: 'en-US' }, headers: crHeaders(auth),
    });
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// ── Single series (Continue tab) ─────────────────────────
app.get('/api/series-single', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });
  const userAuth = req.headers.authorization;
  try {
    const auth     = userAuth || await getAnonToken();
    const { data } = await axios.get(`${CR_CONTENT_BASE}/content/v2/cms/series/${id}`, {
      params: { locale: 'en-US' }, headers: crHeaders(auth),
    });
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CrunchyBrowser → http://localhost:${PORT}`));
