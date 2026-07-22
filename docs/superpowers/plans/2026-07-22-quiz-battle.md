# 퀴즈 배틀 (실시간 퀴즈쇼) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자가 여러 퀴즈쇼를 만들어 방을 열고, 다수 참가자가 폰으로 6자리 코드+닉네임으로 접속해 20초 제한의 실시간 퀴즈를 풀고 순위를 겨루는 웹앱을 만든다.

**Architecture:** 빌드 도구 없는 정적 웹앱(HTML+ES Module JS). Firebase Realtime Database로 방 상태·응답·점수를 실시간 동기화. 순수 로직(코드 생성·채점·점수·순위)은 의존성 없는 `js/logic.js`로 분리해 Node 내장 테스트(`node --test`)로 검증. UI/실시간 부분은 브라우저 수동 검증. GitHub Pages로 배포.

**Tech Stack:** Vanilla JavaScript (ES Modules), Firebase Realtime Database (CDN modular SDK v10), Node.js 내장 test runner(`node:test`), GitHub Pages.

## Global Constraints

- 빌드/번들러 없음 — 브라우저가 직접 로드하는 정적 파일만 사용 (`<script type="module">`).
- Firebase는 신규 프로젝트 사용 (드라큘라 게임 `dracula-818e1` 과 분리).
- 문제 제한시간은 **20초 고정** (상수 `ROUND_MS = 20000`).
- 점수: 정답 기본 100점 + 속도 보너스(남은시간 비례), x2 문제는 획득 점수 전체 2배, 오답/미응답 0점.
- 단답형은 **정확 일치만 정답**: 앞뒤 공백만 제거하고 대소문자 무시, **내부 띄어쓰기·철자는 정확히 일치**해야 함. 관리자는 인정 답안을 여러 개 등록 가능.
- 참가 방식: 6자리 방 코드(대문자+숫자, 혼동 문자 O/0/I/1/L 제외) + 닉네임. 로그인 없음.
- 관리자 화면은 암호 입력으로 보호.
- 디자인: 다크 칠판 + 파스텔 크레용 톤, 손글씨 폰트(Gaegu), 20초 타이머 링 + 마지막 5초 붉은 확대 연출.
- 참가자 파일 `index.html`, 관리자 파일 `admin.html` (대형 스크린 겸용).

---

## File Structure

- `index.html` — 참가자 화면 (코드/닉네임 → 대기실 → 문제 → 결과)
- `admin.html` — 관리자 화면 (암호 게이트 → 퀴즈쇼 편집 → 방 진행 조종석 + 대형 스크린 표시)
- `css/style.css` — 다크 칠판 크레용 공통 테마
- `js/logic.js` — 순수 함수: 방코드 생성, 답 채점, 점수 계산, 순위. **의존성 없음, 테스트 대상**
- `js/firebase.js` — Firebase 초기화 + DB 헬퍼(방 생성/구독/응답 쓰기 등)
- `js/admin.js` — 관리자 앱 로직
- `js/player.js` — 참가자 앱 로직
- `test/logic.test.js` — `js/logic.js` 단위 테스트 (`node --test`)
- `README.md` — Firebase 설정 & GitHub Pages 배포 안내

**Firebase 데이터 모델**

```
quizzes/{quizId}
  title: string
  createdAt: number
  questions: [ { type:"mc"|"ox"|"short", text, image?, choices?:[..], answer, accepted?:[..], double:bool } ]

rooms/{code}
  quizId: string
  quizTitle: string
  questions: [...]        // 방 열 때 퀴즈 스냅샷 복사(원본 보존)
  state: "waiting"|"question"|"reveal"|"ended"
  currentQ: number        // -1 = 아직 시작 전
  startedAt: number       // 현재 문제 서버 타임스탬프(ms)
  players/{playerId}: { nick, score, joinedAt }
  answers/{qIndex}/{playerId}: { value, answeredAt, correct, gained }
```

---

## Task 1: 순수 로직 모듈 + 단위 테스트

