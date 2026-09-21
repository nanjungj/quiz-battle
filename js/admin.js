import * as db from './firebase.js';
import { checkAnswer, calcScore, rankPlayers, rankQuestion, ROUND_MS } from './logic.js';
import { startMusic, stopMusic, setUrgent, toggleMute, playVictory } from './music.js';
import { prepareImage, getImage, prefetchImage, cacheImage } from './image.js';

const ADMIN_PASSWORD = 'quiz2026'; // README 2절 참고 — 원하는 값으로 변경

const SHAPES = ['▲', '◆', '●', '■'];

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
    row.className = 'lrow';
    row.innerHTML = `<span class="who">${esc(q.title || '(제목 없음)')}</span>
      <span class="pill">${(q.questions || []).length}문항</span>`;
    const actions = document.createElement('div');
    actions.className = 'row';
    actions.style.marginLeft = 'auto';
    const play = mkBtn('▶ 진행', () => startHosting(q));
    const edit = mkBtn('✏️ 편집', () => openEditor(q), true);
    const del  = mkBtn('🗑️', async () => {
      if (confirm(`"${q.title || '(제목 없음)'}" 퀴즈쇼를 삭제할까요?`)) { await db.deleteQuiz(q.id); openList(); }
    }, true);
    actions.append(play, edit, del);
    row.append(actions);
    box.append(row);
  });
}
function mkBtn(label, fn, ghost) {
  const b = document.createElement('button');
  b.className = ghost ? 'btn btn-ghost' : 'btn';
  b.textContent = label;
  b.onclick = fn;
  return b;
}
$('#newQuizBtn').onclick = () => openEditor({ title:'', questions:[] });
$('#backToList').onclick = openList;

// ---- 편집기 ----
let draft = null, openIdx = -1;
function openEditor(quiz) {
  draft = JSON.parse(JSON.stringify(quiz));
  if (!draft.id) draft.id = db.newId();   // 저장 전에도 이미지를 넣을 경로가 있어야 한다
  openIdx = draft.questions.length ? 0 : -1;
  $('#quizTitle').value = draft.title || '';
  renderQuestions();
  showView('editor');
}

const TYPE_LABEL = { mc: '객관식', ox: 'O/X', short: '단답형' };
function addQuestion(q) {
  draft.questions.push(q);
  openIdx = draft.questions.length - 1;
  renderQuestions();
}
$('#addMc').onclick = () =>
  addQuestion({ type:'mc', text:'', choices:['','','',''], answer:0, double:false });
$('#addOx').onclick = () =>
  addQuestion({ type:'ox', text:'', answer:'O', double:false });
$('#addShort').onclick = () =>
  addQuestion({ type:'short', text:'', answer:'', accepted:[''], double:false });

