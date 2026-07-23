import * as db from './firebase.js';
import { checkAnswer, calcScore, rankPlayers, ROUND_MS } from './logic.js';
import { startMusic, stopMusic, setUrgent, toggleMute, playVictory } from './music.js';

const ADMIN_PASSWORD = 'quiz2026'; // README 2절 참고 — 원하는 값으로 변경

const views = ['gate', 'list', 'editor', 'host'];
function showView(id) {
  views.forEach(v => document.getElementById(v).classList.toggle('hidden', v !== id));
}
const $ = s => document.querySelector(s);

// ---- 배경음악 음소거 토글 ----
$('#muteBtn').onclick = () => { $('#muteBtn').textContent = toggleMute() ? '🔇' : '🔊'; };

// ---- 암호 게이트 ----
$('#pwBtn').onclick = () => {
  if ($('#pw').value === ADMIN_PASSWORD) { openList(); }
  else { $('#pwErr').classList.remove('hidden'); }
};
$('#pw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#pwBtn').click(); });

// ---- 퀴즈쇼 목록 ----
async function openList() {
  showView('list');
  const quizzes = await db.listQuizzes();
  const box = $('#quizList');
  box.innerHTML = quizzes.length ? '' : '<p>아직 만든 퀴즈쇼가 없어요.</p>';
  quizzes.forEach(q => {
    const row = document.createElement('div');
    row.className = 'leader-row';
    row.innerHTML = `<span>${esc(q.title || '(제목 없음)')} · ${(q.questions||[]).length}문항</span>`;
    const actions = document.createElement('div');
    const play = mkBtn('▶ 진행', () => startHosting(q));
    const edit = mkBtn('✏️', () => openEditor(q));
    const del  = mkBtn('🗑', async () => { if (confirm('삭제할까요?')) { await db.deleteQuiz(q.id); openList(); } });
    actions.append(play, edit, del);
    row.append(actions);
    box.append(row);
  });
}
function mkBtn(label, fn) { const b = document.createElement('button'); b.className='btn'; b.style.marginLeft='6px'; b.textContent=label; b.onclick=fn; return b; }
$('#newQuizBtn').onclick = () => openEditor({ title:'', questions:[] });
$('#backToList').onclick = openList;

// ---- 편집기 ----
let draft = null;
function openEditor(quiz) {
  draft = JSON.parse(JSON.stringify(quiz));
  $('#quizTitle').value = draft.title || '';
  renderQuestions();
  showView('editor');
}
$('#addMc').onclick = () => { draft.questions.push({ type:'mc', text:'', choices:['','','',''], answer:0, double:false }); renderQuestions(); };
$('#addOx').onclick = () => { draft.questions.push({ type:'ox', text:'', answer:'O', double:false }); renderQuestions(); };
$('#addShort').onclick = () => { draft.questions.push({ type:'short', text:'', answer:'', accepted:[''], double:false }); renderQuestions(); };

