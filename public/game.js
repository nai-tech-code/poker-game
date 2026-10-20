'use strict';

// ---------- constants ----------
const SB = 10;
const BB = 20;
const START_CHIPS = 1000;
const AI_DELAY = 750;
const SUITS = ['♠', '♥', '♦', '♣'];
const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 10: '10' };
const HAND_NAMES = ['高牌', '一對', '兩對', '三條', '順子', '同花', '葫蘆', '四條', '同花順'];
const STREET_NAMES = ['翻牌前', '翻牌', '轉牌', '河牌'];
const SEATS = [
  { name: '你', human: true, pos: 'bottom', x: 50, y: 88 },
  { name: '小明', pos: 'left', x: 9, y: 50 },
  { name: '阿華', pos: 'top', x: 50, y: 11 },
  { name: '老王', pos: 'right', x: 91, y: 50 },
];

// ---------- cards & hand evaluation ----------
const cardLabel = (c) => (RANK_LABEL[c.r] ?? String(c.r)) + SUITS[c.s];

function newDeck() {
  const d = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) d.push({ r, s });
  return shuffle(d);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Score of exactly five cards: [category, ...tiebreakers]; higher compares better.
function eval5(cards) {
  const rs = cards.map((c) => c.r).sort((a, b) => b - a);
  const flush = cards.every((c) => c.s === cards[0].s);
  let straightHigh = 0;
  if (new Set(rs).size === 5) {
    if (rs[0] - rs[4] === 4) straightHigh = rs[0];
    else if (rs[0] === 14 && rs[1] === 5) straightHigh = 5; // A-2-3-4-5
  }
  const counts = {};
  for (const r of rs) counts[r] = (counts[r] ?? 0) + 1;
  const groups = Object.entries(counts)
    .map(([r, n]) => [n, Number(r)])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const order = groups.map((g) => g[1]);

  if (straightHigh && flush) return [8, straightHigh];
  if (groups[0][0] === 4) return [7, ...order];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6, ...order];
  if (flush) return [5, ...rs];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][0] === 3) return [3, ...order];
  if (groups[0][0] === 2 && groups[1][0] === 2) return [2, ...order];
  if (groups[0][0] === 2) return [1, ...order];
  return [0, ...rs];
}

function compareScores(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

// Best five-card score out of 5–7 cards, plus the cards that make it.
function bestHand(cards) {
  let top = null;
  let topCards = null;
  const pick = [];
  const walk = (start) => {
    if (pick.length === 5) {
      const s = eval5(pick);
      if (!top || compareScores(s, top) > 0) { top = s; topCards = pick.slice(); }
      return;
    }
    for (let i = start; i <= cards.length - (5 - pick.length); i++) {
      pick.push(cards[i]);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return { score: top, cards: topCards };
}

// Monte Carlo win probability of `hole` against `opponents` random hands.
function equity(hole, board, opponents, iterations = 250) {
  const known = new Set([...hole, ...board].map((c) => c.r * 4 + c.s));
  const rest = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) if (!known.has(r * 4 + s)) rest.push({ r, s });
  const boardNeed = 5 - board.length;
  const need = boardNeed + opponents * 2;
  let wins = 0;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(Math.random() * (rest.length - i));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    const fullBoard = board.concat(rest.slice(0, boardNeed));
    const mine = bestHand(hole.concat(fullBoard)).score;
    let lost = false;
    let ties = 0;
    for (let o = 0; o < opponents; o++) {
      const k = boardNeed + o * 2;
      const c = compareScores(bestHand([rest[k], rest[k + 1], ...fullBoard]).score, mine);
      if (c > 0) { lost = true; break; }
      if (c === 0) ties++;
    }
    if (!lost) wins += 1 / (ties + 1);
  }
  return wins / iterations;
}

// ---------- game state ----------
let S;

function newGame() {
  S = {
    players: SEATS.map((seat, i) => ({
      ...seat, id: i, chips: START_CHIPS, hand: [], bet: 0, total: 0,
      folded: false, allIn: false, out: false, lastAction: '', winner: false,
    })),
    dealer: Math.floor(Math.random() * SEATS.length),
    deck: [], board: [], street: 0,
    currentBet: 0, minRaise: BB,
    pending: new Set(), toAct: -1,
    phase: 'idle', // 'betting' | 'runout' | 'handover' | 'gameover'
    handNo: 0, handToken: 0, showAll: false, highlight: [], message: '',
  };
  document.getElementById('log').innerHTML = '';
  startHand();
}

const human = () => S.players[0];
const canAct = (p) => !p.out && !p.folded && !p.allIn;
const livePlayers = () => S.players.filter((p) => !p.out && !p.folded);
const potTotal = () => S.players.reduce((sum, p) => sum + p.total, 0);

function nextIndex(from, pred) {
  const n = S.players.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (pred(i)) return i;
  }
  return -1;
}

