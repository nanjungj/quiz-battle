import * as db from './firebase.js';
import { checkAnswer, calcScore, rankPlayers, ROUND_MS } from './logic.js';

const ADMIN_PASSWORD = 'quiz2026'; // README 2절 참고 — 원하는 값으로 변경

const views = ['gate', 'list', 'editor', 'host'];
function showView(id) {
  views.forEach(v => document.getElementById(v).classList.toggle('hidden', v !== id));
}
const $ = s => document.querySelector(s);

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
    row.innerHTML = `<span>${q.title || '(제목 없음)'} · ${(q.questions||[]).length}문항</span>`;
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
function esc(s){ return String(s??'').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

$('#saveQuiz').onclick = async () => {
  draft.title = $('#quizTitle').value.trim() || '제목 없는 퀴즈쇼';
  const id = await db.saveQuiz(draft);
  draft.id = id;
  alert('저장했어요!');
  openList();
};

// startHosting은 Task 5에서 정의
window.__startHosting = null;
async function startHosting(quiz){ if (window.__startHosting) return window.__startHosting(quiz); }
export { showView, $, startHosting };
