import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getDatabase, ref, push, set, update, get, onValue, child, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { generateRoomCode } from './logic.js';

// ▼▼▼ README의 안내대로 본인 Firebase 프로젝트 값으로 교체 ▼▼▼
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  appId: "YOUR_APP_ID"
};
// ▲▲▲ 교체 끝 ▲▲▲

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export async function saveQuiz(quiz) {
  if (quiz.id) { await set(ref(db, 'quizzes/' + quiz.id), quiz); return quiz.id; }
  const r = push(ref(db, 'quizzes'));
  const withId = { ...quiz, id: r.key, createdAt: Date.now() };
  await set(r, withId);
  return r.key;
}
export async function listQuizzes() {
  const snap = await get(ref(db, 'quizzes'));
  const val = snap.val() || {};
  return Object.values(val).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
export async function getQuiz(id) {
  return (await get(ref(db, 'quizzes/' + id))).val();
}
export async function deleteQuiz(id) {
  await set(ref(db, 'quizzes/' + id), null);
}

export async function createRoom(quiz) {
  // 중복되지 않는 코드 확보
  let code;
  for (let i = 0; i < 5; i++) {
    code = generateRoomCode();
    const exists = (await get(ref(db, 'rooms/' + code))).exists();
    if (!exists) break;
  }
  await set(ref(db, 'rooms/' + code), {
    quizId: quiz.id, quizTitle: quiz.title, questions: quiz.questions,
    state: 'waiting', currentQ: -1, startedAt: 0
  });
  return code;
}
export function subscribeRoom(code, cb) {
  return onValue(ref(db, 'rooms/' + code), snap => cb(snap.val()));
}
export async function setRoomState(code, patch) {
  await update(ref(db, 'rooms/' + code), patch);
}
export async function joinRoom(code, nick) {
  const roomSnap = await get(ref(db, 'rooms/' + code));
  if (!roomSnap.exists()) return null;
  const r = push(ref(db, `rooms/${code}/players`));
  await set(r, { nick, score: 0, joinedAt: Date.now() });
  return { playerId: r.key };
}
export async function submitAnswer(code, qIndex, playerId, payload) {
  await set(ref(db, `rooms/${code}/answers/${qIndex}/${playerId}`), payload);
}
export async function addScore(code, playerId, delta) {
  const cur = (await get(ref(db, `rooms/${code}/players/${playerId}/score`))).val() || 0;
  await set(ref(db, `rooms/${code}/players/${playerId}/score`), cur + delta);
}
export async function serverNow() {
  const offSnap = await get(ref(db, '.info/serverTimeOffset'));
  return Date.now() + (offSnap.val() || 0);
}
export { serverTimestamp };
