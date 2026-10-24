const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.get('/health', (req, res) => {
  res.json({ ok: true, uptime_s: Math.round(process.uptime()) });
});

app.get('/api/validate', async (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(401).json({ error: 'License key required.' });

  try {
    const { data, error } = await supabase
      .from('licenses')
      .select('expires_at, active')
      .eq('key', key.trim())
      .maybeSingle();

    if (error) return res.status(500).json({ error: 'Database connection error' });
    if (!data || !data.active) return res.status(401).json({ error: 'Invalid key.' });

    const expiryDate = new Date(data.expires_at);
    if (expiryDate < new Date()) return res.status(401).json({ error: 'License expired.' });

    // If valid, tell the client to unlock
    return res.status(200).json({ valid: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.listen(process.env.PORT || 3000);