**Files:**
- Create: `js/logic.js`
- Test: `test/logic.test.js`

**Interfaces:**
- Consumes: (없음)
- Produces:
  - `ROUND_MS = 20000`, `BASE_POINTS = 100`, `MAX_SPEED_BONUS = 100`
  - `generateRoomCode(rng = Math.random): string` — 6자, 대문자+숫자, 혼동문자 제외
  - `normalize(s: string): string` — 앞뒤 공백 제거 + 소문자화 (내부 공백 보존)
  - `checkAnswer(question, value): boolean` — type별 정답 판정
  - `calcScore(isCorrect: boolean, remainingMs: number, isDouble: boolean): number`
  - `rankPlayers(players: object): Array<{id, nick, score}>` — 점수 내림차순, 동점은 nick 오름차순

- [ ] **Step 1: 실패하는 테스트 작성**

`test/logic.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUND_MS, generateRoomCode, normalize, checkAnswer, calcScore, rankPlayers
} from '../js/logic.js';

test('generateRoomCode: 6자, 허용 문자만, 혼동문자 없음', () => {
  const seq = [0, 0.5, 0.99, 0.2, 0.7, 0.33];
  let i = 0;
  const code = generateRoomCode(() => seq[i++ % seq.length]);
  assert.equal(code.length, 6);
  assert.match(code, /^[A-HJ-KM-NP-Z2-9]{6}$/); // O,I,L,0,1 제외
});

test('normalize: 앞뒤 공백 제거 + 소문자, 내부 공백 보존', () => {
  assert.equal(normalize('  Hello World  '), 'hello world');
  assert.equal(normalize('이순신'), '이순신');
});

test('checkAnswer mc: 인덱스 일치', () => {
  const q = { type: 'mc', choices: ['a', 'b', 'c', 'd'], answer: 2 };
  assert.equal(checkAnswer(q, 2), true);
  assert.equal(checkAnswer(q, 1), false);
});

test('checkAnswer ox: O/X 일치', () => {
  const q = { type: 'ox', answer: 'O' };
  assert.equal(checkAnswer(q, 'O'), true);
  assert.equal(checkAnswer(q, 'X'), false);
});

test('checkAnswer short: 정확 일치(대소문자 무시, 앞뒤 공백 무시)', () => {
  const q = { type: 'short', answer: '이순신', accepted: ['이순신', '이순신 장군'] };
  assert.equal(checkAnswer(q, ' 이순신 '), true);
  assert.equal(checkAnswer(q, '이순신 장군'), true);
  assert.equal(checkAnswer(q, '이순신장군'), false); // 내부 띄어쓰기 다르면 오답
  assert.equal(checkAnswer(q, '이 순신'), false);
});

test('calcScore: 정답 기본100 + 속도보너스, 남은시간 20초면 200', () => {
  assert.equal(calcScore(true, ROUND_MS, false), 200);   // 100 + 100
  assert.equal(calcScore(true, ROUND_MS / 2, false), 150); // 100 + 50
  assert.equal(calcScore(true, 0, false), 100);           // 100 + 0
});

test('calcScore: x2 문제는 전체 2배, 오답은 0', () => {
  assert.equal(calcScore(true, ROUND_MS, true), 400);
  assert.equal(calcScore(false, ROUND_MS, true), 0);
});

test('rankPlayers: 점수 내림차순, 동점은 nick 오름차순', () => {
  const players = {
    p1: { nick: '나나', score: 300 },
    p2: { nick: '가가', score: 500 },
    p3: { nick: '다다', score: 500 },
  };
  const ranked = rankPlayers(players);
  assert.deepEqual(ranked.map(r => r.nick), ['가가', '다다', '나나']);
  assert.deepEqual(ranked.map(r => r.id), ['p2', 'p3', 'p1']);
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node --test`
Expected: FAIL — `Cannot find module '../js/logic.js'` (또는 export 없음)

- [ ] **Step 3: 최소 구현 작성**