function commit(p, amount) {
  const a = Math.max(0, Math.min(amount, p.chips));
  p.chips -= a;
  p.bet += a;
  p.total += a;
  if (p.chips === 0) p.allIn = true;
  return a;
}

function startHand() {
  for (const p of S.players) {
    if (p.chips <= 0) p.out = true;
    Object.assign(p, { hand: [], bet: 0, total: 0, folded: p.out, allIn: false, lastAction: '', winner: false });
  }
  const active = S.players.filter((p) => !p.out);
  if (human().out) return gameOver('你的籌碼輸光了，遊戲結束。');
  if (active.length === 1) return gameOver('恭喜！你贏走了桌上所有籌碼 🏆');

  S.handNo++;
  S.handToken++;
  S.board = [];
  S.street = 0;
  S.showAll = false;
  S.highlight = [];
  S.message = '';
  S.deck = newDeck();
  S.dealer = nextIndex(S.dealer, (i) => !S.players[i].out);

  const isActive = (i) => !S.players[i].out;
  let sbI, bbI;
  if (active.length === 2) {
    sbI = S.dealer;
    bbI = nextIndex(sbI, isActive);
  } else {
    sbI = nextIndex(S.dealer, isActive);
    bbI = nextIndex(sbI, isActive);
  }
  log(`第 ${S.handNo} 手 · 莊家：${S.players[S.dealer].name}`, 'hand');
  commit(S.players[sbI], SB);
  S.players[sbI].lastAction = `小盲 ${S.players[sbI].bet}`;
  commit(S.players[bbI], BB);
  S.players[bbI].lastAction = `大盲 ${S.players[bbI].bet}`;
  S.currentBet = Math.max(...S.players.map((p) => p.bet));
  S.minRaise = BB;

  for (let round = 0; round < 2; round++) {
    for (const p of S.players) if (!p.out) p.hand.push(S.deck.pop());
  }
  log(`你的手牌：${human().hand.map(cardLabel).join(' ')}`);

  S.phase = 'betting';
  S.pending = new Set(S.players.filter(canAct).map((p) => p.id));
  S.toAct = bbI;
  advance();
}

function act(i, type, raiseTo = 0) {
  if (S.phase !== 'betting' || S.toAct !== i) return;
  const p = S.players[i];
  const toCall = S.currentBet - p.bet;

  if (type === 'fold') {
    p.folded = true;
    p.lastAction = '棄牌';
  } else if (type === 'check' || (type === 'call' && toCall <= 0)) {
    p.lastAction = '過牌';
  } else if (type === 'call') {
    const paid = commit(p, toCall);
    p.lastAction = p.allIn ? `全下 ${paid}` : `跟注 ${paid}`;
  } else if (type === 'raise') {
    const target = Math.min(raiseTo, p.bet + p.chips);
    const increase = target - S.currentBet;
    commit(p, target - p.bet);
    if (increase > 0) {
      if (increase >= S.minRaise) S.minRaise = increase;
      S.currentBet = p.bet;
      S.pending = new Set(S.players.filter((q) => canAct(q) && q.id !== i).map((q) => q.id));
      p.lastAction = p.allIn ? `全下 ${p.bet}` : `加注到 ${p.bet}`;
    } else {
      p.lastAction = p.allIn ? `全下 ${p.bet}` : `跟注`;
    }
  }
  S.pending.delete(i);
  log(`${p.name}：${p.lastAction}`);
  advance();
}

