import * as db from './firebase.js';
import { ROUND_MS, rankPlayers, checkAnswer } from './logic.js';

const $ = s => document.querySelector(s);
const SHAPES = ['▲', '◆', '●', '■'];
let code=null, playerId=null, room=null, myAnswer={}, tick=null, qKey=null;

// QR로 접속한 경우: 주소의 ?room=코드 를 자동 입력하고 닉네임에 커서
(function prefillFromUrl() {
  const preRoom = (new URLSearchParams(location.search).get('room') || '').trim().toUpperCase();
  if (preRoom) {
    $('#code').value = preRoom;
    $('#nick').focus();
  } else {
    $('#code').focus();
  }
})();

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
$('#nick').addEventListener('keydown', e => { if (e.key === 'Enter') $('#joinBtn').click(); });
$('#code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#nick').focus(); });

function render() {
  const s = $('#stage');
  if (!room) return;
  if (room.state !== 'question') { clearInterval(tick); qKey = null; }
  if (room.state === 'waiting') {
    s.innerHTML = `<div class="panel center stack">
      <div style="font-size:2.6rem">🎉</div>
      <h2>입장 완료!</h2>
      <p class="muted" style="margin:0">곧 시작해요. 잠시만 기다려 주세요…</p>
    </div>`;
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

  const me = (room.players || {})[playerId] || {};
  const head = `<div class="row">
      <span class="pill pill-primary">Q${idx + 1} / ${room.questions.length}</span>
      ${q.double ? '<span class="pill pill-amber">x2 점수</span>' : ''}
      <span class="spacer"></span>
      <strong class="muted">${me.score || 0}점</strong>
    </div>
    <div class="tbar" id="tbar"><i id="tfill" style="width:100%"></i></div>`;

  if (answered) {
    s.innerHTML = `<div class="panel stack" style="flex:1">
      ${head}
      <div class="spacer"></div>
      <h2 class="center">제출했어요</h2>
      <p class="center muted" style="margin:0">내가 고른 답</p>
      ${pickedMarkup(q, myAnswer[idx])}
      <p class="center muted" style="margin:0">다른 참가자를 기다리는 중…</p>
      <div class="spacer"></div>
    </div>`;
    runCountdown();
    return;
  }

  let controls = '';
  if (q.type === 'mc') {
    controls = `<div class="opts" style="flex:1">${q.choices.map((c, j) =>
      `<button class="choice c${j + 1}" data-pick="${j}">
         <span class="shape">${SHAPES[j]}</span><span>${escT(c)}</span>
       </button>`).join('')}</div>`;
  } else if (q.type === 'ox') {
    controls = `<div class="ox" style="flex:1">
      <button class="ox-btn o" data-pick="O">O</button>
      <button class="ox-btn x" data-pick="X">X</button></div>`;
  } else {
    controls = `<div class="stack">
      <input id="shortIn" placeholder="정답 입력">
      <button class="btn" id="shortBtn">제출</button></div>`;
  }

  s.innerHTML = `<div class="panel stack" style="flex:1">
    ${head}
    <h2>${escT(q.text)}</h2>
    ${controls}
  </div>`;
  s.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => submit(idx, q, b.dataset.pick));
  const sb = $('#shortBtn'); if (sb) sb.onclick = () => submit(idx, q, $('#shortIn').value);
  runCountdown();
}

// 고른 답을 그대로 보여 준다 — "내가 뭘 눌렀지?"를 없앤다
function pickedMarkup(q, value) {
  if (q.type === 'mc') {
    return `<div class="choice c${Number(value) + 1} picked">
      <span class="shape">${SHAPES[Number(value)]}</span><span>${escT(q.choices[Number(value)])}</span></div>`;
  }
  if (q.type === 'ox') {
    return `<div class="ox"><div class="ox-btn ${value === 'O' ? 'o picked' : 'o dim'}">O</div>
      <div class="ox-btn ${value === 'X' ? 'x picked' : 'x dim'}">X</div></div>`;
  }
  return `<div class="choice c1 picked"><span class="shape">✍</span><span>${escT(value) || '(빈 답)'}</span></div>`;
}

function runCountdown() {
  clearInterval(tick);
  tick = setInterval(async () => {
    const now = await db.serverNow();
    const remain = Math.max(0, ROUND_MS - (now - room.startedAt));
    const sec = Math.ceil(remain / 1000);
    const bar = document.getElementById('tbar');
    const fill = document.getElementById('tfill');
    if (fill) fill.style.width = (remain / ROUND_MS * 100) + '%';
    if (bar) {
      bar.classList.toggle('warn', sec <= 10 && sec > 5);
      bar.classList.toggle('urgent', sec <= 5);
    }
    if (remain <= 0) {
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
  const idx = room.currentQ;
  const q = room.questions[idx];
  const ranked = rankPlayers(room.players || {});
  const myRank = ranked.findIndex(r => r.id === playerId) + 1;
  const me = (room.players || {})[playerId] || {};
  const myAns = ((room.answers || {})[idx] || {})[playerId];
  const correct = myAns !== undefined && checkAnswer(q, myAns.value);
  const answerText = q.type === 'mc' ? q.choices[q.answer]
                   : q.type === 'ox' ? q.answer
                   : (q.accepted || [q.answer]).join(' / ');

  s.innerHTML = `<div class="feedback ${correct ? 'ok' : 'no'}">
    <div class="mark">${correct ? '✓' : '✗'}</div>
    <div style="font-size:1.8rem;font-weight:900">${correct ? '정답!' : '아쉬워요'}</div>
    ${correct ? '' : `<div style="font-weight:700">정답은 <b>${escT(answerText)}</b></div>`}
    <span class="pill">누적 ${myRank}위 · ${me.score || 0}점</span>
    <div style="color:rgba(255,255,255,.85)">다음 문제를 기다려 주세요</div>
  </div>`;
}

function renderFinal(s) {
  const ranked = rankPlayers(room.players || {});
  const myRank = ranked.findIndex(r => r.id === playerId) + 1;
  const me = (room.players || {})[playerId] || {};
  const medal = myRank === 1 ? '🥇' : myRank === 2 ? '🥈' : myRank === 3 ? '🥉' : '🎉';
  s.innerHTML = `<div class="stack" style="flex:1;justify-content:center">
    <p class="center muted" style="margin:0;font-weight:700">내 최종 결과</p>
    <div class="result-card">
      <div style="font-size:2.2rem">${medal}</div>
      <div class="rank">${myRank}위</div>
      <div class="muted">${ranked.length}명 중</div>
      <hr>
      <div style="font-size:1.3rem;font-weight:900">${escT(me.nick)}</div>
      <div class="row" style="justify-content:center;margin-top:12px">
        <span class="pill">${me.score || 0}점</span>
      </div>
    </div>
    <p class="center muted" style="margin:0">수고하셨어요!</p>
  </div>`;
}
function escT(s){ return String(s??'').replace(/</g,'&lt;'); }