function renderQuestions() {
  const box = document.getElementById('questions');
  box.innerHTML = '';
  if (!draft.questions.length) {
    box.innerHTML = '<p class="muted center">아직 문제가 없어요. 아래에서 유형을 골라 추가하세요.</p>';
    return;
  }
  draft.questions.forEach((q, i) => {
    const card = document.createElement('div');
    card.className = 'qcard' + (i === openIdx ? ' open' : '');
    const preview = q.text ? esc(q.text) : '<span class="muted">(문제 내용 없음)</span>';
    let html = `<div class="qcard-head" data-open="${i}">
      <span class="pill ${i === openIdx ? 'pill-primary' : ''}">Q${i + 1} · ${TYPE_LABEL[q.type]}</span>
      ${q.double ? '<span class="pill pill-amber">x2</span>' : ''}
      <span class="title">${preview}</span>
      <span class="tools">
        <button data-up="${i}" title="위로">↑</button>
        <button data-down="${i}" title="아래로">↓</button>
        <button data-dup="${i}" title="복제">⧉</button>
        <button data-del="${i}" title="삭제">🗑️</button>
        <button data-open2="${i}" title="펼치기/접기">${i === openIdx ? '⌃' : '⌄'}</button>
      </span>
    </div>`;

    if (i === openIdx) {
      html += '<div class="qcard-body">';
      html += `<div class="field"><label for="qtext${i}">문제 내용</label>
        <input id="qtext${i}" placeholder="문제 내용" value="${esc(q.text)}" data-text="${i}"></div>`;
      html += imgDropMarkup(q, i);
      html += `<label class="row"><input type="checkbox" ${q.double ? 'checked' : ''} data-dbl="${i}"> x2 점수 문제</label>`;

      if (q.type === 'mc') {
        html += '<div class="field"><label>보기 — 동그라미를 눌러 정답을 고르세요</label><div class="stack">';
        q.choices.forEach((c, j) => {
          html += `<div class="ansopt ${q.answer === j ? 'on' : ''}">
            <button class="dot" data-ans="${i}-${j}" title="이 보기를 정답으로">✓</button>
            <input placeholder="보기 ${j + 1}" value="${esc(c)}" data-choice="${i}-${j}">
          </div>`;
        });
        html += '</div></div>';
      } else if (q.type === 'ox') {
        html += `<div class="field"><label>정답</label><div class="row">
          <div class="ansopt ${q.answer === 'O' ? 'on' : ''}" style="flex:1">
            <button class="dot" data-oxans="${i}-O">✓</button><span style="font-weight:900">O</span></div>
          <div class="ansopt ${q.answer === 'X' ? 'on' : ''}" style="flex:1">
            <button class="dot" data-oxans="${i}-X">✓</button><span style="font-weight:900">X</span></div>
        </div></div>`;
      } else {
        html += `<div class="field"><label for="qacc${i}">인정 답안 — 한 줄에 하나씩</label>
          <textarea id="qacc${i}" rows="3" data-accepted="${i}">${esc((q.accepted || [q.answer]).join('\n'))}</textarea></div>`;
      }
      html += '</div>';
    }
    card.innerHTML = html;
    box.append(card);
  });
  bindEditorEvents(box);
  fillThumbs();
}

function imgDropMarkup(q, i) {
  if (q.image) {
    return `<div class="imgdrop filled" data-imgslot="${i}">
      <div class="thumb" id="thumb${i}"></div>
      <span class="name">이미지 첨부됨 · ${q.image.w}×${q.image.h}</span>
      <span class="tools">
        <button class="btn btn-ghost" data-imgpick="${i}">바꾸기</button>
        <button class="btn btn-ghost" data-imgdel="${i}">🗑️</button>
      </span>
      <input type="file" accept="image/*" class="hidden" data-imgfile="${i}">
    </div>`;
  }
  return `<div class="imgdrop" data-imgslot="${i}" data-imgpick="${i}">
    <span style="font-size:1.4rem">🖼</span>
    <span>이미지를 끌어다 놓거나 눌러서 고르세요 <span class="muted">(선택)</span></span>
    <input type="file" accept="image/*" class="hidden" data-imgfile="${i}">
  </div>`;
}

// 썸네일은 비동기로 채운다 — 카드를 그리는 것을 막지 않는다
async function fillThumbs() {
  for (let i = 0; i < draft.questions.length; i++) {
    const q = draft.questions[i];
    const el = document.getElementById('thumb' + i);
    if (!q.image || !el) continue;
    const url = await getImage(draft.id, q.image.id).catch(() => null);
    if (url && document.getElementById('thumb' + i) === el) {
      el.innerHTML = `<img src="${url}" alt="첨부된 이미지 미리보기">`;
    }
  }
}

