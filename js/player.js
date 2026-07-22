import * as db from './firebase.js';
import { ROUND_MS, rankPlayers } from './logic.js';

const $ = s => document.querySelector(s);
let code=null, playerId=null, room=null, myAnswer={}, tick=null, qKey=null;

$('#joinBtn').onclick = async () => {
  const c = $('#code').value.trim().toUpperCase();
  const nick = $('#nick').value.trim();
  if (c.length!==6 || !nick) return;
  const res = await db.joinRoom(c, nick);
  if (!res) { $('#joinErr').classList.remove('hidden'); return; }
  code = c; playerId = res.playerId;
  $('#join').classList.add('hidden');
  $('#stage').classList.remove('hidden');
  db.subscribeRoom(code, r => { room = r; render(); });
};

function render() {
  const s = $('#stage');
  if (!room) return;
  if (room.state !== 'question') { clearInterval(tick); qKey = null; }
  if (room.state === 'waiting') {
    s.innerHTML = `<h2 class="center">입장 완료! 🎉</h2><p class="center">곧 시작해요. 잠시만 기다려 주세요…</p>`;
  } else if (room.state === 'question') {
    renderQuestion(s);
  } else if (room.state === 'reveal') {
    renderResult(s);
  } else if (room.state === 'ended') {
    renderFinal(s);
  }
}

function renderQuestion(s) {
  const idx = room.currentQ;
  const q = room.questions[idx];
  const answered = myAnswer[idx] !== undefined;
  const key = idx + ':' + (answered ? 'a' : 'q');
  if (key === qKey) return;   // skip incidental re-render (preserves typed input)
  qKey = key;
  if (answered) {
    s.innerHTML = `<h2 class="center">제출 완료! ✍️</h2><p class="center">다른 참가자를 기다리는 중…</p>`;
    return;
  }
  let controls = '';
  if (q.type==='mc') controls = `<div class="opts">${q.choices.map((c,j)=>`<button class="opt c${j+1}" data-pick="${j}">${escT(c)}</button>`).join('')}</div>`;
  else if (q.type==='ox') controls = `<div class="ox"><button class="ox-btn o" data-pick="O">O</button><button class="ox-btn x" data-pick="X">X</button></div>`;
  else controls = `<div class="row"><input id="shortIn" placeholder="정답 입력"><button class="btn" id="shortBtn">제출</button></div>`;
  s.innerHTML = `<div class="center" id="secDisplay" style="font-size:2rem">20</div>
    <h2 class="center">${escT(q.text)}</h2>${controls}`;
  s.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => submit(idx, q, b.dataset.pick));
  const sb = $('#shortBtn'); if (sb) sb.onclick = () => submit(idx, q, $('#shortIn').value);
  runCountdown();
}

function runCountdown() {
  clearInterval(tick);
  tick = setInterval(async () => {
    const now = await db.serverNow();
    const sec = Math.max(0, Math.ceil((ROUND_MS-(now-room.startedAt))/1000));
    const el = $('#secDisplay'); if (el) el.textContent = sec;
    if (sec<=0) {
      clearInterval(tick);
      document.querySelectorAll('[data-pick]').forEach(b => b.disabled = true);
      const si = document.getElementById('shortBtn'); if (si) si.disabled = true;
      const inp = document.getElementById('shortIn'); if (inp) inp.disabled = true;
    }
  }, 300);
}

async function submit(idx, q, rawValue) {
  if (myAnswer[idx] !== undefined) return;
  const value = q.type==='mc' ? Number(rawValue) : rawValue;
  myAnswer[idx] = value;        // lock synchronously, before any await
  clearInterval(tick);
  const now = await db.serverNow();
  await db.submitAnswer(code, idx, playerId, { value, answeredAt: now });
  render();
}

function renderResult(s) {
  const ranked = rankPlayers(room.players || {});
  const myRank = ranked.findIndex(r => r.id === playerId) + 1;
  const me = (room.players || {})[playerId] || {};
  s.innerHTML = `<h2 class="center">현재 내 점수</h2>
    <div class="center" style="font-size:3rem">${me.score||0}점</div>
    <p class="center">현재 순위: ${myRank}위 / ${ranked.length}명</p>
    <p class="center">다음 문제를 기다려 주세요…</p>`;
}

function renderFinal(s) {
  const ranked = rankPlayers(room.players || {});
  const myRank = ranked.findIndex(r => r.id === playerId) + 1;
  const me = (room.players || {})[playerId] || {};
  s.innerHTML = `<h1 class="center">🏁 끝!</h1>
    <div class="center" style="font-size:3rem">${myRank}위</div>
    <p class="center">${escT(me.nick)} · ${me.score||0}점</p>`;
}
function escT(s){ return String(s??'').replace(/</g,'&lt;'); }
