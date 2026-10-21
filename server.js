const express = require('express');
const cors = require('cors');
const stockfish = require('stockfish');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const engine = stockfish();
let activeResponse = null;
let variants = {};

engine.onmessage = (line) => {
  if (!activeResponse || typeof line !== 'string') return;
  if (line.includes('multipv') && line.includes(' pv ')) {
    const multipvMatch = line.match(/multipv (\d+)/);
    const scoreMatch = line.match(/score (cp|mate) (-?\d+)/);
    const pvMatch = line.match(/ pv (.*)/);
    if (multipvMatch && scoreMatch && pvMatch) {
      const idx = parseInt(multipvMatch[1]) - 1;
      let evalScore = parseInt(scoreMatch[2]);
      if (scoreMatch[1] === 'mate') evalScore = evalScore > 0 ? 100 : -100;
      else evalScore = evalScore / 100;
      variants[idx] = { move: pvMatch[1].split(' ')[0], eval: evalScore };
    }
  } 
  else if (line.startsWith('bestmove')) {
    const cleanVariants = Object.values(variants).filter(v => v);
    activeResponse.json({ variants: cleanVariants });
    activeResponse = null; 
  }
};

app.get('/api/eval', async (req, res) => {
  const fen = req.query.fen;
  const key = req.query.key;

  if (!fen) return res.status(400).json({ error: 'No FEN' });
  if (!key) return res.status(401).json({ error: 'License key required.' });

  const { data, error } = await supabase.from('licenses').select('expires_at, active').eq('key', key).single();

  if (error || !data || !data.active) {
    return res.status(401).json({ error: 'Invalid license key.' });
  }

  const expiryDate = new Date(data.expires_at);
  if (expiryDate < new Date()) {
    return res.status(401).json({ error: 'License expired.' });
  }

  if (activeResponse) {
    engine.postMessage('stop');
    activeResponse.status(503).json({ error: 'Aborted' });
  }

  activeResponse = res;
  variants = {};

  engine.postMessage('stop');
  engine.postMessage('uci');
  
  // INCREASED TO 10
  engine.postMessage(`setoption name MultiPV value 10`);
  engine.postMessage('position fen ' + fen);
  engine.postMessage('go movetime 200'); 
});

app.listen(process.env.PORT || 3000);
