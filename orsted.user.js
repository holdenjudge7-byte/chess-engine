// ==UserScript==
// @name         Orsted Chess Overlay v14.1
// @namespace    orsted.chess.com.coach
// @version      14.1
// @description  True Human Mode with actual blunders
// @match        *://*.chess.com/*
// @grant        GM_xmlhttpRequest
// @connect      chess-engine-2-66am.onrender.com
// @connect      cdn.jsdelivr.net
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  if (window.orsted_started) return;
  window.orsted_started = true;

  const PANEL_ID = 'orsted-chess-panel';
  const SERVER_URL = 'https://chess-engine-2-66am.onrender.com';
  const CACHE_MAX = 20; 
  
  let panel = null;
  let lastFen = '';
  let currentFen = '';
  let currentMoves = [];
  let inFlight = false;
  let activeXHR = null;
  let apiCooldownUntil = 0; 
  
  let isMinimized = true; 
  let arrowCount = 1; 
  let currentMode = 'normal'; 
  
  let isDragging = false;
  let hasDragged = false;
  let dragStartX, dragStartY;
  let panelStartX, panelStartY;

  const fenCache = new Map();
  let ChessEngine = null;
  let GameInstance = null; 

  // ── PANEL & MENU ──────────────────────────────────────
  function buildPanel() {
    if (document.getElementById(PANEL_ID)) { panel = document.getElementById(PANEL_ID); return; }
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    
    panel.style.cssText = `
      position: fixed; top: 20px; right: 20px; width: auto;
      background: #312e2b; color: #e8e6e3; border: 1px solid #474440;
      border-radius: 6px; padding: 8px 12px; font-family: system-ui, sans-serif;
      font-size: 13px; z-index: 999999; box-shadow: 0 4px 20px rgba(0,0,0,.6);
      user-select: none; touch-action: none;
    `;
    
    panel.innerHTML = `
      <div id="kc-header" style="display:flex;justify-content:space-between;align-items:center;cursor:grab; touch-action:none;">
        <strong style="color:#81b64c; pointer-events:none;">orsted chess</strong>
        <span id="kc-toggle" style="cursor:pointer;color:#888;padding:0 5px;font-size:16px;font-weight:bold; pointer-events:auto;">+</span>
      </div>
      <div id="kc-content" style="display:none;">
        <div id="kc-settings" style="display:flex; flex-direction:column; gap:8px; margin-top:8px; margin-bottom:8px; font-size:12px; padding-bottom:6px; border-bottom:1px solid #474440;">
          
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <label>Mode:</label>
            <select id="kc-mode-select" style="background:#1b1b1b; color:#fff; border:1px solid #474440; border-radius:3px; padding:2px; outline:none;">
              <option value="normal">Normal (Best)</option>
              <option value="balance">Balance (Draw)</option>
              <option value="sandbag">Sandbag (Lose)</option>
              <option value="human">Human (Blunders)</option>
            </select>
          </div>

          <div id="kc-arrow-ui" style="display:flex; justify-content:space-between; align-items:center; transition: opacity 0.2s;">
            <label>Arrows:</label>
            <div style="display:flex; align-items:center; gap:10px;">
              <button id="kc-minus" style="background:#474440; color:#fff; border:none; border-radius:3px; width:24px; height:24px; font-weight:bold; cursor:pointer;">-</button>
              <span id="kc-arrow-count" style="min-width:12px; text-align:center; font-weight:bold;">1</span>
              <button id="kc-plus" style="background:#474440; color:#fff; border:none; border-radius:3px; width:24px; height:24px; font-weight:bold; cursor:pointer;">+</button>
            </div>
          </div>

        </div>
        <div id="kc-info" style="font-size:11px;color:#8b949e;margin-bottom:8px;"></div>
        <div id="kc-body">starting up…</div>
      </div>
    `;
    document.body.appendChild(panel);

    const header = document.getElementById('kc-header');
    const toggleBtn = document.getElementById('kc-toggle');
    const content = document.getElementById('kc-content');
    const btnMinus = document.getElementById('kc-minus');
    const btnPlus = document.getElementById('kc-plus');
    const countDisplay = document.getElementById('kc-arrow-count');
    const modeSelect = document.getElementById('kc-mode-select');
    const arrowUI = document.getElementById('kc-arrow-ui');

    modeSelect.addEventListener('change', (e) => {
      currentMode = e.target.value;
      const disableArrows = (currentMode !== 'normal');
      arrowUI.style.opacity = disableArrows ? '0.3' : '1';
      btnMinus.disabled = disableArrows;
      btnPlus.disabled = disableArrows;

      fenCache.clear();
      lastFen = '';
      if (currentBoardElement) tick();
    });

    const updateArrows = (val) => {
      if (currentMode !== 'normal') return;
      if (val < 1 || val > 3) return;
      arrowCount = val;
      countDisplay.textContent = arrowCount;
      fenCache.clear();
      lastFen = '';
      if (currentBoardElement) tick(); 
    };

    btnMinus.onclick = (e) => { e.stopPropagation(); updateArrows(arrowCount - 1); };
    btnPlus.onclick = (e) => { e.stopPropagation(); updateArrows(arrowCount + 1); };

    const startDrag = (e) => {
      if (e.target === toggleBtn || e.target === btnMinus || e.target === btnPlus || e.target === modeSelect) return;
      isDragging = true;
      hasDragged = false;
      
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      
      const rect = panel.getBoundingClientRect();
      dragStartX = clientX;
      dragStartY = clientY;
      panelStartX = rect.left;
      panelStartY = rect.top;
      
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.left = panelStartX + 'px';
      panel.style.top = panelStartY + 'px';
    };

    const moveDrag = (e) => {
      if (!isDragging) return;
      if (e.cancelable) e.preventDefault(); 
      
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      
      const dx = clientX - dragStartX;
      const dy = clientY - dragStartY;
      
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasDragged = true;
      
      panel.style.left = (panelStartX + dx) + 'px';
      panel.style.top = (panelStartY + dy) + 'px';
    };

    const endDrag = () => { if (!isDragging) return; isDragging = false; };

    header.addEventListener('touchstart', startDrag, { passive: true });
    header.addEventListener('touchmove', moveDrag, { passive: false });
    header.addEventListener('touchend', endDrag);
    header.addEventListener('mousedown', startDrag);
    window.addEventListener('mousemove', moveDrag);
    window.addEventListener('mouseup', endDrag);

    header.addEventListener('click', (e) => {
      if (e.target !== toggleBtn && hasDragged) return;
      isMinimized = !isMinimized;
      if (isMinimized) {
        content.style.display = 'none';
        toggleBtn.textContent = '+';
        panel.style.width = 'auto';
        panel.style.padding = '8px 12px';
      } else {
        content.style.display = 'block';
        toggleBtn.textContent = '−';
        panel.style.width = '280px';
        panel.style.padding = '12px';
      }
    });
  }

  function updatePanel(html, infoHtml) {
    if (!panel) return;
    const b = document.getElementById('kc-body');
    if (b && html !== undefined) b.innerHTML = html;
    if (infoHtml !== undefined) {
      const i = document.getElementById('kc-info');
      if (i) i.innerHTML = infoHtml;
    }
  }

  // ── CHESS LOGIC ───────────────────────────────────────
  function loadChessLogic() {
    GM_xmlhttpRequest({
      method: "GET",
      url: "https://cdn.jsdelivr.net/npm/chess.js@0.10.3/chess.min.js",
      onload: function(res) {
        try {
          const s = document.createElement('script');
          s.textContent = res.responseText;
          document.head.appendChild(s);
          s.remove();
          if (typeof Chess !== 'undefined') {
            ChessEngine = Chess;
            GameInstance = new ChessEngine(); 
          }
        } catch(e) {}
      }
    });
  }

  function readBoard() {
    try {
      const board = document.querySelector('chess-board') || document.querySelector('wc-chess-board');
      if (!board) return null;

      const isFlipped = board.classList.contains('flipped');
      const userColor = isFlipped ? 'Black' : 'White';
      const grid = Array(8).fill(null).map(() => Array(8).fill(''));
      
      const pieces = board.querySelectorAll('.piece');
      for(let i=0; i<pieces.length; i++) {
        const p = pieces[i];
        const cls = p.className.split(' ');
        const pieceClass = cls.find(c => /^[wb][pnbrqk]$/.test(c));
        if (!pieceClass) continue;
        const sqClass = cls.find(c => c.startsWith('square-'));
        if (!sqClass) continue;
        
        const sqNum = sqClass.split('-')[1]; 
        const file = parseInt(sqNum[0], 10) - 1; 
        const rank = parseInt(sqNum[1], 10) - 1; 
        const gridRank = 7 - rank; 

        let sym = pieceClass[1];
        if (pieceClass[0] === 'w') sym = sym.toUpperCase();
        if (file >= 0 && file < 8 && gridRank >= 0 && gridRank < 8) grid[gridRank][file] = sym;
      }

      let turn = 'w';
      if (document.querySelector('.clock-black.clock-player-turn')) turn = 'b';
      else if (!document.querySelector('.clock-white.clock-player-turn')) {
          const nodes = document.querySelectorAll('.move-list .node');
          if (nodes.length > 0) {
              turn = (nodes.length % 2 === 0) ? 'w' : 'b';
          }
      }

      return { grid, turn, userColor, isFlipped, board };
    } catch(e) { return null; }
  }

  function gridToFen(grid, turn) {
    if (!grid) return null;
    let wK = 0, bK = 0;
    const fenRanks = grid.map((row) => {
      let s = '', empty = 0;
      row.forEach((c) => {
        if (c === '') empty++;
        else { 
            if (c === 'K') wK++;
            if (c === 'k') bK++;
            if (empty) { s += empty; empty = 0; } 
            s += c; 
        }
      });
      if (empty) s += empty;
      return s;
    });
    if (wK !== 1 || bK !== 1) return null;
    return fenRanks.join('/') + ' ' + turn + ' - - 0 1';
  }

  // ── VISUAL HIGHLIGHTS ──────────────────────────────────
  function setupVisualLayer(boardElement) {
    if (getComputedStyle(boardElement).position === 'static') boardElement.style.position = 'relative';
    let svg = document.getElementById('orsted-layer');
    
    if (svg && svg.parentElement !== boardElement) {
        svg.remove();
        svg = null;
    }

    if (!svg) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'orsted-layer';
        svg.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none !important; z-index: 10;';
        svg.setAttribute('viewBox', '0 0 8 8');
        svg.innerHTML = `
            <defs>
                <marker id="arr-green" markerWidth="3" markerHeight="3" refX="2.5" refY="1.5" orient="auto"><polygon points="0 0, 3 1.5, 0 3" fill="#81b64c" /></marker>
                <marker id="arr-blue" markerWidth="3" markerHeight="3" refX="2.5" refY="1.5" orient="auto"><polygon points="0 0, 3 1.5, 0 3" fill="#4a90e2" /></marker>
                <marker id="arr-lightblue" markerWidth="3" markerHeight="3" refX="2.5" refY="1.5" orient="auto"><polygon points="0 0, 3 1.5, 0 3" fill="#00bcd4" /></marker>
                <marker id="arr-yellow" markerWidth="3" markerHeight="3" refX="2.5" refY="1.5" orient="auto"><polygon points="0 0, 3 1.5, 0 3" fill="#f1c40f" /></marker>
                <marker id="arr-orange" markerWidth="3" markerHeight="3" refX="2.5" refY="1.5" orient="auto"><polygon points="0 0, 3 1.5, 0 3" fill="#e67e22" /></marker>
                <marker id="arr-purple" markerWidth="3" markerHeight="3" refX="2.5" refY="1.5" orient="auto"><polygon points="0 0, 3 1.5, 0 3" fill="#9b59b6" /></marker>
                <marker id="arr-red" markerWidth="3" markerHeight="3" refX="2.5" refY="1.5" orient="auto"><polygon points="0 0, 3 1.5, 0 3" fill="#e74c3c" /></marker>
            </defs>
        `;
        boardElement.appendChild(svg);
    }
    return svg;
  }

  function drawHighlights(moves, isFlipped, boardElement, fen) {
    const svg = setupVisualLayer(boardElement);
    Array.from(svg.children).forEach(child => { if (child.tagName !== 'defs') child.remove(); });

    function sqToXY(sq) {
        let f = sq.charCodeAt(0) - 97, r = parseInt(sq[1], 10) - 1;
        return isFlipped ? { x: 7 - f + 0.5, y: r + 0.5 } : { x: f + 0.5, y: 7 - r + 0.5 };
    }

    moves.slice(0, arrowCount).forEach((m, index) => {
        if (!m.move || m.move.length < 4) return;
        let start = sqToXY(m.move.slice(0, 2));
        let end = sqToXY(m.move.slice(2, 4));
        
        let color = '#81b64c';
        let marker = 'arr-green';

        if (currentMode === 'balance') {
            if (Math.abs(m.eval) <= 0.5) { color = '#f1c40f'; marker = 'arr-yellow'; }
            else { color = '#e67e22'; marker = 'arr-orange'; }
        } else if (currentMode === 'sandbag') {
            color = '#9b59b6'; marker = 'arr-purple';
        } else if (currentMode === 'human') {
            if (m.eval < -3.0) { color = '#e74c3c'; marker = 'arr-red'; }
            else { color = '#1abc9c'; marker = 'arr-cyan'; }
        } else if (currentMode === 'normal') {
            color = index === 0 ? '#81b64c' : (index === 1 ? '#4a90e2' : '#00bcd4');
            marker = index === 0 ? 'arr-green' : (index === 1 ? 'arr-blue' : 'arr-lightblue');
        }
        
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', start.x); line.setAttribute('y1', start.y);
        line.setAttribute('x2', end.x);   line.setAttribute('y2', end.y);
        line.setAttribute('stroke', color); 
        line.setAttribute('stroke-width', '0.15');
        line.setAttribute('marker-end', `url(#${marker})`);
        svg.appendChild(line);
    });
  }

  function uciToSan(fen, uciArray) {
    if (!GameInstance) return uciArray;
    try {
      GameInstance.load(fen); 
      return uciArray.map(uci => {
        const move = GameInstance.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
        GameInstance.undo();
        return move ? move.san : uci;
      });
    } catch (e) { return uciArray; }
  }

  function cachePut(fen, moves) {
    fenCache.set(fen, moves);
    if (fenCache.size > CACHE_MAX) fenCache.delete(fenCache.keys().next().value);
  }

  function analyzeFen(fen, turn, userColor, isFlipped, boardElement) {
    if (!fen) return;
    
    if (Date.now() < apiCooldownUntil) return;
    if (fen === lastFen && (currentMoves.length || inFlight)) return;

    if (activeXHR) {
      activeXHR.abort();
      activeXHR = null;
      inFlight = false;
    }

    lastFen = fen;
    currentFen = fen;
    
    if (fenCache.has(fen)) {
        const cachedMoves = fenCache.get(fen);
        currentMoves = cachedMoves;
        renderResult(cachedMoves, turn, isFlipped, boardElement, fen);
        return; 
    }

    updatePanel('analyzing…', `You are <b>${userColor}</b> | Turn: <b>${turn === 'w' ? 'White' : 'Black'}</b>`);
    inFlight = true;

    let fetchMultiPV = arrowCount;
    if (currentMode === 'balance') fetchMultiPV = 3;
    if (currentMode === 'sandbag') fetchMultiPV = 5; 
    if (currentMode === 'human') fetchMultiPV = 5; 

    activeXHR = GM_xmlhttpRequest({
      method: "GET",
      url: `${SERVER_URL}/api/eval?fen=${encodeURIComponent(fen)}&multipv=${fetchMultiPV}`,
      timeout: 15000, 
      onload: function(response) {
        inFlight = false;
        activeXHR = null;
        try {
          const data = JSON.parse(response.responseText);
          
          if (data.variants && data.variants.length > 0) {
            const uciMoves = data.variants.map(v => v.move);
            const sans = uciToSan(fen, uciMoves);
            
            let finalMoves = data.variants.map((v, i) => {
              let evalScore = v.eval;
              if (turn === 'b') evalScore = -evalScore;
              return { move: v.move, text: sans[i], eval: evalScore };
            });

            if (currentMode === 'balance') {
                finalMoves.sort((a, b) => Math.abs(a.eval) - Math.abs(b.eval));
                finalMoves = [finalMoves[0]];
            } 
            else if (currentMode === 'sandbag') {
                finalMoves.sort((a, b) => a.eval - b.eval);
                let chosenMove = finalMoves[0]; 
                for (let m of finalMoves) {
                    if (m.eval > -6.0) {
                        chosenMove = m;
                        break;
                    }
                }
                finalMoves = [chosenMove];
            }
            else if (currentMode === 'human') {
                const bestEval = finalMoves[0].eval;
                
                let blunders = finalMoves.filter(m => (bestEval - m.eval) >= 1.5 && m.eval >= -6.0);
                let mistakes = finalMoves.filter(m => (bestEval - m.eval) >= 0.5 && (bestEval - m.eval) < 1.5 && m.eval >= -6.0);
                
                let r = Math.random();
                let chosen = finalMoves[0]; 
                
                if (r < 0.15 && blunders.length > 0) {
                    chosen = blunders[Math.floor(Math.random() * blunders.length)];
                } else if (r < 0.40 && mistakes.length > 0) {
                    chosen = mistakes[Math.floor(Math.random() * mistakes.length)];
                }
                
                finalMoves = [chosen];
            }
            else {
                finalMoves = finalMoves.slice(0, arrowCount);
            }

            cachePut(fen, finalMoves);
            currentMoves = finalMoves;
            renderResult(finalMoves, turn, isFlipped, boardElement, fen);
          } else {
            updatePanel('game over or no moves');
          }
        } catch (err) {
          updatePanel('parse error');
          apiCooldownUntil = Date.now() + 3000;
        }
      },
      onerror: function(err) { 
        inFlight = false; activeXHR = null; 
        updatePanel('server error — cooling down');
        apiCooldownUntil = Date.now() + 3000; 
      },
      ontimeout: function() {
        inFlight = false; activeXHR = null; 
        updatePanel('server timeout — cooling down');
        apiCooldownUntil = Date.now() + 2000;
      },
      onabort: function() {
        inFlight = false; activeXHR = null;
      }
    });
  }

  function renderResult(moves, turn, isFlipped, boardElement, fen) {
    if (!panel) return;
    let html = '';
    
    moves.forEach((v, index) => {
        let san = v.text || v.san || v.move || '?';
        let evalStr = "0.00", color = "#e8e6e3";
        if (v.eval !== undefined && v.eval !== null) {
            if (v.eval >= 100) evalStr = '+M';
            else if (v.eval <= -100) evalStr = '-M';
            else evalStr = v.eval > 0 ? '+' + v.eval.toFixed(2) : v.eval.toFixed(2);
            color = v.eval > 0 ? '#f8f8f8' : (v.eval < 0 ? '#a0a0a0' : '#8b949e');
        }

        let prefix = index === 0 ? '★' : '›';
        let fontWeight = index === 0 ? 'bold' : 'normal';
        let textColor = '#81b64c';

        if (currentMode === 'balance') {
            if (Math.abs(v.eval) <= 0.5) { textColor = '#f1c40f'; prefix = '⚖️'; }
            else { textColor = '#e67e22'; prefix = '⚠️'; }
        } else if (currentMode === 'sandbag') {
            textColor = '#9b59b6'; prefix = '🧪';
        } else if (currentMode === 'human') {
            if (v.eval < -3.0) { textColor = '#e74c3c'; prefix = '💀'; }
            else { textColor = '#1abc9c'; prefix = '👤'; }
        } else if (currentMode === 'normal') {
          textColor = index === 0 ? '#81b64c' : (index === 1 ? '#4a90e2' : '#00bcd4');
        }

        html += `
          <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-weight:${fontWeight};">
            <span style="color:${textColor};">${prefix} ${san}</span>
            <span style="color:${color}; font-size:12px;">${evalStr}</span>
          </div>
        `;
    });

    const bData = readBoard();
    updatePanel(html, `You are <b>${bData ? bData.userColor : '?'}</b> | Turn: <b>${turn === 'w' ? 'White' : 'Black'}</b>`);
    drawHighlights(moves, isFlipped, boardElement, fen);
  }

  let currentBoardElement = null;

  function tick() {
    try {
      const boardData = readBoard();
      if (!boardData) return;
      
      if (boardData.board !== currentBoardElement) {
          currentBoardElement = boardData.board;
      }
      
      const fen = gridToFen(boardData.grid, boardData.turn);
      if (!fen) return;
      
      if (fen === lastFen) return;
      
      analyzeFen(fen, boardData.turn, boardData.userColor, boardData.isFlipped, boardData.board);
    } catch(e) {}
  }

  function start() {
    buildPanel();
    loadChessLogic();
    setInterval(tick, 1000); 
  }

  start();

})();