`js/logic.js`:
```javascript
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
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node --test`
Expected: PASS — 8 tests passing

- [ ] **Step 5: 커밋**

```bash
git add js/logic.js test/logic.test.js
git commit -m "feat: pure quiz logic (room code, scoring, answer check, ranking) with tests"
```

---

## Task 2: 다크 칠판 크레용 테마 CSS

**Files:**
- Create: `css/style.css`

**Interfaces:**
- Consumes: (없음)
- Produces: CSS 클래스 — `body`(배경), `.wrap`, `.panel`, `.btn`, `.btn-ghost`, `.opt`, `.opt.c1..c4`, `.ox`, `.ox-btn`, `.timer-ring`, `.timer-num`, `.timer-ring.warn`, `.timer-ring.urgent`, `.leader-row`, `.podium`, `.badge-x2`, `.handwrite`(폰트), `.center`, `.mt`, `.row`, `.hidden`

이 태스크는 순수 스타일이라 자동 테스트 없음. 검증은 Task 4에서 화면과 함께 육안 확인.

- [ ] **Step 1: CSS 작성**

`css/style.css`:
```css
@import url('https://fonts.googleapis.com/css2?family=Gaegu:wght@400;700&display=swap');

:root{
  --board:#26352e; --board2:#2e403a; --chalk:#f2ead9;
  --c1:#f28b82; --c2:#8ab4f8; --c3:#fdd663; --c4:#a5d6a7;
  --accent:#ffe08a; --danger:#ff6b6b;
}
*{ box-sizing:border-box; }
body{
  margin:0; min-height:100vh; font-family:'Gaegu',system-ui,sans-serif;
  color:var(--chalk);
  background:var(--board);
  background-image:radial-gradient(rgba(255,255,255,.03) 1px,transparent 1px);
  background-size:24px 24px;
}
.handwrite{ font-family:'Gaegu',sans-serif; }
.wrap{ max-width:820px; margin:0 auto; padding:24px 16px; }
h1,h2,h3{ font-weight:700; margin:.2em 0; }
.panel{
  background:var(--board2); border-radius:16px; padding:22px;
  box-shadow:inset 0 0 50px rgba(0,0,0,.35); border:3px solid rgba(255,255,255,.06);
}
.btn{
  font-family:'Gaegu',sans-serif; font-weight:700; font-size:1.15rem;
  padding:12px 20px; border-radius:14px; border:none; cursor:pointer;
  background:var(--accent); color:#3a2f00; transition:transform .1s;
}
.btn:hover{ transform:translateY(-2px); }
.btn:disabled{ opacity:.5; cursor:not-allowed; transform:none; }
.btn-ghost{ background:transparent; color:var(--chalk); border:2px dashed rgba(255,255,255,.3); }
input, select, textarea{
  font-family:'Gaegu',sans-serif; font-size:1.1rem; padding:10px 12px;
  border-radius:10px; border:2px solid rgba(255,255,255,.2);
  background:#1f2a25; color:var(--chalk); width:100%;
}
/* 4지선다 */
.opts{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.opt{ padding:20px; border-radius:14px; font-weight:700; font-size:1.3rem;
  text-align:center; cursor:pointer; color:#1c2119; border:none; }
.opt.c1{ background:var(--c1); } .opt.c2{ background:var(--c2); }
.opt.c3{ background:var(--c3); } .opt.c4{ background:var(--c4); }
.opt.dim{ opacity:.35; }
/* O/X */
.ox{ display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.ox-btn{ font-size:4rem; padding:24px; border-radius:16px; cursor:pointer; border:none; font-weight:700; }
.ox-btn.o{ background:var(--c4); color:#12401e; } .ox-btn.x{ background:var(--c1); color:#401212; }
/* 타이머 링 */
.timer-ring{ width:120px; height:120px; margin:0 auto 12px; position:relative; }
.timer-ring svg{ transform:rotate(-90deg); }
.timer-ring circle.bg{ stroke:rgba(255,255,255,.12); }
.timer-ring circle.fg{ stroke:var(--c4); transition:stroke-dashoffset 1s linear, stroke .3s; }
.timer-num{ position:absolute; inset:0; display:flex; align-items:center;
  justify-content:center; font-size:2.6rem; font-weight:700; }
.timer-ring.warn circle.fg{ stroke:var(--c3); }
.timer-ring.urgent circle.fg{ stroke:var(--danger); }
.timer-ring.urgent .timer-num{ color:var(--danger); animation:pulse .5s infinite alternate; }
@keyframes pulse{ from{ transform:scale(1); } to{ transform:scale(1.35); } }
/* 순위 */
.leader-row{ display:flex; justify-content:space-between; padding:10px 16px;
  background:rgba(255,255,255,.06); border-radius:10px; margin-bottom:8px; font-size:1.2rem; }
.leader-row .rank{ opacity:.8; margin-right:10px; }
.podium{ display:flex; align-items:flex-end; justify-content:center; gap:12px; margin:20px 0; }
.podium .col{ text-align:center; }
.podium .bar{ background:var(--accent); color:#3a2f00; border-radius:10px 10px 0 0;
  padding:12px; font-weight:700; width:90px; }
.podium .p1 .bar{ height:150px; } .podium .p2 .bar{ height:110px; } .podium .p3 .bar{ height:80px; }
.badge-x2{ display:inline-block; background:var(--accent); color:#3a2f00;
  font-weight:700; padding:3px 12px; border-radius:20px; transform:rotate(-4deg); }
.center{ text-align:center; }
.mt{ margin-top:16px; } .row{ display:flex; gap:10px; align-items:center; }
.hidden{ display:none !important; }
```