async function attachImage(i, file) {
  const slot = document.querySelector(`[data-imgslot="${i}"]`);
  const old = draft.questions[i].image;
  if (slot) slot.innerHTML = '<span>이미지를 줄이는 중…</span>';
  let prepared;
  try {
    prepared = await prepareImage(file);
  } catch (err) {
    showImgError(i, err.message);
    return;
  }
  if (slot) slot.innerHTML = '<span>저장하는 중…</span>';
  const imgId = db.newId();
  try {
    await db.saveQuizImage(draft.id, imgId, prepared.dataUrl);
  } catch (err) {
    showImgError(i, '이미지를 저장하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
    return;
  }
  cacheImage(draft.id, imgId, prepared.dataUrl);
  draft.questions[i].image = { id: imgId, w: prepared.w, h: prepared.h };
  renderQuestions();
  if (old) db.deleteQuizImage(draft.id, old.id).catch(() => {});
}

function showImgError(i, message) {
  const slot = document.querySelector(`[data-imgslot="${i}"]`);
  if (!slot) return;
  slot.classList.remove('filled');
  slot.innerHTML = `<span class="err">${esc(message)}</span>
    <span class="tools"><button class="btn btn-ghost" data-imgpick="${i}">다시 시도</button></span>
    <input type="file" accept="image/*" class="hidden" data-imgfile="${i}">`;
  slot.querySelector('[data-imgpick]').onclick = e => {
    e.stopPropagation();
    slot.querySelector('[data-imgfile]').click();
  };
  slot.querySelector('[data-imgfile]').onchange = e => {
    const file = e.target.files && e.target.files[0];
    if (file) attachImage(i, file);
  };
}

function bindEditorEvents(box) {
  const toggle = i => { openIdx = (openIdx === i ? -1 : i); renderQuestions(); };
  box.querySelectorAll('[data-open]').forEach(el => el.onclick = e => {
    if (e.target.closest('.tools')) return;      // 도구 버튼 클릭은 펼침 토글이 아니다
    toggle(+el.dataset.open);
  });
  box.querySelectorAll('[data-open2]').forEach(el => el.onclick = () => toggle(+el.dataset.open2));
  box.querySelectorAll('[data-up]').forEach(el => el.onclick = () => move(+el.dataset.up, -1));
  box.querySelectorAll('[data-down]').forEach(el => el.onclick = () => move(+el.dataset.down, +1));
  box.querySelectorAll('[data-dup]').forEach(el => el.onclick = () => {
    const i = +el.dataset.dup;
    draft.questions.splice(i + 1, 0, JSON.parse(JSON.stringify(draft.questions[i])));
    openIdx = i + 1;
    renderQuestions();
  });
  box.querySelectorAll('[data-del]').forEach(el => el.onclick = () => {
    const i = +el.dataset.del;
    if (!confirm(`Q${i + 1}을 삭제할까요?`)) return;
    const gone = draft.questions[i].image;
    if (gone) db.deleteQuizImage(draft.id, gone.id).catch(() => {});
    draft.questions.splice(i, 1);
    if (openIdx >= draft.questions.length) openIdx = draft.questions.length - 1;
    renderQuestions();
  });
  box.querySelectorAll('[data-text]').forEach(el => el.oninput = e =>
    draft.questions[+el.dataset.text].text = e.target.value);
  box.querySelectorAll('[data-dbl]').forEach(el => el.onchange = e =>
    draft.questions[+el.dataset.dbl].double = e.target.checked);
  box.querySelectorAll('[data-choice]').forEach(el => el.oninput = e => {
    const [i, j] = el.dataset.choice.split('-').map(Number);
    draft.questions[i].choices[j] = e.target.value;
  });
  box.querySelectorAll('[data-ans]').forEach(el => el.onclick = () => {
    const [i, j] = el.dataset.ans.split('-').map(Number);
    draft.questions[i].answer = j;
    renderQuestions();
  });
  box.querySelectorAll('[data-oxans]').forEach(el => el.onclick = () => {
    const [i, v] = el.dataset.oxans.split('-');
    draft.questions[+i].answer = v;
    renderQuestions();
  });
  box.querySelectorAll('[data-accepted]').forEach(el => el.oninput = e => {
    const i = +el.dataset.accepted;
    const arr = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
    draft.questions[i].accepted = arr;
    draft.questions[i].answer = arr[0] || '';
  });

  // ── 이미지 첨부 ──
  box.querySelectorAll('[data-imgpick]').forEach(el => el.onclick = e => {
    e.stopPropagation();
    const i = +el.dataset.imgpick;
    box.querySelector(`[data-imgfile="${i}"]`).click();
  });
  box.querySelectorAll('[data-imgfile]').forEach(el => el.onchange = e => {
    const file = e.target.files && e.target.files[0];
    if (file) attachImage(+el.dataset.imgfile, file);
    e.target.value = '';
  });
  box.querySelectorAll('[data-imgdel]').forEach(el => el.onclick = async e => {
    e.stopPropagation();
    const i = +el.dataset.imgdel;
    const old = draft.questions[i].image;
    delete draft.questions[i].image;
    renderQuestions();
    if (old) await db.deleteQuizImage(draft.id, old.id).catch(() => {});
  });
  box.querySelectorAll('[data-imgslot]').forEach(el => {
    const i = +el.dataset.imgslot;
    el.ondragover = e => { e.preventDefault(); el.classList.add('over'); };
    el.ondragleave = () => el.classList.remove('over');
    el.ondrop = e => {
      e.preventDefault();
      el.classList.remove('over');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) attachImage(i, file);
    };
  });
}