function renderQuestions() {
  const box = $('#questions'); box.innerHTML = '';
  draft.questions.forEach((q, i) => {
    const card = document.createElement('div');
    card.className = 'panel'; card.style.marginBottom = '12px';
    let inner = `<div class="row" style="justify-content:space-between">
      <strong>Q${i+1} · ${({mc:'객관식',ox:'O/X',short:'단답형'})[q.type]}</strong>
      <label class="row"><input type="checkbox" style="width:auto" ${q.double?'checked':''} data-dbl="${i}"> x2 점수</label></div>`;
    inner += `<input placeholder="문제 내용" value="${esc(q.text)}" data-text="${i}">`;
    if (q.type === 'mc') {
      inner += '<div class="opts mt">';
      q.choices.forEach((c, j) => {
        inner += `<div><input placeholder="보기 ${j+1}" value="${esc(c)}" data-choice="${i}-${j}">
          <label class="row"><input type="radio" name="ans${i}" style="width:auto" ${q.answer===j?'checked':''} data-ans="${i}-${j}"> 정답</label></div>`;
      });
      inner += '</div>';
    } else if (q.type === 'ox') {
      inner += `<div class="mt row"><label><input type="radio" name="ans${i}" style="width:auto" ${q.answer==='O'?'checked':''} data-oxans="${i}-O"> O 정답</label>
        <label><input type="radio" name="ans${i}" style="width:auto" ${q.answer==='X'?'checked':''} data-oxans="${i}-X"> X 정답</label></div>`;
    } else {
      inner += `<div class="mt"><small>인정 답안(줄바꿈으로 여러 개)</small>
        <textarea rows="3" data-accepted="${i}">${esc((q.accepted||[q.answer]).join('\n'))}</textarea></div>`;
    }
    inner += `<div class="mt"><button class="btn btn-ghost" data-del="${i}">문제 삭제</button></div>`;
    card.innerHTML = inner;
    box.append(card);
  });
  // 이벤트 바인딩
  box.querySelectorAll('[data-text]').forEach(el => el.oninput = e => draft.questions[+el.dataset.text].text = e.target.value);
  box.querySelectorAll('[data-dbl]').forEach(el => el.onchange = e => draft.questions[+el.dataset.dbl].double = e.target.checked);
  box.querySelectorAll('[data-choice]').forEach(el => el.oninput = e => { const [i,j]=el.dataset.choice.split('-').map(Number); draft.questions[i].choices[j]=e.target.value; });
  box.querySelectorAll('[data-ans]').forEach(el => el.onchange = e => { const [i,j]=el.dataset.ans.split('-').map(Number); draft.questions[i].answer=j; });
  box.querySelectorAll('[data-oxans]').forEach(el => el.onchange = e => { const [i,v]=el.dataset.oxans.split('-'); draft.questions[+i].answer=v; });
  box.querySelectorAll('[data-accepted]').forEach(el => el.oninput = e => { const i=+el.dataset.accepted; const arr=e.target.value.split('\n').map(s=>s.trim()).filter(Boolean); draft.questions[i].accepted=arr; draft.questions[i].answer=arr[0]||''; });
  box.querySelectorAll('[data-del]').forEach(el => el.onclick = () => { draft.questions.splice(+el.dataset.del,1); renderQuestions(); });
}
function esc(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

$('#saveQuiz').onclick = async () => {
  draft.title = $('#quizTitle').value.trim() || '제목 없는 퀴즈쇼';
  draft.questions.forEach(q => {
    if (q.type === 'short') {
      q.accepted = (q.accepted || []).map(s => String(s).trim()).filter(Boolean);
      q.answer = q.accepted[0] || '';
    }
  });
  const id = await db.saveQuiz(draft);
  draft.id = id;
  alert('저장했어요!');
  openList();
};

// startHosting은 Task 5에서 정의
async function startHosting(quiz){ if (window.__startHosting) return window.__startHosting(quiz); }

let room = null, roomCode = null, unsub = null, tick = null, revealing = false;
let hostQ = -1, victoryDone = false;

window.__startHosting = async function(quiz) {
  if (!quiz.questions || !quiz.questions.length) { alert('문제가 없어요.'); return; }
  victoryDone = false;
  roomCode = await db.createRoom(quiz);
  showView('host');
  unsub = db.subscribeRoom(roomCode, r => { room = r; renderHost(); });
};

function renderHost() {
  const host = document.getElementById('host');
  if (!room) return;
  if (room.state === 'waiting') {
    hostQ = -1;
    const players = Object.values(room.players || {});
    const dir = location.pathname.replace(/[^/]*$/, '');   // 현재 폴더 (파일명 제거)
    const joinUrl = location.origin + dir + 'index.html?room=' + roomCode;
    host.innerHTML = `<h1 class="center">폰으로 QR을 찍어 입장하세요</h1>
      <div class="center"><div class="qr-box"><div id="qrcode"></div></div></div>
      <p class="center join-code">방 코드 <b>${roomCode}</b></p>
      <p class="center join-url">${escT(joinUrl)}</p>
      <h3 class="center mt">대기 중 (${players.length}명)</h3>
      <div class="center">${players.map(p=>`<span class="badge-x2" style="margin:4px">${escT(p.nick)}</span>`).join('')}</div>
      <div class="mt center"><button class="btn" id="startBtn">시작하기 ▶</button></div>`;
    renderQR(joinUrl);
    document.getElementById('startBtn').onclick = () => gotoQuestion(0);
  } else if (room.state === 'question') {
    if (hostQ !== room.currentQ) { hostQ = room.currentQ; renderQuestionScreen(); }
  } else if (room.state === 'reveal') {
    hostQ = -1;
    renderReveal();
  } else if (room.state === 'ended') {
    hostQ = -1;
    renderEnded();
  }
}

function renderQR(url) {
  const el = document.getElementById('qrcode');
  if (!el) return;
  el.innerHTML = '';
  if (window.QRCode) {
    new window.QRCode(el, {
      text: url, width: 240, height: 240,
      colorDark: '#1c2119', colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M
    });
  } else {
    el.innerHTML = '<p style="color:#333;font-weight:700">QR 로드 실패 — 아래 주소로 접속하세요</p>';
  }
}

async function gotoQuestion(idx) {
  setUrgent(false);
  startMusic();          // 버튼 클릭(제스처) 안에서 호출 → 오디오 재생 잠금 해제
  clearInterval(tick);
  const now = await db.serverNow();
  await db.setRoomState(roomCode, { state:'question', currentQ: idx, startedAt: now });
}

function renderQuestionScreen() {
  const host = document.getElementById('host');
  const q = room.questions[room.currentQ];
  host.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <span>Q${room.currentQ+1}/${room.questions.length}</span>
      ${q.double?'<span class="badge-x2">x2 점수!</span>':''}
    </div>
    <div class="timer-ring" id="ring">
      <svg width="120" height="120"><circle class="bg" cx="60" cy="60" r="52" fill="none" stroke-width="12"/>
      <circle class="fg" cx="60" cy="60" r="52" fill="none" stroke-width="12"
        stroke-dasharray="${2*Math.PI*52}" stroke-dashoffset="0" id="fg"/></svg>
      <div class="timer-num" id="num">20</div>
    </div>
    <h2 class="center">${escT(q.text)}</h2>
    ${renderChoicesPreview(q)}
    <div class="mt center"><button class="btn" id="revealBtn">정답 공개 →</button></div>`;
  document.getElementById('revealBtn').onclick = (e) => { e.currentTarget.disabled = true; doReveal(); };
  runTimer();
}
function renderChoicesPreview(q) {
  if (q.type==='mc') return `<div class="opts mt">${q.choices.map((c,j)=>`<div class="opt c${j+1}">${escT(c)}</div>`).join('')}</div>`;
  if (q.type==='ox') return `<div class="ox mt"><div class="ox-btn o">O</div><div class="ox-btn x">X</div></div>`;
  return `<p class="center">단답형 — 참가자가 직접 입력</p>`;
}
function runTimer() {
  const num = document.getElementById('num');
  const fg = document.getElementById('fg');
  const ring = document.getElementById('ring');
  const circ = 2*Math.PI*52;
  clearInterval(tick);
  tick = setInterval(async () => {
    const now = await db.serverNow();
    const remain = Math.max(0, ROUND_MS - (now - room.startedAt));
    const sec = Math.ceil(remain/1000);
    if (num) num.textContent = sec;
    if (fg) fg.style.strokeDashoffset = circ * (1 - remain/ROUND_MS);
    if (ring) { ring.classList.toggle('warn', sec<=10 && sec>5); ring.classList.toggle('urgent', sec<=5); }
    setUrgent(sec<=5 && remain>0);   // 마지막 5초 음악 템포 가속
    if (remain<=0) { clearInterval(tick); doReveal(); }
  }, 250);
}

async function doReveal() {
  if (revealing) return;
  if (room.state !== 'question') return;
  revealing = true;
  clearInterval(tick);
  stopMusic();           // 정답 공개 시 배경음악 정지
  try {
    const idx = room.currentQ;
    const q = room.questions[idx];
    const answers = (room.answers && room.answers[idx]) || {};
    // 채점 + 점수 반영
    for (const [pid, a] of Object.entries(answers)) {
      const correct = checkAnswer(q, a.value);
      const remain = Math.max(0, ROUND_MS - (a.answeredAt - room.startedAt));
      const gained = calcScore(correct, remain, !!q.double);
      if (gained > 0 && remain > 0) await db.addScore(roomCode, pid, gained);
    }
    await db.setRoomState(roomCode, { state:'reveal' });
  } finally {
    revealing = false;
  }
}

function renderReveal() {
  const host = document.getElementById('host');
  const q = room.questions[room.currentQ];
  const ranked = rankPlayers(room.players);
  const answerText = q.type==='mc' ? q.choices[q.answer] : (q.type==='ox' ? q.answer : (q.accepted||[q.answer]).join(' / '));
  const last = room.currentQ >= room.questions.length-1;
  host.innerHTML = `<h2 class="center">✅ 정답: ${escT(answerText)}</h2>
    <h3>현재 순위</h3>
    ${ranked.slice(0,10).map((r,i)=>`<div class="leader-row"><span><span class="rank">${i+1}</span>${escT(r.nick)}</span><strong>${r.score}</strong></div>`).join('')}
    <div class="mt center">
      ${last ? '<button class="btn" id="endBtn">최종 결과 발표 🏆</button>'
             : '<button class="btn" id="nextBtn">다음 문제 →</button>'}
    </div>`;
  const nb = document.getElementById('nextBtn'); if (nb) nb.onclick = () => gotoQuestion(room.currentQ+1);
  const eb = document.getElementById('endBtn'); if (eb) eb.onclick = () => db.setRoomState(roomCode, { state:'ended' });
}

function renderEnded() {
  const host = document.getElementById('host');
  stopMusic();
  if (!victoryDone) { victoryDone = true; playVictory(); }   // 승리 팡파레 1회
  const ranked = rankPlayers(room.players);
  const [p1,p2,p3] = ranked;
  host.innerHTML = `<h1 class="center">🏆 최종 결과</h1>
    <div class="podium">
      <div class="col p2"><div>🥈 ${p2?escT(p2.nick):'-'}</div><div class="bar">${p2?p2.score:''}</div></div>
      <div class="col p1"><div>🥇 ${p1?escT(p1.nick):'-'}</div><div class="bar">${p1?p1.score:''}</div></div>
      <div class="col p3"><div>🥉 ${p3?escT(p3.nick):'-'}</div><div class="bar">${p3?p3.score:''}</div></div>
    </div>
    <h3>전체 순위</h3>
    ${ranked.map((r,i)=>`<div class="leader-row"><span><span class="rank">${i+1}</span>${escT(r.nick)}</span><strong>${r.score}</strong></div>`).join('')}
    <div class="mt center"><button class="btn" id="homeBtn">목록으로</button></div>`;
  document.getElementById('homeBtn').onclick = () => { if (unsub) unsub(); openList(); };
}
function escT(s){ return String(s??'').replace(/</g,'&lt;'); }