- [ ] **Step 2: 커밋**

```bash
git add css/style.css
git commit -m "feat: dark-chalkboard crayon theme"
```

---

## Task 3: Firebase 초기화 + DB 헬퍼

**Files:**
- Create: `js/firebase.js`
- Create: `README.md` (설정 안내 시작)

**Interfaces:**
- Consumes: (없음)
- Produces (모두 async 또는 구독 함수):
  - `saveQuiz(quiz): Promise<string>` (id 반환), `listQuizzes(): Promise<Array<{id,...}>>`, `getQuiz(id)`, `deleteQuiz(id)`
  - `createRoom(quiz): Promise<string>` (code 반환)
  - `subscribeRoom(code, cb): unsubscribe` — 방 전체 스냅샷
  - `setRoomState(code, patch): Promise<void>` — state/currentQ/startedAt 등 갱신
  - `joinRoom(code, nick): Promise<{playerId}|null>` — 없는 방이면 null
  - `submitAnswer(code, qIndex, playerId, payload): Promise<void>`
  - `serverNow(): Promise<number>` — 서버 타임스탬프 근사(offset 반영)

DB 규칙·연동은 브라우저 수동 검증(Task 4~6). 자동 테스트 없음.

- [ ] **Step 1: firebase.js 작성 (config 자리표시자 포함)**

`js/firebase.js`:
```javascript
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getDatabase, ref, push, set, update, get, onValue, child, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { generateRoomCode } from './logic.js';

// ▼▼▼ README의 안내대로 본인 Firebase 프로젝트 값으로 교체 ▼▼▼
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebimeio.com",
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
  const r = push(ref(db, '.info/tmp')); // 사용 안 함, offset만 활용
  const offSnap = await get(ref(db, '.info/serverTimeOffset'));
  return Date.now() + (offSnap.val() || 0);
}
export { serverTimestamp };
```

> 주의: `databaseURL`의 `firebimeio.com`은 자리표시자 오탈자 방지용이 아니라 실제 값 `firebaseio.com`으로 교체해야 함. README에 정확 도메인 명시.

- [ ] **Step 2: README에 Firebase 설정 절차 작성**