function advance() {
  const live = livePlayers();
  if (live.length === 1) return winUncontested(live[0]);
  if (S.pending.size === 0) return nextStreet();
  S.toAct = nextIndex(S.toAct, (i) => S.pending.has(i));
  render();
  if (!S.players[S.toAct].human) {
    const token = S.handToken;
    const who = S.toAct;
    setTimeout(() => { if (S.handToken === token && S.toAct === who) aiAct(who); }, AI_DELAY);
  }
}

function nextStreet() {
  for (const p of S.players) { p.bet = 0; if (canAct(p)) p.lastAction = ''; }
  S.currentBet = 0;
  S.minRaise = BB;
  if (S.street === 3) return showdown();

  S.street++;
  S.deck.pop(); // burn
  const count = S.street === 1 ? 3 : 1;
  for (let k = 0; k < count; k++) S.board.push(S.deck.pop());
  log(`${STREET_NAMES[S.street]}：${S.board.map(cardLabel).join(' ')}`);

  const actors = S.players.filter(canAct);
  if (actors.length <= 1) {
    // No more betting possible: reveal the remaining board with a short pause.
    S.phase = 'runout';
    S.showAll = true;
    render();
    const token = S.handToken;
    setTimeout(() => { if (S.handToken === token) nextStreet(); }, 1000);
    return;
  }
  S.pending = new Set(actors.map((p) => p.id));
  S.toAct = S.dealer;
  advance();
}

function buildPots() {
  const levels = [...new Set(S.players.filter((p) => !p.folded && p.total > 0).map((p) => p.total))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of S.players) amount += Math.min(p.total, level) - Math.min(p.total, prev);
    const eligible = S.players.filter((p) => !p.folded && p.total >= level);
    if (amount > 0) pots.push({ amount, eligible });
    prev = level;
  }
  const extra = S.players.reduce((sum, p) => sum + Math.max(0, p.total - prev), 0);
  if (extra && pots.length) pots[pots.length - 1].amount += extra;
  return pots;
}

function showdown() {
  S.phase = 'handover';
  S.showAll = true;
  const results = new Map();
  for (const p of livePlayers()) results.set(p.id, bestHand(p.hand.concat(S.board)));
  for (const p of livePlayers()) {
    log(`${p.name} 亮牌 ${p.hand.map(cardLabel).join(' ')} → ${HAND_NAMES[results.get(p.id).score[0]]}`);
  }

  const won = new Map();
  for (const pot of buildPots()) {
    let best = null;
    let winners = [];
    for (const p of pot.eligible) {
      const s = results.get(p.id).score;
      const c = best ? compareScores(s, best) : 1;
      if (c > 0) { best = s; winners = [p]; } else if (c === 0) winners.push(p);
    }
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    for (const w of winners) {
      const amt = share + (remainder-- > 0 ? 1 : 0);
      w.chips += amt;
      won.set(w.id, (won.get(w.id) ?? 0) + amt);
    }
  }

  const parts = [];
  S.highlight = [];
  for (const [id, amt] of won) {
    const p = S.players[id];
    p.winner = true;
    p.lastAction = `贏得 ${amt}`;
    const res = results.get(id);
    parts.push(`${p.name} 以${HAND_NAMES[res.score[0]]}贏得 ${amt}`);
    S.highlight.push(...res.cards);
  }
  S.message = parts.join('；');
  log(S.message, 'win');
  for (const p of S.players) p.total = 0;
  render();
}

function winUncontested(p) {
  const pot = potTotal();
  p.chips += pot;
  p.winner = true;
  p.lastAction = `贏得 ${pot}`;
  for (const q of S.players) { q.total = 0; q.bet = 0; }
  S.phase = 'handover';
  S.message = `${p.name} 贏得底池 ${pot}（其他人都棄牌）`;
  log(S.message, 'win');
  render();
}

