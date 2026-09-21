export const ROUND_MS = 20000;
export const BASE_POINTS = 100;
export const MAX_SPEED_BONUS = 100;

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // O,I,L,0,1 제외

export function generateRoomCode(rng = Math.random) {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(rng() * CODE_CHARS.length)];
  }
  return code;
}

export function normalize(s) {
  return String(s ?? '').trim().toLowerCase();
}

export function checkAnswer(question, value) {
  if (question.type === 'mc') {
    return Number(value) === Number(question.answer);
  }
  if (question.type === 'ox') {
    return String(value) === String(question.answer);
  }
  if (question.type === 'short') {
    const list = question.accepted && question.accepted.length
      ? question.accepted
      : [question.answer];
    return list.some(a => normalize(a) === normalize(value));
  }
  return false;
}

export function calcScore(isCorrect, remainingMs, isDouble) {
  if (!isCorrect) return 0;
  const clamped = Math.max(0, Math.min(remainingMs, ROUND_MS));
  const speed = Math.round(MAX_SPEED_BONUS * (clamped / ROUND_MS));
  const total = BASE_POINTS + speed;
  return isDouble ? total * 2 : total;
}

export function rankPlayers(players) {
  return Object.entries(players || {})
    .map(([id, p]) => ({ id, nick: p.nick, score: p.score || 0 }))
    .sort((a, b) => b.score - a.score || (a.nick||'').localeCompare(b.nick||''));
}

// 한 문제의 순위 — 점수를 얻은 사람(정답 + 제한시간 내)만, 빨리 맞힌 순.
// 점수가 100 + 속도보너스 구조이고 x2는 문항 전체에 적용되므로,
// 같은 문제 안에서는 "빨리 맞힌 순 = 많이 받은 순"이 항상 일치한다.
export function rankQuestion(question, answersForQ, players, startedAt) {
  const ps = players || {};
  return Object.entries(answersForQ || {})
    .filter(([id]) => ps[id])
    .map(([id, a]) => {
      const elapsedMs = Math.max(0, (a.answeredAt || 0) - (startedAt || 0));
      const remainMs = ROUND_MS - elapsedMs;
      const gained = calcScore(checkAnswer(question, a.value), remainMs, !!question.double);
      return { id, nick: ps[id].nick || '', elapsedMs, gained, remainMs };
    })
    .filter(r => r.gained > 0 && r.remainMs > 0)
    .map(({ id, nick, elapsedMs, gained }) => ({ id, nick, elapsedMs, gained }))
    .sort((a, b) => a.elapsedMs - b.elapsedMs || (a.nick || '').localeCompare(b.nick || ''));
}

// 참가자별 맞힌 개수 / 제출 개수.
//
// startedAt을 주면 제한시간 안에 들어온 정답만 센다(그 문제의 시작 시각을 알 때).
// startedAt을 생략하거나 0을 주면 시간 검사 없이 정답 여부만 센다 — 최종 집계에서 쓴다.
// 방에는 마지막 문제의 startedAt 하나만 남아 과거 문제의 경과 시간을 알 수 없기 때문이다.
// (참가자 화면이 20초에 입력을 막으므로 실제로 늦은 답은 시계 오차 수준에서만 생긴다.)
export function summarize(questions, answers, players, startedAt) {
  const checkTime = Number(startedAt) > 0;
  const out = {};
  Object.keys(players || {}).forEach(id => { out[id] = { correct: 0, answered: 0 }; });
  (questions || []).forEach((q, i) => {
    const forQ = (answers && answers[i]) || {};
    Object.entries(forQ).forEach(([id, a]) => {
      if (!out[id]) return;
      out[id].answered++;
      if (!checkAnswer(q, a.value)) return;
      if (!checkTime) { out[id].correct++; return; }
      const elapsedMs = Math.max(0, (a.answeredAt || 0) - startedAt);
      if (ROUND_MS - elapsedMs > 0) out[id].correct++;
    });
  });
  return out;
}
