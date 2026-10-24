const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const Stockfish = require('stockfish');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '512kb' }));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY 
);

// ─── SINGLE GLOBAL ENGINE ───────────────────────────────────────────
let engine = null;
let engineReady = false;
let engineBusy = false;
let currentResolve = null;
let messageBuffer = [];

function initEngine() {
  if (engine) return;
  engine = Stockfish(); // Stockfish 10 initializer
  
  engine.onmessage = (line) => {
    if (typeof line !== 'string') return;
    
    if (line === 'uciok') {
      engine.postMessage('setoption name MultiPV value 7');
      engine.postMessage('setoption name Threads value 1');
      engine.postMessage('setoption name Hash value 16');
      engine.postMessage('isready');
    }
    if (line === 'readyok') {
      engineReady = true;
      console.log('[engine] ready – MultiPV 7, max strength');
    }
    if (engineBusy) {
      messageBuffer.push(line);
      if (line.startsWith('bestmove')) {
        finishCalculation(line);
      }
    }
  };
  engine.postMessage('uci');
}

function finishCalculation(bestmoveLine) {
  engineBusy = false;
  const resolve = currentResolve;
  currentResolve = null;
  const lines = [...messageBuffer];
  messageBuffer = [];

  if (!resolve) return;

  const pvs = [];
  for (const l of lines) {
    if (l.startsWith('info') && l.includes(' multipv ')) {
      const m = l.match(/multipv (\d+)/);
      const s = l.match(/score (cp|mate) (-?\d+)/);
      const p = l.match(/ pv (.+)$/);
      if (m && s && p) {
        pvs[parseInt(m[1]) - 1] = {
          multipv: parseInt(m[1]),
          type: s[1],
          score: parseInt(s[2]),
          pv: p[1].trim()
        };
      }
    }
  }

  resolve({
    bestmove: bestmoveLine.split(' ')[1] || null,
    pvs: pvs.filter(Boolean)
  });
}

function abortEngine() {
  if (engine && engineBusy) {
    engine.postMessage('stop');
    engineBusy = false;
    messageBuffer = [];
    if (currentResolve) {
      currentResolve(null); 
      currentResolve = null;
    }
  }
}

initEngine();

// ─── API ────────────────────────────────────────────────────────────
app.post('/api/eval', async (req, res) => {
  const { fen, key } = req.body || {};
  if (!fen || !key) {
    return res.status(400).json({ error: 'fen and key required' });
  }

  // Auth
  const { data: lic, error } = await supabase
    .from('licenses')
    .select('active, expires_at')
    .eq('key', key)
    .maybeSingle();

  if (error || !lic || !lic.active || new Date(lic.expires_at) < new Date()) {
    return res.status(401).json({ error: 'invalid or expired key' });
  }

  if (!engineReady) {
    return res.status(503).json({ error: 'engine warming' });
  }

  // Abort any in-flight calculation
  abortEngine();

  engineBusy = true;
  messageBuffer = [];

  const result = await new Promise((resolve) => {
    currentResolve = resolve;
    
    // Stockfish 10 is fast enough that 200ms is plenty. No need for a custom timeout.
    engine.postMessage(`position fen ${fen}`);
    engine.postMessage('go movetime 200');
  });

  if (!result) {
    return res.status(504).json({ error: 'engine timeout / aborted' });
  }

  res.json({
    fen,
    bestmove: result.bestmove,
    pvs: result.pvs
  });
});

app.get('/health', (_, res) => {
  res.json({ status: 'ok', engine: engineReady, busy: engineBusy });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Chess overlay backend :${PORT}`));