function move(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= draft.questions.length) return;
  const [q] = draft.questions.splice(i, 1);
  draft.questions.splice(j, 0, q);
  openIdx = j;
  renderQuestions();
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
    host.innerHTML = `<div class="panel" style="flex:1">
      <div class="row">
        <span style="font-size:1.6rem">🎯</span>
        <span style="font-weight:900;color:var(--primary);font-size:1.6rem">퀴즈 배틀</span>
        <span class="spacer"></span>
        <span class="muted" style="font-weight:700">${escT(room.quizTitle || '')}</span>
      </div>
      <div class="row" style="gap:48px;align-items:center;flex:1;flex-wrap:nowrap">
        <div class="qr-box"><div id="qrcode"></div></div>
        <div class="stack" style="flex:1">
          <div class="muted" style="font-weight:700">폰으로 QR을 찍어 입장하세요</div>
          <div class="join-code">${roomCode}</div>
          <div class="join-url">${escT(joinUrl)}</div>
          <h3>입장 완료 <span style="color:var(--primary)">${players.length}명</span></h3>
          <div class="row">${players.map(p => `<span class="pill">${escT(p.nick)}</span>`).join('')}</div>
        </div>
      </div>
      <div class="row" style="justify-content:flex-end">
        <button class="btn btn-lg" id="startBtn">시작하기 ▶</button>
      </div>
    </div>`;
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
  // 다음 문제 이미지를 미리 받아 둔다 — 문제가 시작되자마자 떠 있어야 20초가 공평하다
  if (room && room.questions) {
    const next = room.state === 'waiting' ? 0 : (room.currentQ ?? -1) + 1;
    const nq = room.questions[next];
    if (nq && nq.image) prefetchImage(room.quizId, nq.image.id);
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
  const body = q.image
    ? `<div class="row" style="gap:36px;flex:1;flex-wrap:nowrap;align-items:center">
         <div style="flex:1.05;min-width:0">${hostImgMarkup(q)}</div>
         <div class="stack" style="flex:1;min-width:0">
           <h2 style="font-size:2rem">${escT(q.text)}</h2>
           ${renderChoicesPreview(q, true)}
         </div>
       </div>`
    : `<div class="stack" style="flex:1;justify-content:center;gap:28px">
         <h2 style="font-size:2.6rem">${escT(q.text)}</h2>
         ${renderChoicesPreview(q, false)}
       </div>`;
  host.innerHTML = `<div class="panel" style="flex:1">
    <div class="row">
      <span class="pill pill-primary">Q${room.currentQ + 1} / ${room.questions.length}</span>
      ${q.double ? '<span class="pill pill-amber">x2 점수!</span>' : ''}
      <span class="spacer"></span>
      <span class="muted" style="font-weight:700">제출</span>
      <strong id="submitCount" style="font-size:1.6rem;color:var(--primary);font-variant-numeric:tabular-nums">
        ${answeredCount(room)}<span class="muted" style="font-size:1.1rem"> / ${Object.keys(room.players || {}).length}</span>
      </strong>
      <div class="timer-ring" id="ring">
        <svg width="120" height="120"><circle class="bg" cx="60" cy="60" r="52" fill="none" stroke-width="12"/>
        <circle class="fg" cx="60" cy="60" r="52" fill="none" stroke-width="12" stroke-linecap="round"
          stroke-dasharray="${2 * Math.PI * 52}" stroke-dashoffset="0" id="fg"/></svg>
        <div class="timer-num" id="num">20</div>
      </div>
    </div>
    ${body}
    <div class="row" style="justify-content:flex-end">
      <button class="btn" id="revealBtn">정답 공개 →</button>
    </div>
  </div>`;
  fillHostImg(q);
  document.getElementById('revealBtn').onclick = (e) => { e.currentTarget.disabled = true; doReveal(); };
  runTimer();
}

