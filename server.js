const express = require('express');
const cors = require('cors');
const stockfish = require('stockfish');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// Startup Connection Test
console.log("Testing Supabase Connection...");
console.log("URL starts with:", supabaseUrl ? supabaseUrl.substring(0, 15) : "MISSING");
if (supabaseUrl && supabaseUrl.includes('/rest/v1/')) {
    console.error("❌ ERROR: Your SUPABASE_URL contains /rest/v1/. You MUST remove it.");
}

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
    let finalMove = cleanVariants[0]; 
    
    const targetElo = activeResponse.locals.targetElo;
    if (targetElo < 1320 && cleanVariants.length > 1) {
        const blunderChance = ((1320 - targetElo) / 520) * 0.4;
        if (Math.random() < blunderChance) {
            const worseMoves = cleanVariants.slice(1);
            finalMove = worseMoves[Math.floor(Math.random() * worseMoves.length)];
        }
    }
    
    activeResponse.json({ variants: [finalMove] });
    activeResponse = null; 
  }
};

app.get('/api/eval', async (req, res) => {
  const fen = req.query.fen;
  const key = req.query.key;
  const targetElo = parseInt(req.query.elo) || 2800; 

  if (!fen) return res.status(400).json({ error: 'No FEN' });
  if (!key) return res.status(401).json({ error: 'License key required.' });

  console.log("Checking key:", key);

  try {
    const { data, error } = await supabase
      .from('licenses')
      .select('expires_at, active')
      .eq('key', key)
      .single();

    if (error) {
      console.error("SUPABASE REJECTED:", error.message);
      return res.status(401).json({ error: 'Supabase Error: ' + error.message });
    }
    
    if (!data) {
      console.error("KEY NOT FOUND IN DB");
      return res.status(401).json({ error: 'Key not found in database.' });
    }

    if (!data.active) {
      return res.status(401).json({ error: 'Key is disabled.' });
    }

    const expiryDate = new Date(data.expires_at);
    if (expiryDate < new Date()) {
      return res.status(401).json({ error: 'License expired.' });
    }

    // If valid, run engine
    if (activeResponse) {
      engine.postMessage('stop');
      activeResponse.status(503).json({ error: 'Aborted' });
    }

    activeResponse = res;
    activeResponse.locals.targetElo = targetElo;
    variants = {};

    engine.postMessage('stop');
    engine.postMessage('uci');
    
    const sfElo = Math.max(1320, targetElo);
    if (sfElo < 2800) {
      engine.postMessage('setoption name UCI_LimitStrength value true');
      engine.postMessage(`setoption name UCI_Elo value ${sfElo}`);
    } else {
      engine.postMessage('setoption name UCI_LimitStrength value false');
    }

    engine.postMessage(`setoption name MultiPV value 5`);
    engine.postMessage('position fen ' + fen);
    engine.postMessage('go movetime 200'); 
    
  } catch (err) {
    console.error("CRASH:", err.message);
    res.status(500).json({ error: 'Server crash: ' + err.message });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server is running on port 3000");
});;
