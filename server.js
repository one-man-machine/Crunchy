require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const CR_AUTH_BASE    = 'https://www.crunchyroll.com';
const CR_CONTENT_BASE = 'https://beta-api.crunchyroll.com';

// Current credentials from crunchyroll-rs v0.17.2 (updated April 2026)
const CLIENT_ID     = process.env.CR_CLIENT_ID     || 'y2arvjb0h0rgvtizlovy';
const CLIENT_SECRET = process.env.CR_CLIENT_SECRET || 'JVLvwdIpXvxU-qIBvT1M8oQTr1qlQJX2';
const BASIC_AUTH    = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

const CR_USER_AGENT = 'Crunchyroll/ANDROIDTV/3.59.0_22338 (Android 13.0; en-US; TCL-S5400AF Build/TP1A.220624.014)';

// Proxy login — keeps credentials server-side and avoids CORS
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const params = new URLSearchParams({
      grant_type:  'password',
      username:     email,
      password,
      scope:        'offline_access',
      device_id:    crypto.randomUUID(),
      device_type:  'com.crunchyroll.androidtv',
      device_name:  'CrunchyBrowser',
    });

    const { data } = await axios.post(`${CR_AUTH_BASE}/auth/v1/token`, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${BASIC_AUTH}`,
        'User-Agent':    CR_USER_AGENT,
      },
    });

    res.json({
      access_token: data.access_token,
      token_type:   data.token_type,
      expires_in:   data.expires_in,
      account_id:   data.account_id,
    });
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.error_description
      || err.response?.data?.message
      || err.message;
    res.status(status).json({ error: message });
  }
});

const CR_HEADERS = (authHeader) => ({
  'Authorization': authHeader,
  'User-Agent':    CR_USER_AGENT,
});

// Fetch up to 100 series, optionally sorted/filtered
app.get('/api/series', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Missing authorization token' });

  const {
    start = 0,
    n = 100,
    sort_by = 'popularity',
    category = '',
    query = '',
  } = req.query;

  try {
    let endpoint, params;

    if (query) {
      endpoint = `${CR_CONTENT_BASE}/content/v2/discover/search`;
      params = { q: query, n, start, locale: 'en-US', type: 'series' };
    } else {
      endpoint = `${CR_CONTENT_BASE}/content/v2/discover/browse`;
      params = { n, start, sort_by, locale: 'en-US', type: 'series' };
      if (category) params.categories = category;
    }

    const { data } = await axios.get(endpoint, {
      params,
      headers: CR_HEADERS(authHeader),
    });

    // Normalise the shape — search wraps items differently
    const items = data.data ?? data.items ?? [];
    res.json({ total: data.total ?? items.length, items });
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.message || err.message;
    res.status(status).json({ error: message });
  }
});

// Fetch categories list for the filter dropdown
app.get('/api/categories', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Missing authorization token' });

  try {
    const { data } = await axios.get(`${CR_CONTENT_BASE}/content/v1/tenant_categories`, {
      params: { locale: 'en-US' },
      headers: CR_HEADERS(authHeader),
    });
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Crunchy browser running → http://localhost:${PORT}`));
