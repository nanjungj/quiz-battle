import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getDatabase, ref, push, set, update, get, onValue
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { generateRoomCode } from './logic.js';

// 드라큘라 게임과 동일한 Firebase 프로젝트(dracula-818e1) 재사용.
// 퀴즈 앱은 quizzes/ · rooms/ 최상위 경로만 사용하므로 드라큘라 데이터와 겹치지 않음.
// 별도 프로젝트로 분리하려면 아래 값을 새 프로젝트 값으로 교체하세요(README 참고).
const firebaseConfig = {
  apiKey: "AIzaSyC_4BznNUK9uWgK-KN4gyeox7vpNf01nWg",
  authDomain: "dracula-818e1.firebaseapp.com",
  databaseURL: "https://dracula-818e1-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "dracula-818e1",
  storageBucket: "dracula-818e1.firebasestorage.app",
  messagingSenderId: "973501633681",
  appId: "1:973501633681:web:a2283a33de9d468d141b30"
};

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
  await deleteQuizImages(id);
}

export async function createRoom(quiz) {
  // 중복되지 않는 코드 확보
  let code = null;
  for (let i = 0; i < 5; i++) {
    const candidate = generateRoomCode();
    const exists = (await get(ref(db, 'rooms/' + candidate))).exists();
    if (!exists) { code = candidate; break; }
  }
  if (!code) throw new Error('방 코드 생성 실패 — 다시 시도해 주세요.');
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
  // NOTE: .info/* paths are populated by a local sync mechanism, not the
  // server REST API. get() on '.info/serverTimeOffset' throws
  // "Invalid token in path" — only onValue() (a realtime listener) works here.
  return new Promise((resolve) => {
    const offRef = ref(db, '.info/serverTimeOffset');
    onValue(offRef, (snap) => {
      resolve(Date.now() + (snap.val() || 0));
    }, { onlyOnce: true });
  });
}

// 쓰기 없이 새 id만 발급한다 — 저장 전에 이미지를 넣을 경로가 필요할 때 쓴다
export function newId() {
  return push(ref(db, 'quizzes')).key;
}

// ── 문제 이미지 ──
// 이미지는 quizImages/ 에 따로 둔다. rooms/ 안에 절대 넣지 말 것 —
// 방은 참가자 전원이 구독 중이라 점수가 바뀔 때마다 이미지까지 전부 재전송된다.
export async function saveQuizImage(quizId, imgId, dataUrl) {
  await set(ref(db, `quizImages/${quizId}/${imgId}`), dataUrl);
}
export async function loadQuizImage(quizId, imgId) {
  return (await get(ref(db, `quizImages/${quizId}/${imgId}`))).val();
}
export async function deleteQuizImage(quizId, imgId) {
  await set(ref(db, `quizImages/${quizId}/${imgId}`), null);
}
export async function deleteQuizImages(quizId) {
  await set(ref(db, `quizImages/${quizId}`), null);
}

export async function getRoom(code) {
  return (await get(ref(db, 'rooms/' + code))).val();
}
