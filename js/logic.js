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
    .sort((a, b) => b.score - a.score || a.nick.localeCompare(b.nick));
}