`README.md`:
```markdown
# 퀴즈 배틀 — 실시간 퀴즈쇼

관리자가 퀴즈쇼를 만들고, 참가자가 6자리 코드+닉네임으로 접속해 20초 제한
실시간 퀴즈를 풀며 순위를 겨루는 웹앱.

## 1. Firebase 설정
1. https://console.firebase.google.com 에서 새 프로젝트 생성
2. 빌드 > Realtime Database 만들기 (위치 선택, "테스트 모드"로 시작)
3. 프로젝트 설정 > 내 앱 > 웹 앱 추가 → firebaseConfig 값 복사
4. `js/firebase.js` 상단 `firebaseConfig`를 복사한 값으로 교체
   - `databaseURL`은 `https://<프로젝트>-default-rtdb.firebaseio.com` 형식
5. Realtime Database > 규칙에 아래 임시 규칙 적용(내부/워크숍용):

    {
      "rules": { ".read": true, ".write": true }
    }

   (공개 배포 시 보안 규칙 강화 권장 — 아래 6절 참고)

## 2. 관리자 암호
`js/admin.js`의 `ADMIN_PASSWORD` 상수를 원하는 값으로 변경.

## 3. 로컬 실행
정적 파일이라 브라우저로 열면 되지만, ES Module CORS 때문에 로컬 서버 권장:
`npx serve .`  또는  `python -m http.server 8000`

## 4. 테스트
`node --test`  (순수 로직 검증)

## 5. 배포 (GitHub Pages)
1. GitHub에 저장소 생성 후 푸시
2. Settings > Pages > Source: main 브랜치 / root
3. 발급된 URL의 `/index.html`(참가자), `/admin.html`(관리자) 사용

## 6. (선택) 보안 규칙 강화
워크숍 종료 후에는 quizzes 쓰기를 잠그는 등 규칙을 조정하세요.
```

- [ ] **Step 3: 커밋**

```bash
git add js/firebase.js README.md
git commit -m "feat: firebase data layer + setup README"
```

---

## Task 4: 관리자 — 암호 게이트 + 퀴즈쇼 편집기

**Files:**
- Create: `admin.html`
- Create: `js/admin.js`

**Interfaces:**
- Consumes: `js/firebase.js`(saveQuiz/listQuizzes/getQuiz/deleteQuiz/createRoom/subscribeRoom/setRoomState/addScore), `js/logic.js`(checkAnswer/calcScore/rankPlayers/ROUND_MS)
- Produces: 전역 없음(모듈 내부). 화면 전환 함수 `showView(id)` 사용.

- [ ] **Step 1: admin.html 작성 (뷰 골격)**

`admin.html`:
```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>퀴즈 배틀 · 관리자</title>
<link rel="stylesheet" href="css/style.css">
</head>
<body>
<div class="wrap">

  <!-- 암호 게이트 -->
  <section id="gate" class="panel">
    <h1>🖍️ 퀴즈 배틀 관리자</h1>
    <p>관리자 암호를 입력하세요.</p>
    <input id="pw" type="password" placeholder="암호">
    <div class="mt"><button class="btn" id="pwBtn">입장</button></div>
    <p id="pwErr" class="hidden" style="color:var(--danger)">암호가 틀렸어요.</p>
  </section>

  <!-- 퀴즈쇼 목록 -->
  <section id="list" class="panel hidden">
    <h1>내 퀴즈쇼</h1>
    <div id="quizList"></div>
    <div class="mt"><button class="btn" id="newQuizBtn">+ 새 퀴즈쇼 만들기</button></div>
  </section>

  <!-- 편집기 -->
  <section id="editor" class="panel hidden">
    <div class="row"><button class="btn-ghost btn" id="backToList">← 목록</button></div>
    <h2>퀴즈쇼 편집</h2>
    <input id="quizTitle" placeholder="퀴즈쇼 제목">
    <div id="questions" class="mt"></div>
    <div class="mt row">
      <button class="btn" id="addMc">+객관식</button>
      <button class="btn" id="addOx">+O/X</button>
      <button class="btn" id="addShort">+단답형</button>
    </div>
    <div class="mt"><button class="btn" id="saveQuiz">💾 저장</button></div>
  </section>

  <!-- 진행 조종석 -->
  <section id="host" class="panel hidden"></section>

