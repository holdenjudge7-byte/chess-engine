const express = require('express');
const cors = require('cors');
const stockfish = require('stockfish');

const app = express();
app.use(cors());

app.get('/api/eval', (req, res) => {
  const fen = req.query.fen;
  if (!fen) return res.status(400).json({ error: 'No FEN' });

  const engine = stockfish();
  let variants = {};

  engine.onmessage = (line) => {
    if (typeof line !== 'string') return;
    
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
      engine.terminate();
      const cleanVariants = Object.values(variants).filter(v => v);
      res.json({ variants: cleanVariants });
    }
  };

  engine.postMessage('uci');
  engine.postMessage('setoption name MultiPV value 3');
  engine.postMessage('position fen ' + fen);
  engine.postMessage('go depth 15'); 
});

app.listen(process.env.PORT || 3000);