function gameOver(msg) {
  S.phase = 'gameover';
  S.message = msg;
  log(msg, 'win');
  render();
}

// ---------- AI ----------
function aiAct(i) {
  const p = S.players[i];
  const toCall = S.currentBet - p.bet;
  const opponents = Math.max(1, livePlayers().length - 1);
  const eq = equity(p.hand, S.board, opponents);
  const pot = potTotal();
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const strength = eq * (opponents + 1) + (Math.random() - 0.5) * 0.3; // 1.0 ≈ average hand
  const minTo = S.currentBet + S.minRaise;
  const maxTo = p.bet + p.chips;

  const raiseTo = (fraction) => {
    const size = Math.max(S.minRaise, Math.round((pot * fraction) / 10) * 10);
    return Math.min(maxTo, S.currentBet + size);
  };

  if (strength > 1.9 && maxTo > S.currentBet) {
    return act(i, 'raise', strength > 2.5 && Math.random() < 0.3 ? maxTo : raiseTo(0.75));
  }
  if (toCall <= 0) {
    if (strength > 1.3 && Math.random() < 0.55) return act(i, 'raise', raiseTo(0.5));
    if (Math.random() < 0.07 && maxTo >= minTo) return act(i, 'raise', raiseTo(0.5)); // occasional bluff
    return act(i, 'check');
  }
  if (strength > 1.4 && maxTo >= minTo && Math.random() < 0.35) return act(i, 'raise', raiseTo(0.6));
  if (eq > potOdds + 0.03 || (toCall <= BB && strength > 0.7)) return act(i, 'call');
  return act(i, 'fold');
}

// ---------- rendering ----------
const $ = (id) => document.getElementById(id);

function cardEl(card, faceUp, highlight = false) {
  const el = document.createElement('div');
  if (!faceUp) {
    el.className = 'card back';
    return el;
  }
  el.className = 'card' + (card.s === 1 || card.s === 2 ? ' red' : '') + (highlight ? ' hl' : '');
  el.innerHTML = `<span class="r">${RANK_LABEL[card.r] ?? card.r}</span><span class="s">${SUITS[card.s]}</span>`;
  return el;
}

const isHighlighted = (c) => S.highlight.some((h) => h.r === c.r && h.s === c.s);

function render() {
  $('blinds').textContent = `${SB}/${BB}`;
  $('handNo').textContent = S.handNo;
  $('pot').textContent = `底池 ${potTotal()}`;
  $('message').textContent = S.message || (S.phase === 'betting' ? `${STREET_NAMES[S.street]} · 輪到 ${S.players[S.toAct].name}` : '');

  const board = $('board');
  board.innerHTML = '';
  for (const c of S.board) board.appendChild(cardEl(c, true, isHighlighted(c)));

  const seats = $('seats');
  seats.innerHTML = '';
  for (const p of S.players) {
    const el = document.createElement('div');
    el.className = 'seat' +
      (S.phase === 'betting' && S.toAct === p.id ? ' active' : '') +
      (p.folded && !p.out ? ' folded' : '') + (p.out ? ' out' : '') + (p.winner ? ' winner' : '');
    el.dataset.pos = p.pos;
    el.style.left = p.x + '%';
    el.style.top = p.y + '%';
    const dealer = S.dealer === p.id ? '<span class="dealer">D</span>' : '';
    el.innerHTML = `<div class="name">${p.name}${dealer}</div><div class="chips">💰 ${p.chips}</div>`;
    const hand = document.createElement('div');
    hand.className = 'hand';
    const showFace = p.human || (S.showAll && !p.folded);
    for (const c of p.hand) hand.appendChild(cardEl(c, showFace, S.showAll && isHighlighted(c)));
    el.appendChild(hand);
    const action = document.createElement('div');
    action.className = 'action';
    action.textContent = p.out ? '已出局' : p.allIn && !p.lastAction ? '全下' : p.lastAction;
    el.appendChild(action);
    if (p.bet > 0) {
      const bet = document.createElement('div');
      bet.className = 'bet';
      bet.textContent = `● ${p.bet}`;
      el.appendChild(bet);
    }
    seats.appendChild(el);
  }
  renderControls();
}