</div>
<script type="module" src="js/admin.js"></script>
</body>
</html>
```

- [ ] **Step 2: js/admin.js — 게이트 + 편집기 로직 작성**

`js/admin.js`:
```javascript
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
```

- [ ] **Step 3: 브라우저 수동 검증**

Run: `npx serve .` 후 브라우저에서 `http://localhost:3000/admin.html`
Expected(체크리스트):
- 잘못된 암호 → 빨간 오류 문구, 맞는 암호(`quiz2026`) → 목록 화면
- "+ 새 퀴즈쇼" → 편집기, 객관식/OX/단답형 추가되고 입력 반영됨
- x2 체크, 정답 라디오 선택 동작
- 저장 후 목록에 나타남 (Firebase 콘솔의 Realtime Database `quizzes`에 데이터 확인)

- [ ] **Step 4: 커밋**

```bash
git add admin.html js/admin.js
git commit -m "feat: admin password gate + quiz editor"
```

---

## Task 5: 관리자 — 방 진행 조종석 (호스트/대형 스크린)

**Files:**
- Modify: `js/admin.js` (startHosting 구현 + 렌더/타이머/채점)

**Interfaces:**
- Consumes: Task 3 db 함수, Task 1 logic 함수
- Produces: `#host` 뷰에 방 코드·문제·20초 타이머·순위 표시. "다음 문제/정답 공개/종료" 조종. 정답 공개 시 서버 응답 채점 후 점수 반영.

- [ ] **Step 1: startHosting 구현 추가 (admin.js 하단의 placeholder 교체)**

`js/admin.js`의 `window.__startHosting = null;` 부터 파일 끝까지를 아래로 교체:
```javascript
let room = null, roomCode = null, unsub = null, tick = null;

window.__startHosting = async function(quiz) {
  if (!quiz.questions || !quiz.questions.length) { alert('문제가 없어요.'); return; }
  roomCode = await db.createRoom(quiz);
  showView('host');
  unsub = db.subscribeRoom(roomCode, r => { room = r; renderHost(); });
};

function renderHost() {
  const host = document.getElementById('host');
  if (!room) return;
  if (room.state === 'waiting') {
    const players = Object.values(room.players || {});
    host.innerHTML = `<h1>방 코드</h1>
      <div class="center" style="font-size:4rem;letter-spacing:.2em">${roomCode}</div>
      <p class="center">참가자 화면에서 이 코드로 입장하세요.</p>
      <h3>대기 중 (${players.length}명)</h3>
      <div>${players.map(p=>`<span class="badge-x2" style="margin:4px">${escT(p.nick)}</span>`).join('')}</div>
      <div class="mt center"><button class="btn" id="startBtn">시작하기 ▶</button></div>`;
    document.getElementById('startBtn').onclick = () => gotoQuestion(0);
  } else if (room.state === 'question') {
    renderQuestionScreen();
  } else if (room.state === 'reveal') {
    renderReveal();
  } else if (room.state === 'ended') {
    renderEnded();
  }
}

async function gotoQuestion(idx) {
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
  document.getElementById('revealBtn').onclick = doReveal;
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
    if (remain<=0) { clearInterval(tick); doReveal(); }
  }, 250);
}

async function doReveal() {
  clearInterval(tick);
  if (room.state !== 'question') return;
  const idx = room.currentQ;
  const q = room.questions[idx];
  const answers = (room.answers && room.answers[idx]) || {};
  // 채점 + 점수 반영
  for (const [pid, a] of Object.entries(answers)) {
    const correct = checkAnswer(q, a.value);
    const remain = Math.max(0, ROUND_MS - (a.answeredAt - room.startedAt));
    const gained = calcScore(correct, remain, !!q.double);
    if (gained > 0) await db.addScore(roomCode, pid, gained);
  }
  await db.setRoomState(roomCode, { state:'reveal' });
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
```

