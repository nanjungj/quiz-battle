import * as db from './firebase.js';
import { rankPlayers, summarize, checkAnswer } from './logic.js';
import { ADMIN_PASSWORD } from './config.js';

const $ = s => document.querySelector(s);
// 주소 하나를 쓰므로 ?results=CODE 로 들어온다 (?room= 은 교육생 입장용)
const preRoom = (new URLSearchParams(location.search).get('results') || '').trim().toUpperCase();
if (preRoom) $('#rRoom').value = preRoom;
$('#rPw').focus();

$('#rBtn').onclick = open;
$('#rPw').addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
$('#rRoom').addEventListener('keydown', e => { if (e.key === 'Enter') open(); });

async function open() {
  const err = $('#rErr');
  err.classList.add('hidden');
  if ($('#rPw').value !== ADMIN_PASSWORD) {
    err.textContent = '암호가 틀렸어요.';
    err.classList.remove('hidden');
    return;
  }
  const code = $('#rRoom').value.trim().toUpperCase();
  const room = await db.getRoom(code);
  if (!room) {
    err.textContent = '결과를 찾을 수 없어요. 방 코드를 다시 확인해 주세요.';
    err.classList.remove('hidden');
    return;
  }
  $('#rGate').classList.add('hidden');
  $('#board').classList.remove('hidden');
  render(code, room);
}

function render(code, room) {
  const ranked = rankPlayers(room.players || {});
  // startedAt에 0을 넘겨 제한시간 검사 없이 정답 여부만 센다 —
  // 방에는 마지막 문제의 startedAt 하나뿐이라 과거 문제의 경과 시간을 알 수 없다.
  const stats = summarize(room.questions || [], room.answers || {}, room.players || {}, 0);
  const total = (room.questions || []).length;

  $('#board').innerHTML = `<div class="panel" style="flex:1">
    <div class="row">
      <h1 class="spacer">전체 순위</h1>
      <span class="pill">${ranked.length}명</span>
      <button class="btn btn-ghost" id="csvBtn">⬇ CSV 저장</button>
    </div>
    <p class="muted" style="margin:0">${escT(room.quizTitle || '')} · 방 ${escT(code)}</p>
    <div class="stack">
      ${ranked.length ? ranked.map((r, i) => `<div class="lrow">
        <span class="n">${i + 1}</span>
        <span class="who">${escT(r.nick)}</span>
        <span class="pill">${(stats[r.id] || {}).correct || 0} / ${total} 정답</span>
        <span class="s">${r.score}</span>
      </div>`).join('') : '<p class="muted">참가자가 없어요.</p>'}
    </div>
  </div>`;
  document.getElementById('csvBtn').onclick = () => downloadCsv(room, ranked, stats, total);
}

function downloadCsv(room, ranked, stats, total) {
  const header = ['순위', '닉네임', '점수', '맞힌개수']
    .concat(Array.from({ length: total }, (_, i) => 'Q' + (i + 1)));
  const rows = ranked.map((r, i) => {
    const marks = (room.questions || []).map((q, qi) => {
      const a = ((room.answers || {})[qi] || {})[r.id];
      if (a === undefined) return '-';
      return checkAnswer(q, a.value) ? 'O' : 'X';
    });
    return [i + 1, r.nick, r.score, (stats[r.id] || {}).correct || 0].concat(marks);
  });
  const csv = [header, ...rows].map(cols => cols.map(csvCell).join(',')).join('\r\n');
  // 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM을 붙인다
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(room.quizTitle || '퀴즈배틀').replace(/[\\/:*?"<>|]/g, '_')}_결과.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function escT(s) { return String(s ?? '').replace(/</g, '&lt;'); }
