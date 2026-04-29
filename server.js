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

// Anonymous client (no secret needed)
const ANON_CLIENT_ID  = 'noaihdevm_6iyg0a8l0q';
const ANON_BASIC      = Buffer.from(`${ANON_CLIENT_ID}:`).toString('base64');
const CR_USER_AGENT   = 'Crunchyroll/ANDROIDTV/3.59.0_22338 (Android 13.0; en-US; TCL-S5400AF Build/TP1A.220624.014)';

// Server-side token cache
let tokenCache = { token: null, expiresAt: 0 };

async function getAnonToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const { data } = await axios.post(
    `${CR_AUTH_BASE}/auth/v1/token`,
    new URLSearchParams({ grant_type: 'client_credentials', scope: 'offline_access' }),
    {
      headers: {
        'Authorization':    `Basic ${ANON_BASIC}`,
        'Content-Type':     'application/x-www-form-urlencoded',
        'User-Agent':       CR_USER_AGENT,
        'ETP-Anonymous-ID': crypto.randomUUID(),
      },
    }
  );

  tokenCache = {
    token:     `${data.token_type} ${data.access_token}`,
    expiresAt: Date.now() + Math.max((data.expires_in - 60) * 1000, 0),
  };

  return tokenCache.token;
}

function crHeaders() {
  return { 'User-Agent': CR_USER_AGENT };
}

// Browse / search series
app.get('/api/series', async (req, res) => {
  const { start = 0, n = 100, sort_by = 'popularity', category = '', query = '' } = req.query;

  try {
    const auth = await getAnonToken();
    let endpoint, params;

    if (query) {
      endpoint = `${CR_CONTENT_BASE}/content/v2/discover/search`;
      params   = { q: query, n, start, locale: 'en-US', type: 'series' };
    } else {
      endpoint = `${CR_CONTENT_BASE}/content/v2/discover/browse`;
      params   = { n, start, sort_by, locale: 'en-US', type: 'series' };
      if (category) params.categories = category;
    }

    const { data } = await axios.get(endpoint, {
      params,
      headers: { Authorization: auth, ...crHeaders() },
    });

    const items = data.data ?? data.items ?? [];
    res.json({ total: data.total ?? items.length, items });
  } catch (err) {
    const status  = err.response?.status || 500;
    const message = err.response?.data?.message || err.message;
    res.status(status).json({ error: message });
  }
});

// Categories for filter dropdown
app.get('/api/categories', async (req, res) => {
  try {
    const auth      = await getAnonToken();
    const { data }  = await axios.get(`${CR_CONTENT_BASE}/content/v1/tenant_categories`, {
      params:  { locale: 'en-US' },
      headers: { Authorization: auth, ...crHeaders() },
    });
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// Fetch a single series by ID (used by Continue tab to check for new episodes)
app.get('/api/series-single', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });

  try {
    const auth     = await getAnonToken();
    const { data } = await axios.get(`${CR_CONTENT_BASE}/content/v2/cms/series/${id}`, {
      params:  { locale: 'en-US' },
      headers: { Authorization: auth, ...crHeaders() },
    });
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CrunchyBrowser → http://localhost:${PORT}`));