또한 파일 상단 근처의 `async function startHosting(quiz){ if (window.__startHosting) return window.__startHosting(quiz); }` 는 그대로 두어 목록의 "진행" 버튼과 연결됩니다.

- [ ] **Step 2: 브라우저 수동 검증 (탭 2개로 관리자+참가자 흉내 전, 관리자만 우선)**

Run: 브라우저에서 admin.html → 퀴즈 진행 시작
Expected(체크리스트):
- "진행" 클릭 시 방 코드 6자리 표시, Firebase `rooms/<코드>` 생성 확인
- "시작하기" → 문제 + 타이머 링이 20→0 감소, 마지막 5초 붉게 확대/펄스
- "정답 공개" → 정답과 현재 순위 표시
- 마지막 문제에서 "최종 결과 발표" → TOP3 시상대 + 전체 순위

- [ ] **Step 3: 커밋**

```bash
git add js/admin.js
git commit -m "feat: admin room hosting, 20s timer, scoring, leaderboard, podium"
```

---

## Task 6: 참가자 화면

**Files:**
- Create: `index.html`
- Create: `js/player.js`

**Interfaces:**
- Consumes: Task 3 db(joinRoom/subscribeRoom/submitAnswer/serverNow), Task 1 logic(ROUND_MS)
- Produces: 참가자 join → 대기 → 문제 응답 → 결과 표시 흐름.

- [ ] **Step 1: index.html 작성**

`index.html`:
```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>퀴즈 배틀</title>
<link rel="stylesheet" href="css/style.css">
</head>
<body>
<div class="wrap">
  <section id="join" class="panel">
    <h1 class="center">🖍️ 퀴즈 배틀</h1>
    <input id="code" placeholder="방 코드 6자리" maxlength="6" style="text-transform:uppercase;text-align:center;font-size:1.6rem;letter-spacing:.2em">
    <input id="nick" class="mt" placeholder="닉네임" maxlength="12">
    <div class="mt center"><button class="btn" id="joinBtn">입장하기</button></div>
    <p id="joinErr" class="hidden center" style="color:var(--danger)">방을 찾을 수 없어요.</p>
  </section>
  <section id="stage" class="panel hidden"></section>
</div>
<script type="module" src="js/player.js"></script>
</body>
</html>
```

- [ ] **Step 2: js/player.js 작성**

`js/player.js`:
```javascript
import * as db from './firebase.js';
import { ROUND_MS } from './logic.js';

const $ = s => document.querySelector(s);
let code=null, playerId=null, room=null, myAnswer={}, tick=null;

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
    if (sec<=0) clearInterval(tick);
  }, 300);
}

async function submit(idx, q, rawValue) {
  if (myAnswer[idx] !== undefined) return;
  const now = await db.serverNow();
  const value = q.type==='mc' ? Number(rawValue) : rawValue;
  myAnswer[idx] = value;
  clearInterval(tick);
  await db.submitAnswer(code, idx, playerId, { value, answeredAt: now });
  render();
}

function renderResult(s) {
  const me = (room.players||{})[playerId] || {};
  const ranked = Object.values(room.players||{}).sort((a,b)=>(b.score||0)-(a.score||0));
  const myRank = ranked.findIndex(p => p.nick===me.nick) + 1;
  s.innerHTML = `<h2 class="center">현재 내 점수</h2>
    <div class="center" style="font-size:3rem">${me.score||0}점</div>
    <p class="center">현재 순위: ${myRank}위 / ${ranked.length}명</p>
    <p class="center">다음 문제를 기다려 주세요…</p>`;
}

function renderFinal(s) {
  const me = (room.players||{})[playerId] || {};
  const ranked = Object.values(room.players||{}).sort((a,b)=>(b.score||0)-(a.score||0));
  const myRank = ranked.findIndex(p => p.nick===me.nick) + 1;
  s.innerHTML = `<h1 class="center">🏁 끝!</h1>
    <div class="center" style="font-size:3rem">${myRank}위</div>
    <p class="center">${escT(me.nick)} · ${me.score||0}점</p>`;
}
function escT(s){ return String(s??'').replace(/</g,'&lt;'); }
```

