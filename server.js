const express = require('express');
const cors = require('cors');
const stockfish = require('stockfish');

const app = express();
app.use(cors());

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

      variants[idx] = {
        move: pvMatch[1].split(' ')[0],
        eval: evalScore
      };
    }
  } 
  else if (line.startsWith('bestmove')) {
    const cleanVariants = Object.values(variants).filter(v => v);
    activeResponse.json({ variants: cleanVariants });
    activeResponse = null; 
  }
};

app.get('/api/eval', (req, res) => {
  const fen = req.query.fen;
  if (!fen) return res.status(400).json({ error: 'No FEN' });

  const multipv = parseInt(req.query.multipv) || 1;
  const targetElo = parseInt(req.query.elo) || 2800; // Default to max strength

  if (activeResponse) {
    engine.postMessage('stop');
    activeResponse.status(503).json({ error: 'Aborted' });
  }

  activeResponse = res;
  variants = {};

  engine.postMessage('stop');
  engine.postMessage('uci');
  
  if (targetElo < 2800) {
    engine.postMessage('setoption name UCI_LimitStrength value true');
    engine.postMessage(`setoption name UCI_Elo value ${targetElo}`);
  } else {
    engine.postMessage('setoption name UCI_LimitStrength value false');
  }

  engine.postMessage(`setoption name MultiPV value ${multipv}`);
  engine.postMessage('position fen ' + fen);
  
  // Give it a fixed time so it doesn't lag on mobile
  engine.postMessage('go movetime 200'); 
});

app.listen(process.env.PORT || 3000);