function renderControls() {
  const me = human();
  const myTurn = S.phase === 'betting' && S.toAct === me.id;
  const toCall = S.currentBet - me.bet;
  const maxTo = me.bet + me.chips;
  const minTo = Math.min(maxTo, S.currentBet + S.minRaise);

  for (const id of ['btnFold', 'btnCall', 'btnAllIn', 'btnRaise', 'raiseRange', 'raiseInput']) $(id).disabled = !myTurn;
  document.querySelectorAll('[data-size]').forEach((b) => { b.disabled = !myTurn; });
  $('btnNext').classList.toggle('hidden', S.phase !== 'handover' && S.phase !== 'gameover');
  $('btnNext').textContent = S.phase === 'gameover' ? '再玩一次' : '下一手';

  $('btnCall').textContent = toCall > 0 ? `跟注 ${Math.min(toCall, me.chips)}` : '過牌';
  $('btnRaise').textContent = S.currentBet > 0 ? '加注到' : '下注';
  const canRaise = myTurn && maxTo > S.currentBet;
  $('btnRaise').disabled = !canRaise;
  $('raiseRange').disabled = !canRaise;
  $('raiseInput').disabled = !canRaise;
  document.querySelectorAll('[data-size]').forEach((b) => { b.disabled = !canRaise; });

  if (myTurn) {
    const range = $('raiseRange');
    range.min = minTo;
    range.max = maxTo;
    $('raiseInput').min = minTo;
    $('raiseInput').max = maxTo;
    if (!range.dataset.token || range.dataset.token !== `${S.handToken}-${S.street}-${S.currentBet}`) {
      range.dataset.token = `${S.handToken}-${S.street}-${S.currentBet}`;
      range.value = minTo;
      $('raiseInput').value = minTo;
    }
  }
}

function log(text, cls = '') {
  const li = document.createElement('li');
  li.textContent = text;
  if (cls) li.className = cls;
  const list = $('log');
  list.appendChild(li);
  list.scrollTop = list.scrollHeight;
}

// ---------- input ----------
function clampRaise(v) {
  const me = human();
  const maxTo = me.bet + me.chips;
  const minTo = Math.min(maxTo, S.currentBet + S.minRaise);
  const n = Math.round(Number(v) || 0);
  return Math.max(minTo, Math.min(maxTo, n));
}

$('btnFold').onclick = () => act(0, 'fold');
$('btnCall').onclick = () => act(0, S.currentBet > human().bet ? 'call' : 'check');
$('btnAllIn').onclick = () => {
  const me = human();
  if (me.bet + me.chips > S.currentBet) act(0, 'raise', me.bet + me.chips);
  else act(0, 'call');
};
$('btnRaise').onclick = () => act(0, 'raise', clampRaise($('raiseInput').value));
$('raiseRange').oninput = (e) => { $('raiseInput').value = e.target.value; };
$('raiseInput').onchange = (e) => {
  const v = clampRaise(e.target.value);
  e.target.value = v;
  $('raiseRange').value = v;
};
document.querySelectorAll('[data-size]').forEach((b) => {
  b.onclick = () => {
    const v = clampRaise(S.currentBet + potTotal() * Number(b.dataset.size));
    $('raiseInput').value = v;
    $('raiseRange').value = v;
  };
});
$('btnNext').onclick = () => (S.phase === 'gameover' ? newGame() : startHand());
$('newGame').onclick = () => { if (confirm('重新開始新遊戲？')) newGame(); };
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'f') $('btnFold').click();
  else if (e.key === 'c') $('btnCall').click();
  else if (e.key === 'r') $('btnRaise').click();
  else if (e.key === 'Enter' && !$('btnNext').classList.contains('hidden')) $('btnNext').click();
});

newGame();