- [ ] **Step 3: 2-탭 통합 수동 검증**

Run: 브라우저 탭 A(admin.html)에서 방 진행, 탭 B(index.html)에서 참가
Expected(체크리스트):
- 탭 B에서 코드+닉네임 입장 → 탭 A 대기실에 닉네임 뱃지 등장
- 탭 A "시작하기" → 탭 B에 문제/카운트다운 표시, 정답 탭하면 "제출 완료"
- 탭 A "정답 공개" → 탭 B에 내 점수·순위 표시 (빠른 정답이 더 높은 점수)
- 단답형: 내부 띄어쓰기 틀린 답은 오답 처리 확인
- 끝까지 진행 → 탭 B에 최종 순위, 탭 A에 시상대

- [ ] **Step 4: 커밋**

```bash
git add index.html js/player.js
git commit -m "feat: participant join, answer, live score/rank views"
```

---

## Task 7: 배포 (GitHub Pages)

**Files:**
- Modify: `README.md` (배포 확인 후 실제 URL 기입)

**Interfaces:**
- Consumes: 전체 앱
- Produces: 공개 URL

- [ ] **Step 1: 저장소 푸시 & Pages 활성화**

```bash
git remote add origin <저장소 URL>   # 최초 1회
git push -u origin main
```
GitHub → Settings → Pages → Source: `main` / `/ (root)` 저장.

- [ ] **Step 2: 라이브 확인 (수동)**

Expected(체크리스트):
- `https://<user>.github.io/<repo>/admin.html` 정상 로드, 암호 입장
- `https://<user>.github.io/<repo>/index.html` 폰에서 코드 입장 → 실시간 진행
- 서로 다른 기기(폰 여러 대)에서 동시 접속·순위 동기화 확인

- [ ] **Step 3: README에 실제 URL 기입 후 커밋**

```bash
git add README.md
git commit -m "docs: add live URLs"
git push
```

---

## Self-Review

**1. Spec coverage**
- 실시간 동기형 → Task 5/6 ✅
- 6자리 코드+닉네임 → Task 1(코드생성)/3(joinRoom)/6 ✅
- 4지선다·O/X·단답형(정확 일치) → Task 1(checkAnswer)/4(편집)/6(응답) ✅
- 점수 100 + 속도 보너스 + x2 → Task 1(calcScore)/5(채점) ✅
- 20초 고정 + 긴박 연출 → Task 2(CSS urgent)/5(runTimer) ✅
- 여러 퀴즈쇼 제작·전환 → Task 4(편집/목록) ✅
- 관리자 암호 → Task 4 ✅
- 다크 칠판 크레용 → Task 2 ✅
- Firebase + GitHub Pages → Task 3/7 ✅

**2. Placeholder scan:** firebaseConfig/ADMIN_PASSWORD/저장소 URL은 사용자가 채워야 하는 실제 설정값이며 README에 절차 명시 — 계획상의 placeholder 아님. 그 외 TBD/TODO 없음.

**3. Type consistency:** `checkAnswer(question, value)`, `calcScore(isCorrect, remainingMs, isDouble)`, `rankPlayers(players)`, room 필드(`state/currentQ/startedAt/players/answers`), answer payload `{value, answeredAt}` — Task 1/3/5/6에서 동일하게 사용됨 ✅

## 알려진 트레이드오프 (워크숍용 수용)
- DB 규칙이 공개 read/write(내부 워크숍 전제). 공개 배포 시 규칙 강화 필요 — README 6절.
- 채점을 관리자 클라이언트가 수행(정답 공개 시). 관리자 화면이 진행 주체이므로 문제 없음.
- 닉네임 기반 순위 표시 — 동일 닉네임 중복 시 순위 표기 혼동 가능(점수 자체는 playerId로 정확).
