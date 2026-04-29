require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const CR_BASE = 'https://beta-api.crunchyroll.com';
const CLIENT_ID = process.env.CR_CLIENT_ID || 'noaihdevm_6iyg0a8l0q';
const CLIENT_SECRET = process.env.CR_CLIENT_SECRET || '1!nepGDioJIIBMFjUFQv8ZE9ZE0ZBezXNDCrH2UwkdVFi';
const BASIC_AUTH = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

// Proxy login — keeps credentials server-side and avoids CORS
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const params = new URLSearchParams({
      grant_type: 'password',
      username: email,
      password,
      scope: 'offline_access',
    });

    const { data } = await axios.post(`${CR_BASE}/auth/v1/token`, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${BASIC_AUTH}`,
      },
    });

    res.json({
      access_token: data.access_token,
      token_type: data.token_type,
      expires_in: data.expires_in,
      account_id: data.account_id,
    });
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.error_description
      || err.response?.data?.message
      || err.message;
    res.status(status).json({ error: message });
  }
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
      endpoint = `${CR_BASE}/content/v2/discover/search`;
      params = { q: query, n, start, locale: 'en-US', type: 'series' };
    } else {
      endpoint = `${CR_BASE}/content/v2/discover/browse`;
      params = { n, start, sort_by, locale: 'en-US', type: 'series' };
      if (category) params.categories = category;
    }

    const { data } = await axios.get(endpoint, {
      params,
      headers: { Authorization: authHeader },
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
    const { data } = await axios.get(`${CR_BASE}/content/v1/tenant_categories`, {
      params: { locale: 'en-US' },
      headers: { Authorization: authHeader },
    });
    res.json(data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Crunchy browser running → http://localhost:${PORT}`));