// 대형 스크린: 이미지가 있으면 좌우 2단, 없으면 기존 세로 배치
function hostImgMarkup(q) {
  if (!q.image) return '';
  return `<div class="qimg loading" id="qimg" style="aspect-ratio:${q.image.w}/${q.image.h}"></div>`;
}
async function fillHostImg(q) {
  if (!q.image) return;
  const box = document.getElementById('qimg');
  if (!box) return;
  const url = await getImage(room.quizId, q.image.id).catch(() => null);
  if (!url) { box.remove(); return; }
  if (document.getElementById('qimg') !== box) return;
  box.classList.remove('loading');
  box.innerHTML = `<img src="${url}" alt="문제 이미지">`;
}

// 현재 문제에 제출한 사람 수
function answeredCount(r) {
  if (!r || r.currentQ == null) return 0;
  return Object.keys(((r.answers || {})[r.currentQ]) || {}).length;
}

function renderChoicesPreview(q, stacked) {
  if (q.type === 'mc') {
    const cols = stacked ? '1fr' : '1fr 1fr';
    return `<div class="opts${stacked ? ' stacked' : ''}" style="grid-template-columns:${cols}">${q.choices.map((c, j) =>
      `<div class="choice c${j + 1}"><span class="shape">${SHAPES[j]}</span><span>${escT(c)}</span></div>`
    ).join('')}</div>`;
  }
  if (q.type === 'ox') {
    return `<div class="ox" style="flex:1"><div class="ox-btn o">O</div><div class="ox-btn x">X</div></div>`;
  }
  return `<div class="panel center muted" style="flex:1;justify-content:center">단답형 — 참가자가 폰에서 직접 입력합니다</div>`;
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
    const cnt = document.getElementById('submitCount');
    if (cnt) cnt.firstChild.nodeValue = String(answeredCount(room));
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
  const correctCount = Object.values(((room.answers || {})[room.currentQ]) || {})
    .filter(a => checkAnswer(q, a.value)).length;
  const qRanked = rankQuestion(q, (room.answers || {})[room.currentQ], room.players, room.startedAt);
  const last = room.currentQ >= room.questions.length-1;

  host.innerHTML = `<div class="panel" style="flex:1">
    <div class="row" style="background:var(--mint);color:#fff;border-radius:var(--r-lg);padding:20px 26px;flex-wrap:nowrap">
      <span style="width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.24);
                   display:grid;place-items:center;font-size:1.6rem;font-weight:900;flex:none">✓</span>
      <span style="font-weight:700;opacity:.9">정답</span>
      <span style="font-size:2rem;font-weight:900">${escT(answerText)}</span>
      <span class="spacer"></span>
      <span style="font-weight:700;opacity:.92">${correctCount}명 맞힘</span>
    </div>
    <div class="row" style="gap:28px;align-items:stretch;flex:1;flex-wrap:nowrap">
      <div class="stack" style="flex:1;min-width:0">
        <h3 style="color:var(--primary)">⚡ 이번 문제 빨리 맞힌 순</h3>
        ${qRanked.length ? qRanked.slice(0, 5).map((r, i) =>
          `<div class="lrow${i === 0 ? ' me' : ''}"><span class="n">${i + 1}</span>
           <span class="who">${escT(r.nick)}</span>
           <span class="s">${(r.elapsedMs / 1000).toFixed(1)}초</span></div>`).join('')
        : '<p class="muted">이번 문제는 맞힌 사람이 없어요.</p>'}
      </div>
      <div class="stack" style="flex:1;min-width:0">
        <h3 class="muted">누적 순위</h3>
        ${ranked.slice(0, 5).map((r, i) =>
          `<div class="lrow"><span class="n">${i + 1}</span><span class="who">${escT(r.nick)}</span>
           <span class="s">${r.score}</span></div>`).join('')}
      </div>
    </div>
    <div class="row" style="justify-content:flex-end">
      ${last ? '<button class="btn btn-lg" id="endBtn">최종 결과 발표 🏆</button>'
             : '<button class="btn btn-lg" id="nextBtn">다음 문제 →</button>'}
    </div>
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
