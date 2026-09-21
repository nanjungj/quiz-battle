# 퀴즈 배틀 리디자인 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 퀴즈 배틀을 라이트 테마로 다시 디자인하고, 이미지 문제와 문제별 순위를 추가하며, 최종 결과를 프로젝터·강사·개인 세 화면으로 분리한다.

**Architecture:** 빌드 도구 없는 정적 HTML + ES 모듈 구조를 그대로 유지한다. 순수 로직은 `js/logic.js`에 모아 `node --test`로 검증하고, Firebase 접근은 `js/firebase.js`에만 둔다. 이미지는 Firebase Storage(유료) 대신 이미 쓰고 있는 Realtime Database의 `quizImages/` 경로에 압축된 data URL로 저장하고, 문제에는 참조 id만 넣는다.

**Tech Stack:** 정적 HTML/CSS/ES 모듈, Firebase Realtime Database v10 (CDN), Pretendard (jsDelivr CDN), qrcodejs (cdnjs CDN), Node.js 내장 테스트 러너

**Spec:** `docs/superpowers/specs/2026-09-16-quiz-battle-redesign-design.md`

## Global Constraints

- 빌드 단계 없음 — 브라우저가 바로 읽는 ES 모듈만 사용. 번들러·트랜스파일러·npm 의존성 추가 금지
- 테스트 명령은 `node --test` (저장소 루트에서). 기존 테스트 8개가 계속 통과해야 한다
- `js/logic.js`의 기존 함수(`generateRoomCode`, `normalize`, `checkAnswer`, `calcScore`, `rankPlayers`)와 `ROUND_MS`·`BASE_POINTS`·`MAX_SPEED_BONUS` 상수는 **수정 금지**. 추가만 한다
- `js/music.js`는 이 계획에서 **수정하지 않는다**
- 색은 이 6개 토큰만 쓴다: `--primary:#6C4CF1`, `--mint:#12C2A0`, `--amber:#F5A623`, `--coral:#FF5A5F`, `--ink:#1E1B2E`, `--bg:#F4F3FA` (+ `--ink2:#6B6580`, `--card:#FFFFFF`, `--line:#E6E3F2` 중성)
- 폰트는 Pretendard. 폴백 스택 `'Pretendard Variable',Pretendard,system-ui,-apple-system,'Malgun Gothic',sans-serif`
- **이미지를 `rooms/` 경로 안에 넣지 않는다.** 방은 참가자 전원이 구독 중이라 갱신마다 전부 재전송된다
- 이미지 data URL 상한 400KB, 원본 파일 상한 20MB
- 화면에 보이는 모든 문구는 한국어. 사용자가 읽을 오류 메시지는 무엇이 잘못됐고 어떻게 하면 되는지 말한다
- 사용자 입력 문자열은 반드시 이스케이프한다 (`esc()` / `escT()` 기존 헬퍼)
- 커밋 메시지는 한국어 본문, 영어 prefix (`feat:`, `fix:`, `docs:`, `style:`)

---

### Task 1: 문제별 순위와 정답 집계 로직

`js/logic.js`에 순수 함수 두 개를 추가한다. Firebase도 DOM도 건드리지 않으므로 전부 단위 테스트로 검증한다.

**Files:**
- Modify: `js/logic.js` (파일 끝에 추가)
- Test: `test/logic.test.js` (파일 끝에 추가)

**Interfaces:**
- Consumes: 기존 `ROUND_MS`, `checkAnswer(question, value)`, `calcScore(isCorrect, remainingMs, isDouble)`
- Produces:
  - `rankQuestion(question, answersForQ, players, startedAt) → [{ id, nick, elapsedMs, gained }]`
    한 문제의 순위. 점수를 얻은 사람만(정답 + 제한시간 내), 빨리 맞힌 순. 동점은 nick 오름차순
  - `summarize(questions, answers, players, startedAt) → { [playerId]: { correct, answered } }`
    참가자별 맞힌 개수와 제출 개수

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/logic.test.js` 끝에 붙인다. 파일 상단 import 문에 `rankQuestion`, `summarize`를 추가하는 것도 잊지 말 것.

```js
test('rankQuestion: 정답자만, 빨리 맞힌 순', () => {
  const q = { type: 'mc', choices: ['a','b','c','d'], answer: 1, double: false };
  const players = { p1:{nick:'가가'}, p2:{nick:'나나'}, p3:{nick:'다다'} };
  const answers = {
    p1: { value: 1, answeredAt: 1000 + 5000 },   // 정답, 5.0초
    p2: { value: 1, answeredAt: 1000 + 2000 },   // 정답, 2.0초
    p3: { value: 3, answeredAt: 1000 + 1000 },   // 오답 — 제외
  };
  const ranked = rankQuestion(q, answers, players, 1000);
  assert.deepEqual(ranked.map(r => r.nick), ['나나', '가가']);
  assert.deepEqual(ranked.map(r => r.elapsedMs), [2000, 5000]);
});

test('rankQuestion: 제한시간을 넘긴 답은 제외', () => {
  const q = { type: 'ox', answer: 'O', double: false };
  const players = { p1:{nick:'가가'}, p2:{nick:'나나'} };
  const answers = {
    p1: { value: 'O', answeredAt: 1000 + ROUND_MS },      // 딱 20초 — 남은 시간 0 → 제외
    p2: { value: 'O', answeredAt: 1000 + ROUND_MS - 1 },  // 아슬아슬하게 통과
  };
  const ranked = rankQuestion(q, answers, players, 1000);
  assert.deepEqual(ranked.map(r => r.nick), ['나나']);
});

test('rankQuestion: gained는 calcScore와 일치하고 x2가 반영된다', () => {
  const q = { type: 'mc', choices: ['a','b'], answer: 0, double: true };
  const players = { p1:{nick:'가가'} };
  const answers = { p1: { value: 0, answeredAt: 1000 } };  // 0초 경과 = 남은시간 만점
  const ranked = rankQuestion(q, answers, players, 1000);
  assert.equal(ranked[0].gained, calcScore(true, ROUND_MS, true)); // 400
});

test('rankQuestion: 같은 시간이면 nick 오름차순, 빈 응답은 빈 배열', () => {
  const q = { type: 'ox', answer: 'O', double: false };
  const players = { p1:{nick:'나나'}, p2:{nick:'가가'} };
  const answers = {
    p1: { value: 'O', answeredAt: 3000 },
    p2: { value: 'O', answeredAt: 3000 },
  };
  assert.deepEqual(rankQuestion(q, answers, players, 1000).map(r => r.nick), ['가가', '나나']);
  assert.deepEqual(rankQuestion(q, {}, players, 1000), []);
  assert.deepEqual(rankQuestion(q, null, players, 1000), []);
});

test('rankQuestion: 방을 나간(players에 없는) 응답은 무시', () => {
  const q = { type: 'ox', answer: 'O', double: false };
  const players = { p1: { nick: '가가' } };
  const answers = {
    p1: { value: 'O', answeredAt: 2000 },
    ghost: { value: 'O', answeredAt: 1500 },
  };
  assert.deepEqual(rankQuestion(q, answers, players, 1000).map(r => r.id), ['p1']);
});

test('summarize: 참가자별 맞힌 개수와 제출 개수', () => {
  const questions = [
    { type:'mc', choices:['a','b'], answer:0 },
    { type:'ox', answer:'O' },
  ];
  const players = { p1:{nick:'가가'}, p2:{nick:'나나'}, p3:{nick:'다다'} };
  const answers = {
    0: { p1:{value:0,answeredAt:2000}, p2:{value:1,answeredAt:2000} },
    1: { p1:{value:'O',answeredAt:2000} },
  };
  const s = summarize(questions, answers, players, 1000);
  assert.deepEqual(s.p1, { correct: 2, answered: 2 });
  assert.deepEqual(s.p2, { correct: 0, answered: 1 });
  assert.deepEqual(s.p3, { correct: 0, answered: 0 });  // 한 번도 안 낸 사람도 들어간다
});

test('summarize: 제한시간을 넘긴 정답은 맞힌 것으로 세지 않는다', () => {
  const questions = [{ type:'ox', answer:'O' }];
  const players = { p1:{nick:'가가'} };
  const answers = { 0: { p1:{ value:'O', answeredAt: 1000 + ROUND_MS + 500 } } };
  const s = summarize(questions, answers, players, 1000);
  assert.deepEqual(s.p1, { correct: 0, answered: 1 });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test`
Expected: FAIL — `SyntaxError: The requested module '../js/logic.js' does not provide an export named 'rankQuestion'`

- [ ] **Step 3: 최소 구현을 쓴다**

`js/logic.js` 끝에 붙인다.

```js
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

// 참가자별 맞힌 개수 / 제출 개수. 맞힌 개수는 점수를 얻은 답만 센다
// (제한시간을 넘겨 도착한 정답은 점수가 0이므로 맞힌 것으로 세지 않는다).
export function summarize(questions, answers, players, startedAt) {
  const out = {};
  Object.keys(players || {}).forEach(id => { out[id] = { correct: 0, answered: 0 }; });
  (questions || []).forEach((q, i) => {
    const forQ = (answers && answers[i]) || {};
    Object.entries(forQ).forEach(([id, a]) => {
      if (!out[id]) return;
      out[id].answered++;
      const elapsedMs = Math.max(0, (a.answeredAt || 0) - (startedAt || 0));
      if (checkAnswer(q, a.value) && ROUND_MS - elapsedMs > 0) out[id].correct++;
    });
  });
  return out;
}
```

> **주의:** `summarize`의 `startedAt`은 방 전체의 마지막 `startedAt` 하나뿐이다. 문제마다 시작 시각이 다르므로 이 값으로 과거 문제의 경과 시간을 정확히 계산할 수는 없다. Task 10에서 `summarize`를 호출할 때는 `startedAt`에 `0`을 넘겨 "제한시간 검사 없이 정답 여부만" 세도록 한다 — 어차피 참가자 화면이 20초에 입력을 막으므로 실제로 늦은 답은 시계 오차 수준에서만 생긴다. 이 테스트는 함수 자체의 규칙을 고정하는 것이다.

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `node --test`
Expected: PASS — `tests 15`, `pass 15`, `fail 0`

- [ ] **Step 5: 커밋**

```bash
git add js/logic.js test/logic.test.js
git commit -m "feat: 문제별 순위(rankQuestion)와 정답 집계(summarize) 로직

- rankQuestion: 정답 + 제한시간 내 응답만, 빨리 맞힌 순
- summarize: 참가자별 맞힌 개수 / 제출 개수
- 테스트 7개 추가 (총 15개)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 디자인 토대 — 팔레트와 공통 컴포넌트

`css/style.css`를 새 팔레트로 전면 재작성한다. 이 시점에는 화면 마크업이 아직 옛날 것이지만, 클래스 이름을 그대로 유지하므로 화면이 깨지지 않고 색과 폰트만 바뀐다. 이후 Task 3~5가 마크업을 다듬는다.

**Files:**
- Rewrite: `css/style.css`
- Modify: `index.html` (Pretendard `<link>` 추가, Gaegu 흔적 제거)
- Modify: `admin.html` (Pretendard `<link>` 추가)

**Interfaces:**
- Produces (이후 모든 Task가 쓰는 CSS 클래스):
  - 레이아웃: `.wrap`, `.panel`, `.row`, `.stack`, `.center`, `.mt`, `.hidden`, `.spacer`
  - 버튼: `.btn`, `.btn-ghost`, `.btn-lg`
  - 보기: `.opts`, `.choice`(+`.c1`~`.c4`), `.choice .shape`, `.choice.picked`, `.choice.dim`, `.ox`, `.ox-btn`(+`.o`/`.x`)
  - 진행: `.tbar`(자식 `i`), `.timer-ring`(+`.warn`/`.urgent`, 내부 `.timer-num`)
  - 순위: `.lrow`(내부 `.n`/`.s`), `.podium`, `.podium .bar`
  - 배지: `.pill`, `.pill-primary`, `.pill-amber`, `.pill-mint`
  - 이미지: `.qimg`, `.qimg img`, `.qimg.loading`
  - 결과: `.feedback`(+`.ok`/`.no`), `.result-card`
  - 기타: `.qr-box`, `.join-code`, `.mute-btn`, `.field`, `.err`
  - 대형 스크린 확대: `body.admin` 아래 규칙

- [ ] **Step 1: `css/style.css`를 통째로 아래 내용으로 교체**

```css
/* 퀴즈 배틀 — 라이트 테마
   색은 4색(보라/민트/앰버/코랄) + 중성 3색만 쓴다. 보기 버튼은 색으로 전면을
   채우지 않고 좌측 컬러 엣지 + 도형 배지로 구분한다 — 색만으로 구분하지 않으므로
   저화질 프로젝터와 색약자에게도 읽힌다. */

:root{
  --primary:#6C4CF1; --primary-d:#5335D4;
  --mint:#12C2A0; --amber:#F5A623; --coral:#FF5A5F;
  --ink:#1E1B2E; --ink2:#6B6580;
  --bg:#F4F3FA; --card:#FFFFFF; --line:#E6E3F2;
  --r-lg:18px; --r-md:14px; --r-sm:10px;
  --shadow:0 4px 16px rgba(30,27,46,.08);
  --shadow-lg:0 12px 32px rgba(30,27,46,.12);
}
*{ box-sizing:border-box; }
html,body{ height:100%; }
body{
  margin:0; background:var(--bg); color:var(--ink); font-size:16px; line-height:1.5;
  font-family:'Pretendard Variable',Pretendard,system-ui,-apple-system,'Malgun Gothic',sans-serif;
  -webkit-font-smoothing:antialiased;
}
.wrap{
  max-width:860px; margin:0 auto; padding:20px 16px;
  min-height:100%; display:flex; flex-direction:column;
}
h1,h2,h3{ margin:0; font-weight:900; letter-spacing:-.02em; text-wrap:balance; }
h1{ font-size:1.8rem; } h2{ font-size:1.35rem; } h3{ font-size:1.1rem; }
.center{ text-align:center; }
.mt{ margin-top:16px; }
.hidden{ display:none !important; }
.spacer{ flex:1; }
.row{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.stack{ display:flex; flex-direction:column; gap:12px; }
.muted{ color:var(--ink2); }

.panel{
  background:var(--card); border:1px solid var(--line); border-radius:var(--r-lg);
  padding:20px; display:flex; flex-direction:column; gap:14px;
}

/* ── 버튼 ── */
.btn{
  font:inherit; font-weight:900; font-size:1.05rem;
  padding:14px 24px; border-radius:var(--r-md); border:none; cursor:pointer;
  background:var(--primary); color:#fff; box-shadow:0 3px 0 var(--primary-d);
  transition:transform .08s, box-shadow .08s;
}
.btn:hover{ transform:translateY(-1px); box-shadow:0 4px 0 var(--primary-d); }
.btn:active{ transform:translateY(2px); box-shadow:0 1px 0 var(--primary-d); }
.btn:disabled{ opacity:.45; cursor:not-allowed; transform:none; box-shadow:0 3px 0 var(--primary-d); }
.btn-lg{ font-size:1.2rem; padding:18px 34px; }
.btn-ghost{ background:var(--card); color:var(--ink2); border:1px solid var(--line); box-shadow:none; }
.btn-ghost:hover{ box-shadow:none; color:var(--ink); }
.btn-ghost:active{ box-shadow:none; }
:focus-visible{ outline:3px solid var(--primary); outline-offset:2px; }

/* ── 입력 ── */
input,select,textarea{
  font:inherit; width:100%; padding:14px 16px; color:var(--ink);
  background:var(--card); border:1px solid var(--line); border-radius:var(--r-md);
}
input:focus,textarea:focus{ border-color:var(--primary); outline:none; }
input[type=checkbox],input[type=radio]{ width:auto; padding:0; }
.field{ display:flex; flex-direction:column; gap:6px; }
.field > label{ font-size:.85rem; font-weight:700; color:var(--ink2); }
.err{ color:var(--coral); font-weight:700; }

/* ── 보기 (객관식) ── */
.opts{ display:grid; gap:11px; }
.choice{
  position:relative; overflow:hidden; display:flex; align-items:center; gap:14px;
  min-height:64px; padding:12px 16px; text-align:left;
  font:inherit; font-weight:700; color:var(--ink); cursor:pointer;
  background:var(--card); border:1px solid var(--line); border-radius:var(--r-md);
  box-shadow:0 2px 0 rgba(30,27,46,.05);
}
.choice::before{ content:""; position:absolute; left:0; top:0; bottom:0; width:6px; background:var(--c); }
.choice .shape{
  flex:none; width:32px; height:32px; border-radius:9px; background:var(--c); color:#fff;
  display:grid; place-items:center; font-size:.9rem;
}
.choice:hover{ border-color:var(--c); }
.choice.picked{ border-color:var(--c); border-width:2px; box-shadow:var(--shadow-lg); }
.choice.dim{ opacity:.4; }
.choice:disabled{ cursor:default; }
.c1{ --c:var(--primary); } .c2{ --c:var(--mint); } .c3{ --c:var(--amber); } .c4{ --c:var(--coral); }

/* ── O/X ── */
.ox{ display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.ox-btn{
  font:inherit; font-weight:900; font-size:3.4rem; min-height:130px;
  border:none; border-radius:var(--r-lg); cursor:pointer; color:#fff;
  box-shadow:0 4px 0 rgba(30,27,46,.14);
}
.ox-btn.o{ background:var(--mint); } .ox-btn.x{ background:var(--coral); }
.ox-btn.picked{ outline:4px solid var(--ink); outline-offset:3px; }

/* ── 남은 시간 (폰) ── */
.tbar{ height:8px; border-radius:99px; background:var(--line); overflow:hidden; }
.tbar i{ display:block; height:100%; border-radius:99px; background:var(--primary); transition:width .3s linear; }
.tbar.warn i{ background:var(--amber); }
.tbar.urgent i{ background:var(--coral); }

/* ── 남은 시간 (대형 스크린) ── */
.timer-ring{ position:relative; width:96px; height:96px; flex:none; }
.timer-ring svg{ transform:rotate(-90deg); }
.timer-ring circle.bg{ stroke:var(--line); }
.timer-ring circle.fg{ stroke:var(--primary); transition:stroke-dashoffset 1s linear, stroke .3s; }
.timer-ring .timer-num{
  position:absolute; inset:0; display:grid; place-items:center;
  font-size:2rem; font-weight:900; color:var(--primary); font-variant-numeric:tabular-nums;
}
.timer-ring.warn circle.fg, .timer-ring.warn .timer-num{ stroke:var(--amber); color:var(--amber); }
.timer-ring.urgent circle.fg, .timer-ring.urgent .timer-num{ stroke:var(--coral); color:var(--coral); }
.timer-ring.urgent .timer-num{ animation:pulse .5s infinite alternate; }
@keyframes pulse{ from{ transform:scale(1); } to{ transform:scale(1.18); } }

/* ── 순위 ── */
.lrow{
  display:flex; align-items:center; gap:12px; padding:12px 16px;
  background:var(--card); border:1px solid var(--line); border-radius:var(--r-md);
}
.lrow .n{ width:36px; font-weight:900; color:var(--ink2); font-variant-numeric:tabular-nums; }
.lrow .who{ font-weight:700; }
.lrow .s{ margin-left:auto; font-weight:900; color:var(--primary); font-variant-numeric:tabular-nums; }
.lrow.me{ border-color:var(--primary); border-width:2px; }

.podium{ display:grid; grid-template-columns:1fr 1.15fr 1fr; align-items:end; gap:20px; }
.podium .col{ text-align:center; }
.podium .who{ font-size:2rem; font-weight:900; }
.podium .pts{ font-weight:700; opacity:.85; }
.podium .bar{
  margin-top:12px; border-radius:var(--r-md) var(--r-md) 0 0;
  display:grid; place-items:center; font-size:3rem; font-weight:900;
}
.podium .p1 .bar{ height:220px; background:linear-gradient(180deg,var(--amber),#E08A00); color:#3D2A00; font-size:4.5rem; }
.podium .p2 .bar{ height:150px; background:rgba(255,255,255,.2); color:#fff; }
.podium .p3 .bar{ height:110px; background:rgba(255,255,255,.14); color:#fff; }

/* ── 배지 ── */
.pill{
  display:inline-flex; align-items:center; gap:6px; border-radius:999px;
  padding:6px 14px; font-weight:700; font-size:.9rem;
  background:var(--bg); color:var(--ink2); border:1px solid var(--line);
}
.pill-primary{ background:var(--primary); color:#fff; border-color:var(--primary); }
.pill-amber{ background:var(--amber); color:#3D2A00; border-color:var(--amber); }
.pill-mint{ background:var(--mint); color:#fff; border-color:var(--mint); }

/* ── 문제 이미지 ── */
.qimg{
  border-radius:var(--r-md); overflow:hidden; border:1px solid var(--line);
  background:var(--card); display:block; width:100%;
}
.qimg img{ display:block; width:100%; height:auto; }
.qimg.loading{ background:linear-gradient(90deg,var(--line),var(--bg),var(--line)); animation:shimmer 1.2s infinite; }
@keyframes shimmer{ from{ opacity:.6; } to{ opacity:1; } }

/* ── 정답/오답 전체 화면 (참가자) ── */
.feedback{
  flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:16px; text-align:center; color:#fff; border-radius:var(--r-lg); padding:28px 20px;
}
.feedback.ok{ background:var(--mint); } .feedback.no{ background:var(--coral); }
.feedback .mark{
  width:110px; height:110px; border-radius:50%; background:rgba(255,255,255,.22);
  display:grid; place-items:center; font-size:3.4rem; font-weight:900;
}
.feedback .big{ font-size:3.2rem; font-weight:900; letter-spacing:-.02em; font-variant-numeric:tabular-nums; }
.feedback .pill{ background:rgba(255,255,255,.22); color:#fff; border-color:transparent; }

/* ── 개인 결과 카드 ── */
.result-card{
  background:var(--card); border:1px solid var(--line); border-radius:22px;
  padding:30px 22px; text-align:center; box-shadow:var(--shadow-lg);
}
.result-card .rank{ font-size:3.6rem; font-weight:900; color:var(--primary); line-height:1.1; }
.result-card hr{ border:0; border-top:1px solid var(--line); margin:18px 0; }

/* ── 입장 QR (대기실) ── */
.qr-box{ background:#fff; padding:18px; border-radius:20px; display:inline-block; box-shadow:var(--shadow-lg); }
.qr-box img, .qr-box canvas{ display:block; }
.join-code{ font-size:2.6rem; font-weight:900; letter-spacing:.14em; color:var(--primary); }
.join-url{ font-size:.9rem; color:var(--ink2); word-break:break-all; }

/* ── 음소거 버튼 ── */
.mute-btn{
  position:fixed; top:14px; right:14px; z-index:50;
  width:52px; height:52px; border-radius:50%; border:1px solid var(--line); cursor:pointer;
  font-size:1.4rem; background:var(--card); color:var(--ink); box-shadow:var(--shadow);
}
.mute-btn:hover{ transform:scale(1.06); }

/* ══ 참가자 = 폰 ══ */
#join .btn{ width:100%; }
#code{ text-align:center; text-transform:uppercase; font-size:1.9rem; font-weight:900; letter-spacing:.2em; }

/* ══ 관리자 = PC / 대형 스크린 ══ */
body.admin{ font-size:19px; }
body.admin .wrap{ max-width:1180px; padding:28px 36px; }
body.admin h1{ font-size:2.6rem; } body.admin h2{ font-size:2rem; } body.admin h3{ font-size:1.5rem; }
body.admin .btn{ font-size:1.25rem; padding:16px 32px; }
body.admin .choice{ min-height:86px; font-size:1.6rem; padding:14px 22px; }
body.admin .choice .shape{ width:44px; height:44px; border-radius:12px; font-size:1.1rem; }
body.admin .ox-btn{ font-size:5rem; min-height:190px; }
body.admin .lrow{ padding:14px 20px; }
body.admin .lrow .n{ width:44px; font-size:1.3rem; }
body.admin .lrow .who{ font-size:1.45rem; }
body.admin .lrow .s{ font-size:1.45rem; }
body.admin .timer-ring{ width:120px; height:120px; }
body.admin .timer-ring .timer-num{ font-size:2.6rem; }
body.admin .pill{ font-size:1.15rem; padding:9px 20px; }
body.admin .join-code{ font-size:4.4rem; }

@media (prefers-reduced-motion:reduce){ *{ animation:none !important; transition:none !important; } }
```

- [ ] **Step 2: `index.html`의 `<head>`에 Pretendard를 연결**

`<link rel="stylesheet" href="css/style.css">` **바로 앞**에 넣는다 (폰트가 먼저 와야 한다).

```html
<link rel="stylesheet" as="style" crossorigin
      href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css">
```

- [ ] **Step 3: `admin.html`에도 같은 `<link>`를 같은 위치에 추가**

- [ ] **Step 4: `index.html`의 인라인 스타일 정리**

`#code`와 `#nick`의 인라인 `style` 속성을 지운다. 이제 CSS가 담당한다.

```html
<input id="code" placeholder="방 코드 6자리" maxlength="6">
<input id="nick" class="mt" placeholder="닉네임" maxlength="12">
```

`<p id="joinErr" ... style="color:var(--danger)">`의 인라인 스타일을 `class="hidden center err"`로 바꾼다 (`--danger` 토큰은 더 이상 없다).

- [ ] **Step 5: `admin.html`에 남은 `--danger` 참조 제거**

`#pwErr`의 `style="color:var(--danger)"`를 지우고 `class="hidden err"`로 바꾼다.

- [ ] **Step 6: 브라우저에서 확인**

Run: `npx serve .` 후 `http://localhost:3000/index.html`과 `/admin.html`을 연다.
Expected:
- 배경이 밝은 회보라(`#F4F3FA`), 글씨는 Pretendard (손글씨체가 아님)
- 버튼이 보라색, 아래에 3px 그림자
- 개발자 도구 콘솔에 오류 없음
- 검은 글씨가 검은 배경에 깔리는 등 읽을 수 없는 곳이 없음

- [ ] **Step 7: 기존 테스트가 여전히 통과하는지 확인**

Run: `node --test`
Expected: PASS — `pass 15`

- [ ] **Step 8: 커밋**

```bash
git add css/style.css index.html admin.html
git commit -m "style: 라이트 테마 디자인 토대 — 팔레트와 공통 컴포넌트

- 다크 칠판/Gaegu를 걷어내고 보라·민트·앰버·코랄 4색 + 중성 3색으로
- Pretendard 적용 (jsDelivr)
- 보기 버튼은 전면 채색 대신 좌측 컬러 엣지 + 도형 배지
- 폰은 .tbar(가로 바), 대형 스크린은 .timer-ring

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 교육생 화면

`js/player.js`의 렌더 함수들을 새 디자인으로 바꾼다. 입장/문제/제출완료/정답공개/최종. 로직(제출 잠금, 카운트다운, Firebase 호출)은 건드리지 않는다.

**Files:**
- Modify: `index.html` (입장 화면 구조)
- Modify: `js/player.js` (`renderQuestion`, `runCountdown`, `renderResult`, `renderFinal`, `render`의 waiting 분기)

**Interfaces:**
- Consumes: Task 2의 CSS 클래스, Task 1의 `rankQuestion`
- Produces: 없음 (화면만)

- [ ] **Step 1: `index.html`의 입장 화면을 다시 쓴다**

`<div class="wrap">` 안의 `#join` 섹션을 통째로 교체한다.

```html
  <section id="join" class="panel">
    <div class="center stack">
      <div style="font-size:2.6rem;line-height:1">🎯</div>
      <h1 style="color:var(--primary)">퀴즈 배틀</h1>
      <p class="muted" style="margin:0">방 코드를 입력하고 입장하세요</p>
    </div>
    <input id="code" placeholder="방 코드 6자리" maxlength="6">
    <input id="nick" placeholder="닉네임" maxlength="12">
    <button class="btn btn-lg" id="joinBtn">입장하기</button>
    <p id="joinErr" class="hidden center err">방을 찾을 수 없어요. 코드를 다시 확인해 주세요.</p>
  </section>
```

`.panel`이 이미 `gap:14px`이므로 `.mt` 클래스는 뺐다.

- [ ] **Step 2: 대기 화면과 제출 완료 화면을 바꾼다**

`js/player.js`의 `render()` 안 `waiting` 분기를 교체한다.

```js
  if (room.state === 'waiting') {
    s.innerHTML = `<div class="panel center stack">
      <div style="font-size:2.6rem">🎉</div>
      <h2>입장 완료!</h2>
      <p class="muted" style="margin:0">곧 시작해요. 잠시만 기다려 주세요…</p>
    </div>`;
  } else if (room.state === 'question') {
```

- [ ] **Step 3: 문제 화면을 다시 쓴다**

`renderQuestion(s)`를 아래로 교체한다. 앞부분(`idx`/`q`/`answered`/`qKey` 가드)은 그대로 두고 `if (answered)` 이후만 바꾼다.

```js
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
  const sb = document.getElementById('shortBtn');
  if (sb) sb.onclick = () => submit(idx, q, document.getElementById('shortIn').value);
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
```

파일 상단(`const $ = ...` 아래)에 상수를 추가한다.

```js
const SHAPES = ['▲', '◆', '●', '■'];
```

- [ ] **Step 4: 카운트다운을 숫자에서 바로 바꾼다**

`runCountdown()`을 교체한다.

```js
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
```

> `#secDisplay`를 더 이상 쓰지 않으므로 그 참조는 모두 사라진다.

- [ ] **Step 5: 정답 공개 화면을 전체 화면 피드백으로 바꾼다**

`renderResult(s)`를 교체한다. 이 단계에서는 문제별 순위 없이 정답/오답과 누적 순위만 넣는다 (문제별 순위는 Task 9).

```js
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
    <div class="muted" style="color:rgba(255,255,255,.85)">다음 문제를 기다려 주세요</div>
  </div>`;
}
```

`js/player.js` 상단의 import에 `checkAnswer`를 추가한다.

```js
import { ROUND_MS, rankPlayers, checkAnswer } from './logic.js';
```

- [ ] **Step 6: 개인 최종 화면을 다시 쓴다**

`renderFinal(s)`를 교체한다. 맞힌 개수는 Task 10에서 붙이므로 여기서는 등수·인원·점수까지만.

```js
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
```

- [ ] **Step 7: `#stage`가 세로로 늘어나게 한다**

`index.html`의 `<section id="stage" class="panel hidden"></section>`를 아래로 바꾼다. 렌더 함수들이 각자 `.panel`을 그리므로 `#stage`는 껍데기만 맡는다.

```html
  <section id="stage" class="hidden stack" style="flex:1"></section>
```

- [ ] **Step 8: 브라우저에서 확인**

Run: `npx serve .` → 관리자 탭에서 방을 열고, 다른 탭(또는 폰)에서 `index.html`로 입장해 한 문제를 푼다.
브라우저 개발자 도구에서 반응형 모드를 켜고 **폭 390px**로 맞춘다.
Expected:
- 입장 화면: 코드 입력칸 글자가 크고 가운데 정렬, 입장 버튼이 가로 꽉 참
- 문제 화면: 보기 4개가 화면 세로를 나눠 채우고 각 버튼 높이 64px 이상, 가로 스크롤 없음
- 답을 누르면 고른 답이 카드로 남고 "제출했어요"
- 정답 공개: 화면이 민트(정답) 또는 코랄(오답)로 덮이고 누적 순위 표시
- 마지막 5초에 시간 바가 코랄로 변함

- [ ] **Step 9: 커밋**

```bash
git add index.html js/player.js
git commit -m "feat: 교육생 화면 리디자인

- 보기 버튼이 화면 세로를 균등 분할, 도형 배지(▲◆●■)로 구분
- 남은 시간을 숫자 대신 줄어드는 가로 바로
- 제출 후 고른 답을 그대로 보여 줌
- 정답 공개를 전체 화면 민트/코랄 피드백으로
- 개인 최종 결과 카드

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 강사 진행 화면

`js/admin.js`의 진행(host) 렌더 함수들을 새 디자인으로 바꾼다. 대기실/문제/정답공개. 최종 결과는 Task 10에서 다룬다.

**Files:**
- Modify: `js/admin.js` (`renderHost`의 waiting 분기, `renderQuestionScreen`, `renderChoicesPreview`, `runTimer`, `renderReveal`)
- Modify: `admin.html` (음소거 버튼은 그대로, 게이트/목록 화면 마크업 정리)

**Interfaces:**
- Consumes: Task 2의 CSS 클래스
- Produces: `answeredCount(room)` — 현재 문제에 제출한 사람 수 (Task 9에서도 쓴다)

- [ ] **Step 1: `admin.html`의 게이트와 목록 화면을 정리**

`#gate`와 `#list` 섹션을 교체한다.

```html
  <!-- 암호 게이트 -->
  <section id="gate" class="panel">
    <h1>🎯 퀴즈 배틀 관리자</h1>
    <p class="muted" style="margin:0">관리자 암호를 입력하세요.</p>
    <input id="pw" type="password" placeholder="암호">
    <button class="btn" id="pwBtn">입장</button>
    <p id="pwErr" class="hidden err">암호가 틀렸어요.</p>
  </section>

  <!-- 퀴즈쇼 목록 -->
  <section id="list" class="panel hidden">
    <h1>내 퀴즈쇼</h1>
    <div id="quizList" class="stack"></div>
    <button class="btn" id="newQuizBtn">＋ 새 퀴즈쇼 만들기</button>
  </section>
```

- [ ] **Step 2: 목록 행을 정리한다**

`js/admin.js`의 `openList()` 안 `quizzes.forEach(...)` 블록을 교체한다.

```js
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
    const del  = mkBtn('🗑', async () => {
      if (confirm(`"${q.title || '(제목 없음)'}" 퀴즈쇼를 삭제할까요?`)) { await db.deleteQuiz(q.id); openList(); }
    }, true);
    actions.append(play, edit, del);
    row.append(actions);
    box.append(row);
  });
```

`mkBtn`에 ghost 옵션을 더한다.

```js
function mkBtn(label, fn, ghost) {
  const b = document.createElement('button');
  b.className = ghost ? 'btn btn-ghost' : 'btn';
  b.textContent = label;
  b.onclick = fn;
  return b;
}
```

- [ ] **Step 3: 대기실을 좌우 2단으로 바꾼다**

`renderHost()`의 `waiting` 분기 안 `host.innerHTML = ...`를 교체한다. `dir`/`joinUrl` 계산과 `renderQR(joinUrl)`, `startBtn` 바인딩은 그대로 둔다.

```js
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
```

- [ ] **Step 4: 문제 화면에 제출 카운터를 넣는다**

`renderQuestionScreen()`을 교체한다.

```js
function renderQuestionScreen() {
  const host = document.getElementById('host');
  const q = room.questions[room.currentQ];
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
    <h2 style="font-size:2.6rem">${escT(q.text)}</h2>
    ${renderChoicesPreview(q)}
    <div class="row" style="justify-content:flex-end">
      <button class="btn" id="revealBtn">정답 공개 →</button>
    </div>
  </div>`;
  document.getElementById('revealBtn').onclick = (e) => { e.currentTarget.disabled = true; doReveal(); };
  runTimer();
}

// 현재 문제에 제출한 사람 수
function answeredCount(r) {
  if (!r || r.currentQ == null) return 0;
  return Object.keys(((r.answers || {})[r.currentQ]) || {}).length;
}
```

- [ ] **Step 5: 보기 미리보기를 새 디자인으로 바꾼다**

`renderChoicesPreview(q)`를 교체하고, 파일 상단에 `SHAPES` 상수를 추가한다 (`const views = [...]` 근처).

```js
const SHAPES = ['▲', '◆', '●', '■'];

function renderChoicesPreview(q) {
  if (q.type === 'mc') {
    return `<div class="opts" style="grid-template-columns:1fr 1fr;flex:1">${q.choices.map((c, j) =>
      `<div class="choice c${j + 1}"><span class="shape">${SHAPES[j]}</span><span>${escT(c)}</span></div>`
    ).join('')}</div>`;
  }
  if (q.type === 'ox') {
    return `<div class="ox" style="flex:1"><div class="ox-btn o">O</div><div class="ox-btn x">X</div></div>`;
  }
  return `<div class="panel center muted" style="flex:1;justify-content:center">단답형 — 참가자가 폰에서 직접 입력합니다</div>`;
}
```

- [ ] **Step 6: 타이머가 제출 카운터도 갱신하게 한다**

`runTimer()`의 `setInterval` 콜백 안, `if (ring) ...` 줄 **다음**에 두 줄을 넣는다.

```js
    const cnt = document.getElementById('submitCount');
    if (cnt) cnt.firstChild.nodeValue = String(answeredCount(room));
```

> `firstChild`는 숫자 텍스트 노드다. `innerHTML`을 다시 쓰면 안쪽 `<span>`이 날아간다.

- [ ] **Step 7: 정답 공개 화면을 정리한다**

`renderReveal()`을 교체한다. 좌우 2단 순위는 Task 9에서 넣고, 지금은 정답 띠 + 누적 순위까지만.

```js
function renderReveal() {
  const host = document.getElementById('host');
  const q = room.questions[room.currentQ];
  const ranked = rankPlayers(room.players);
  const answerText = q.type === 'mc' ? q.choices[q.answer]
                   : q.type === 'ox' ? q.answer
                   : (q.accepted || [q.answer]).join(' / ');
  const correctCount = Object.values(((room.answers || {})[room.currentQ]) || {})
    .filter(a => checkAnswer(q, a.value)).length;
  const last = room.currentQ >= room.questions.length - 1;

  host.innerHTML = `<div class="panel" style="flex:1">
    <div class="row" style="background:var(--mint);color:#fff;border-radius:var(--r-lg);padding:20px 26px;flex-wrap:nowrap">
      <span style="width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.24);
                   display:grid;place-items:center;font-size:1.6rem;font-weight:900;flex:none">✓</span>
      <span style="font-weight:700;opacity:.9">정답</span>
      <span style="font-size:2rem;font-weight:900">${escT(answerText)}</span>
      <span class="spacer"></span>
      <span style="font-weight:700;opacity:.92">${correctCount}명 맞힘</span>
    </div>
    <h3 class="muted">누적 순위</h3>
    <div class="stack" style="flex:1">
      ${ranked.slice(0, 5).map((r, i) =>
        `<div class="lrow"><span class="n">${i + 1}</span><span class="who">${escT(r.nick)}</span>
         <span class="s">${r.score}</span></div>`).join('')}
    </div>
    <div class="row" style="justify-content:flex-end">
      ${last ? '<button class="btn btn-lg" id="endBtn">최종 결과 발표 🏆</button>'
             : '<button class="btn btn-lg" id="nextBtn">다음 문제 →</button>'}
    </div>
  </div>`;
  const nb = document.getElementById('nextBtn'); if (nb) nb.onclick = () => gotoQuestion(room.currentQ + 1);
  const eb = document.getElementById('endBtn'); if (eb) eb.onclick = () => db.setRoomState(roomCode, { state: 'ended' });
}
```

- [ ] **Step 8: 브라우저에서 확인**

Run: `npx serve .` → `admin.html`에서 퀴즈를 하나 진행한다. 창을 **1280px 이상**으로 넓힌다.
Expected:
- 대기실: QR이 왼쪽, 방 코드가 오른쪽에 크게(4.4rem). 참가자가 들어오면 칩이 늘어남
- 문제 화면: 우상단에 `제출 3 / 5`가 실시간으로 올라감, 타이머 링이 10초에 앰버·5초에 코랄
- 정답 공개: 민트 띠에 정답과 "N명 맞힘", 아래 누적 순위 5명
- 콘솔 오류 없음

- [ ] **Step 9: 커밋**

```bash
git add admin.html js/admin.js
git commit -m "feat: 강사 진행 화면 리디자인

- 대기실을 QR/코드 좌우 2단으로
- 문제 화면에 제출 카운터(answeredCount) 추가
- 정답 공개에 정답 띠와 맞힌 인원 표시
- 목록 행을 .lrow로 정리

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 퀴즈 편집기

문항 카드를 접고 펴게 하고, 순서 이동·복제를 넣고, 정답 지정을 라디오 버튼에서 동그라미 체크로 바꾼다. 이미지는 Task 7에서 얹는다.

**Files:**
- Modify: `admin.html` (`#editor` 섹션)
- Modify: `js/admin.js` (`openEditor`, `renderQuestions`, 추가 버튼 핸들러)
- Modify: `css/style.css` (편집기 전용 클래스 추가)

**Interfaces:**
- Consumes: Task 2의 CSS 클래스
- Produces:
  - 모듈 변수 `openIdx` — 현재 펼친 문항 번호 (없으면 `-1`)
  - `.qcard`, `.qcard.open`, `.qcard-head`, `.qcard-body`, `.ansopt`, `.ansopt.on`, `.ansopt .dot`, `.addrow` CSS 클래스

- [ ] **Step 1: 편집기 전용 CSS를 `css/style.css` 끝에 추가**

```css
/* ── 퀴즈 편집기 ── */
.qcard{ background:var(--card); border:1px solid var(--line); border-radius:var(--r-md); }
.qcard.open{ border:2px solid var(--primary); box-shadow:var(--shadow-lg); }
.qcard-head{ display:flex; align-items:center; gap:12px; padding:14px 18px; cursor:pointer; }
.qcard-head .title{ font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.qcard-head .tools{ margin-left:auto; display:flex; gap:6px; }
.qcard-head .tools button{
  font:inherit; background:transparent; border:none; cursor:pointer;
  color:var(--ink2); padding:6px 8px; border-radius:var(--r-sm);
}
.qcard-head .tools button:hover{ background:var(--bg); color:var(--ink); }
.qcard-body{ display:flex; flex-direction:column; gap:12px; padding:0 18px 18px; }
.ansopt{
  display:flex; align-items:center; gap:10px; padding:8px 12px;
  border:1px solid var(--line); border-radius:var(--r-md); background:var(--card);
}
.ansopt.on{ border:2px solid var(--mint); background:rgba(18,194,160,.07); }
.ansopt .dot{
  flex:none; width:28px; height:28px; border-radius:50%; cursor:pointer;
  border:2px solid var(--line); background:var(--card);
  display:grid; place-items:center; font-weight:900; color:transparent;
}
.ansopt.on .dot{ border-color:var(--mint); background:var(--mint); color:#fff; }
.ansopt input{ border:none; padding:6px 0; background:transparent; }
.ansopt input:focus{ border:none; }
.addrow{ display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
.addrow button{
  font:inherit; font-weight:700; color:var(--ink2); cursor:pointer;
  background:var(--card); border:2px dashed var(--line); border-radius:var(--r-md); padding:18px;
}
.addrow button:hover{ border-color:var(--primary); color:var(--primary); }
@media (max-width:640px){ .addrow{ grid-template-columns:1fr; } }
```

- [ ] **Step 2: `admin.html`의 `#editor` 섹션을 교체**

```html
  <!-- 편집기 -->
  <section id="editor" class="panel hidden">
    <div class="row">
      <button class="btn btn-ghost" id="backToList">← 목록</button>
      <h2 class="spacer">퀴즈쇼 편집</h2>
      <button class="btn" id="saveQuiz">저장</button>
    </div>
    <input id="quizTitle" placeholder="퀴즈쇼 제목">
    <div id="questions" class="stack"></div>
    <div class="addrow">
      <button id="addMc">＋ 객관식</button>
      <button id="addOx">＋ O / X</button>
      <button id="addShort">＋ 단답형</button>
    </div>
  </section>
```

- [ ] **Step 3: 펼침 상태를 관리하는 변수를 추가**

`js/admin.js`의 `let draft = null;` 옆에 넣는다.

```js
let draft = null, openIdx = -1;
```

`openEditor(quiz)` 안에서 퀴즈를 열 때 초기화한다. `draft = JSON.parse(...)` 다음 줄에 추가.

```js
  openIdx = draft.questions.length ? 0 : -1;
```

- [ ] **Step 4: 문항 추가 버튼이 새 문항을 펼친 채로 열게 한다**

세 핸들러를 교체한다.

```js
const TYPE_LABEL = { mc: '객관식', ox: 'O/X', short: '단답형' };
function addQuestion(q) {
  draft.questions.push(q);
  openIdx = draft.questions.length - 1;
  renderQuestions();
}
document.getElementById('addMc').onclick = () =>
  addQuestion({ type:'mc', text:'', choices:['','','',''], answer:0, double:false });
document.getElementById('addOx').onclick = () =>
  addQuestion({ type:'ox', text:'', answer:'O', double:false });
document.getElementById('addShort').onclick = () =>
  addQuestion({ type:'short', text:'', answer:'', accepted:[''], double:false });
```

기존 `$('#addMc').onclick = ...` 세 줄은 지운다.

- [ ] **Step 5: `renderQuestions()`를 다시 쓴다**

```js
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
        <button data-del="${i}" title="삭제">🗑</button>
        <button data-open2="${i}" title="펼치기/접기">${i === openIdx ? '⌃' : '⌄'}</button>
      </span>
    </div>`;

    if (i === openIdx) {
      html += '<div class="qcard-body">';
      html += `<div class="field"><label for="qtext${i}">문제 내용</label>
        <input id="qtext${i}" placeholder="문제 내용" value="${esc(q.text)}" data-text="${i}"></div>`;
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
}

function move(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= draft.questions.length) return;
  const [q] = draft.questions.splice(i, 1);
  draft.questions.splice(j, 0, q);
  openIdx = j;
  renderQuestions();
}
```

> **주의:** 정답을 바꾸면 `renderQuestions()`로 다시 그린다. 그러면 입력 중이던 보기 텍스트의 커서가 날아간다 — 하지만 정답 동그라미는 마우스로 누르는 동작이라 텍스트 입력 중에 발생하지 않는다. 보기 텍스트 `oninput`은 다시 그리지 **않는다**(`draft`만 갱신). 이 구분을 지킬 것.

- [ ] **Step 6: 저장 버튼이 제목과 인정답안을 정리하도록 유지**

`$('#saveQuiz').onclick` 핸들러는 그대로 둔다. 다만 `alert('저장했어요!')`를 지우고 목록으로 돌아가게만 한다 — 저장 후 목록이 보이는 것으로 충분하다.

```js
  const id = await db.saveQuiz(draft);
  draft.id = id;
  openList();
```

- [ ] **Step 7: 브라우저에서 확인**

Run: `npx serve .` → `admin.html` → 새 퀴즈쇼 만들기
Expected:
- `＋ 객관식`을 누르면 새 카드가 펼쳐진 채로 추가됨
- 카드 머리를 누르면 접히고, 다른 카드를 누르면 그 카드만 펼쳐짐
- 보기 옆 동그라미를 누르면 민트로 채워지고 그 줄이 민트 테두리가 됨
- `↑` `↓`로 순서가 바뀌고 펼침 상태가 따라감
- `⧉` 복제 시 내용이 같은 문항이 바로 아래에 생김
- 저장 후 목록에 문항 수가 맞게 나옴
- 보기 텍스트를 입력하는 동안 커서가 튀지 않음

- [ ] **Step 8: 커밋**

```bash
git add admin.html js/admin.js css/style.css
git commit -m "feat: 퀴즈 편집기 개선

- 문항 카드 접기/펼치기 (한 번에 하나)
- 순서 위/아래 이동, 복제, 삭제 도구
- 정답 지정을 라디오에서 동그라미 체크로
- 유형 추가 버튼을 점선 카드 3개로

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 이미지 저장·불러오기 계층

이미지를 브라우저에서 압축하고 Realtime Database에 넣고 빼는 계층을 만든다. 화면은 아직 건드리지 않는다.

**Files:**
- Create: `js/image.js`
- Modify: `js/firebase.js` (함수 추가)

**Interfaces:**
- Consumes: `js/firebase.js`의 `db`, `ref`, `set`, `get`, `push`
- Produces:
  - `firebase.js`: `newId() → string`, `saveQuizImage(quizId, imgId, dataUrl) → Promise<void>`,
    `loadQuizImage(quizId, imgId) → Promise<string|null>`, `deleteQuizImage(quizId, imgId) → Promise<void>`,
    `deleteQuizImages(quizId) → Promise<void>`, `getRoom(code) → Promise<object|null>`
  - `image.js`: `prepareImage(file) → Promise<{dataUrl, w, h}>` (실패 시 한국어 메시지를 담은 `Error`),
    `getImage(quizId, imgId) → Promise<string|null>` (캐시됨),
    `prefetchImage(quizId, imgId) → void`, `cacheImage(quizId, imgId, dataUrl) → void`

- [ ] **Step 1: `js/firebase.js`에 함수를 추가**

파일 끝에 붙인다. 상단 import에 이미 `push`, `set`, `get`, `ref`가 있으므로 import 수정은 필요 없다.

```js
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
```

- [ ] **Step 2: 퀴즈를 지울 때 이미지도 지우게 한다**

`deleteQuiz(id)`를 교체한다.

```js
export async function deleteQuiz(id) {
  await set(ref(db, 'quizzes/' + id), null);
  await deleteQuizImages(id);
}
```

- [ ] **Step 3: `js/image.js`를 만든다**

```js
// 문제 이미지 — 브라우저에서 줄이고 압축해 Realtime Database에 넣는다.
// Firebase Storage는 결제 계정(Blaze)을 요구해 쓰지 않는다.
import * as db from './firebase.js';

export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;   // 원본 파일 상한
export const MAX_DATA_BYTES   = 400 * 1024;          // base64 문자열 상한
const SIZES    = [1280, 1024, 800];                  // 긴 변 후보 (큰 것부터)
const QUALITIES = [0.75, 0.6, 0.5];                  // JPEG 품질 후보

// 파일 → { dataUrl, w, h }. 400KB를 못 맞추면 Error를 던진다.
export async function prepareImage(file) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('이미지 파일만 넣을 수 있어요. (jpg, png, gif, webp)');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('파일이 너무 커요. 20MB 이하 이미지를 써 주세요.');
  }
  const bitmap = await loadBitmap(file);
  for (const maxSide of SIZES) {
    const { canvas, w, h } = drawScaled(bitmap, maxSide);
    for (const q of QUALITIES) {
      const dataUrl = canvas.toDataURL('image/jpeg', q);
      if (dataUrl.length <= MAX_DATA_BYTES) {
        if (bitmap.close) bitmap.close();
        return { dataUrl, w, h };
      }
    }
  }
  if (bitmap.close) bitmap.close();
  throw new Error('이미지가 너무 복잡해요. 더 단순한 그림이나 작은 사진을 써 주세요.');
}

function loadBitmap(file) {
  if (window.createImageBitmap) return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없어요.')); };
    img.src = url;
  });
}

// 긴 변을 maxSide로 맞춰 흰 배경 위에 그린다 (투명 PNG가 검게 되지 않도록)
function drawScaled(bitmap, maxSide) {
  const sw = bitmap.width, sh = bitmap.height;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  return { canvas, w, h };
}

// ── 캐시 ──
// 같은 이미지를 두 번 받지 않는다. 방 구독(onValue)과 완전히 분리되어 있으므로
// 점수가 갱신되어도 이미지는 재전송되지 않는다.
const cache = new Map();                 // `${quizId}/${imgId}` → dataUrl
const inflight = new Map();              // 같은 이미지를 동시에 두 번 받지 않기 위해

export function cacheImage(quizId, imgId, dataUrl) {
  cache.set(`${quizId}/${imgId}`, dataUrl);
}

export async function getImage(quizId, imgId) {
  if (!quizId || !imgId) return null;
  const key = `${quizId}/${imgId}`;
  if (cache.has(key)) return cache.get(key);
  if (inflight.has(key)) return inflight.get(key);
  const p = db.loadQuizImage(quizId, imgId)
    .then(v => { cache.set(key, v); inflight.delete(key); return v; })
    .catch(e => { inflight.delete(key); throw e; });
  inflight.set(key, p);
  return p;
}

// 다음 문제 이미지를 미리 받아 둔다 — 문제가 시작되자마자 떠 있어야 20초가 공평하다
export function prefetchImage(quizId, imgId) {
  getImage(quizId, imgId).catch(() => {});
}
```

- [ ] **Step 4: 문법과 import가 성립하는지 확인**

Run: `node --input-type=module -e "import('./js/image.js').catch(e => { console.log(e.message); process.exit(0); })"`
Expected: 브라우저 전용 API(`document`)나 Firebase CDN import 때문에 오류가 나는 것은 정상이다. **문법 오류(`SyntaxError`)만 없으면 통과.**

더 확실한 확인:
Run: `node --check js/image.js && node --check js/firebase.js`
Expected: 출력 없음 (문법 정상)

- [ ] **Step 5: 브라우저 콘솔에서 압축을 확인**

Run: `npx serve .` → `admin.html`을 열고 개발자 도구 콘솔에서:

```js
const m = await import('./js/image.js');
const f = await (await fetch('https://placehold.co/3000x2000.png')).blob();
const r = await m.prepareImage(new File([f], 'x.png', { type: 'image/png' }));
console.log(r.w, r.h, Math.round(r.dataUrl.length / 1024) + 'KB');
```

Expected: 긴 변이 1280 이하이고 크기가 400KB 이하로 찍힌다.
(네트워크가 막혀 있으면 아무 로컬 이미지 파일을 `<input type=file>`로 골라 같은 함수에 넣어 확인한다.)

- [ ] **Step 6: 기존 테스트가 통과하는지 확인**

Run: `node --test`
Expected: PASS — `pass 15`

- [ ] **Step 7: 커밋**

```bash
git add js/image.js js/firebase.js
git commit -m "feat: 이미지 저장·불러오기 계층

- prepareImage: 긴 변 1280px, JPEG 0.75부터 단계적으로 낮춰 400KB 상한 맞춤
- 투명 배경은 흰색으로 채워 JPEG 변환 시 검게 되지 않게
- quizImages/<quizId>/<imgId>에 저장 — rooms/ 안에는 절대 넣지 않는다
- getImage 캐시 + prefetchImage 미리 받기
- 퀴즈 삭제 시 이미지도 함께 삭제

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 편집기 이미지 첨부

편집기 문항 카드에 이미지 영역을 넣는다. 끌어다 놓거나 눌러서 고른다.

**Files:**
- Modify: `js/admin.js` (`openEditor`, `renderQuestions`, `bindEditorEvents`)
- Modify: `css/style.css` (드롭 영역 클래스 추가)

**Interfaces:**
- Consumes: Task 6의 `prepareImage`, `cacheImage`, `getImage`, `db.saveQuizImage`, `db.deleteQuizImage`, `db.newId`
- Produces: 문제 객체의 `image` 필드 — `{ id, w, h }` 또는 없음

- [ ] **Step 1: 드롭 영역 CSS를 `css/style.css` 끝에 추가**

```css
/* ── 편집기 이미지 영역 ── */
.imgdrop{
  display:flex; align-items:center; gap:14px; padding:12px 14px;
  background:var(--bg); border:2px dashed var(--line); border-radius:var(--r-md);
  cursor:pointer; color:var(--ink2); font-weight:700;
}
.imgdrop.over{ border-color:var(--primary); color:var(--primary); background:rgba(108,76,241,.06); }
.imgdrop.filled{ border-style:solid; cursor:default; }
.imgdrop .thumb{
  flex:none; width:92px; height:58px; border-radius:var(--r-sm); overflow:hidden;
  border:1px solid var(--line); background:var(--card);
}
.imgdrop .thumb img{ width:100%; height:100%; object-fit:cover; display:block; }
.imgdrop .name{ font-weight:700; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.imgdrop .tools{ margin-left:auto; display:flex; gap:8px; }
```

- [ ] **Step 2: import를 추가**

`js/admin.js` 상단에 넣는다.

```js
import { prepareImage, getImage, cacheImage } from './image.js';
```

- [ ] **Step 3: 편집기를 열 때 퀴즈 id를 미리 확보**

`openEditor(quiz)` 안 `draft = JSON.parse(...)` 다음에 넣는다. 이미지를 넣을 경로가 저장 전에도 있어야 한다.

```js
  if (!draft.id) draft.id = db.newId();
```

- [ ] **Step 4: 문항 카드에 이미지 영역을 그린다**

`renderQuestions()`의 펼친 카드 블록에서 문제 내용 입력 **바로 다음**에 넣는다 (x2 체크박스 앞).

```js
      html += imgDropMarkup(q, i);
```

그리고 함수를 추가한다.

```js
function imgDropMarkup(q, i) {
  if (q.image) {
    return `<div class="imgdrop filled" data-imgslot="${i}">
      <div class="thumb" id="thumb${i}"></div>
      <span class="name">이미지 첨부됨 · ${q.image.w}×${q.image.h}</span>
      <span class="tools">
        <button class="btn btn-ghost" data-imgpick="${i}">바꾸기</button>
        <button class="btn btn-ghost" data-imgdel="${i}">🗑</button>
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
```

- [ ] **Step 5: 썸네일을 채운다**

`renderQuestions()` 끝의 `bindEditorEvents(box);` **다음 줄**에 넣는다.

```js
  fillThumbs();
```

```js
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
```

- [ ] **Step 6: 끌어다 놓기와 파일 고르기를 붙인다**

`bindEditorEvents(box)` 끝에 추가한다.

```js
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
```

- [ ] **Step 7: 첨부 처리 함수를 쓴다**

```js
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
```

- [ ] **Step 8: 문항을 지울 때 이미지도 지운다**

`bindEditorEvents`의 `[data-del]` 핸들러에서 `splice` **앞**에 추가한다.

```js
    const gone = draft.questions[i].image;
    if (gone) db.deleteQuizImage(draft.id, gone.id).catch(() => {});
```

- [ ] **Step 9: 브라우저에서 확인**

Run: `npx serve .` → `admin.html` → 퀴즈 편집 → 객관식 문항 추가
Expected:
- 이미지 영역에 파일을 끌어다 놓으면 "이미지를 줄이는 중…" → "저장하는 중…" → 썸네일과 `1280×720` 같은 크기 표시
- `바꾸기`로 다른 이미지를 넣으면 교체됨
- `🗑`로 지우면 점선 영역으로 돌아감
- 이미지가 아닌 파일(예: `.txt`)을 놓으면 "이미지 파일만 넣을 수 있어요"
- 저장 후 목록 → 다시 편집하면 썸네일이 그대로 보임
- Firebase 콘솔의 Realtime Database에서 `quizImages/<quizId>/<imgId>`에 문자열이 들어간 것을 확인

- [ ] **Step 10: 커밋**

```bash
git add js/admin.js css/style.css
git commit -m "feat: 편집기 이미지 첨부 (끌어다 놓기)

- 문항 카드에 이미지 영역 — 드롭 또는 클릭으로 파일 선택
- 편집기를 열 때 퀴즈 id를 미리 발급해 저장 전에도 이미지를 넣을 수 있게
- 이미지 교체·삭제 시 이전 이미지를 DB에서 제거
- 실패 시 카드 안에 이유와 다시 시도 버튼

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: 문제 화면에 이미지 표시

이미지가 있는 문제를 교육생 폰과 강사 스크린에 그린다. 다음 문제 이미지는 미리 받아 둔다.

**Files:**
- Modify: `js/player.js` (`renderQuestion`, `render`)
- Modify: `js/admin.js` (`renderQuestionScreen`, `renderHost`)

**Interfaces:**
- Consumes: Task 6의 `getImage`, `prefetchImage`
- Produces: `qimgMarkup(q, slotId)` — 두 파일에 각각 둔다 (공유 모듈로 빼지 않는다. 두 화면의 레이아웃이 다르다)

- [ ] **Step 1: `js/player.js`에 import와 이미지 헬퍼를 추가**

```js
import { getImage, prefetchImage } from './image.js';
```

```js
// 이미지는 자리만 먼저 잡고 비동기로 채운다 — w/h를 알고 있으므로 화면이 덜컥거리지 않는다
function qimgMarkup(q) {
  if (!q.image) return '';
  return `<div class="qimg loading" id="qimg" style="aspect-ratio:${q.image.w}/${q.image.h}"></div>`;
}

async function fillQimg(q) {
  if (!q.image) return;
  const box = document.getElementById('qimg');
  if (!box) return;
  const url = await getImage(room.quizId, q.image.id).catch(() => null);
  if (!url) { box.remove(); return; }              // 못 받으면 자리를 접는다 — 문제 풀이는 막지 않는다
  if (document.getElementById('qimg') !== box) return;
  box.classList.remove('loading');
  box.innerHTML = `<img src="${url}" alt="문제 이미지">`;
}
```

- [ ] **Step 2: 문제 화면에 이미지를 끼운다**

`renderQuestion(s)`에서 문제 제목 다음, 보기 앞에 넣는다.

```js
  s.innerHTML = `<div class="panel stack" style="flex:1">
    ${head}
    <h2>${escT(q.text)}</h2>
    ${qimgMarkup(q)}
    ${controls}
  </div>`;
  fillQimg(q);
```

`answered` 분기의 `s.innerHTML` 뒤에도 `fillQimg(q);`는 필요 없다 — 제출 완료 화면에는 이미지를 넣지 않는다.

- [ ] **Step 3: 이미지가 있으면 보기를 컴팩트하게**

`renderQuestion`의 `controls` 생성부에서 `mc`와 `ox`에 클래스를 더한다.

```js
  const tight = q.image ? ' tight' : '';
  if (q.type === 'mc') {
    controls = `<div class="opts${tight}" style="flex:1">...`;
```

`css/style.css` 끝에 규칙을 추가한다.

```css
/* 이미지가 있는 문제는 보기를 한 단계 컴팩트하게 */
.opts.tight .choice{ min-height:52px; padding:8px 12px; gap:10px; font-size:.95rem; }
.opts.tight .choice .shape{ width:26px; height:26px; border-radius:8px; font-size:.75rem; }
```

- [ ] **Step 4: 다음 문제 이미지를 미리 받는다**

`js/player.js`의 `render()` 끝(분기 밖, 함수 마지막 줄)에 추가한다.

```js
  prefetchNext();
```

```js
// 대기·정답공개 중에 다음 문제 이미지를 미리 받아 둔다
function prefetchNext() {
  if (!room || !room.questions) return;
  const next = room.state === 'waiting' ? 0 : (room.currentQ ?? -1) + 1;
  const q = room.questions[next];
  if (q && q.image) prefetchImage(room.quizId, q.image.id);
}
```

- [ ] **Step 5: `room.quizId`가 참가자에게 내려오는지 확인**

`js/firebase.js`의 `createRoom`은 이미 `quizId: quiz.id`를 저장한다. 별도 수정이 필요 없다.
확인: `grep -n "quizId" js/firebase.js` → `createRoom` 안에 있어야 한다.

- [ ] **Step 6: `js/admin.js`에 같은 헬퍼를 추가 (레이아웃만 다름)**

```js
import { getImage, prefetchImage } from './image.js';
```

```js
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
```

- [ ] **Step 7: 강사 문제 화면을 이미지 유무에 따라 나눈다**

`renderQuestionScreen()`의 본문 부분(제목 + 보기)을 교체한다. 머리(`<div class="row">…`)와 꼬리(정답 공개 버튼)는 그대로.

```js
  const body = q.image
    ? `<div class="row" style="gap:36px;flex:1;flex-wrap:nowrap;align-items:center">
         <div style="flex:1.05;min-width:0">${hostImgMarkup(q)}</div>
         <div class="stack" style="flex:1;min-width:0">
           <h2 style="font-size:2rem">${escT(q.text)}</h2>
           ${renderChoicesPreview(q, true)}
         </div>
       </div>`
    : `<h2 style="font-size:2.6rem">${escT(q.text)}</h2>
       ${renderChoicesPreview(q, false)}`;
```

`host.innerHTML` 안에서 기존 `<h2>…</h2> ${renderChoicesPreview(q)}` 두 줄을 `${body}`로 바꾸고, 그 아래에 `fillHostImg(q);`를 `runTimer();` 앞에 추가한다.

- [ ] **Step 8: `renderChoicesPreview`가 세로 배치도 지원하게 한다**

```js
function renderChoicesPreview(q, stacked) {
  if (q.type === 'mc') {
    const cols = stacked ? '1fr' : '1fr 1fr';
    return `<div class="opts" style="grid-template-columns:${cols};flex:1">${q.choices.map((c, j) =>
      `<div class="choice c${j + 1}"><span class="shape">${SHAPES[j]}</span><span>${escT(c)}</span></div>`
    ).join('')}</div>`;
  }
  if (q.type === 'ox') {
    return `<div class="ox" style="flex:1"><div class="ox-btn o">O</div><div class="ox-btn x">X</div></div>`;
  }
  return `<div class="panel center muted" style="flex:1;justify-content:center">단답형 — 참가자가 폰에서 직접 입력합니다</div>`;
}
```

- [ ] **Step 9: 강사 화면도 다음 문제 이미지를 미리 받는다**

`renderHost()` 끝(분기 밖)에 추가한다.

```js
  if (room && room.questions) {
    const next = room.state === 'waiting' ? 0 : (room.currentQ ?? -1) + 1;
    const nq = room.questions[next];
    if (nq && nq.image) prefetchImage(room.quizId, nq.image.id);
  }
```

- [ ] **Step 10: 브라우저에서 확인**

Run: `npx serve .` → 이미지가 들어간 문제를 포함한 퀴즈를 만들어 진행한다. 폰(또는 390px 반응형)과 관리자 창(1280px)을 나란히 본다.
Expected:
- 강사 화면: 이미지가 왼쪽 절반, 문제와 보기가 오른쪽에 세로로
- 폰: 문제 → 이미지 → 보기 순, 보기 버튼이 컴팩트해지고 전부 화면에 들어감
- 문제가 바뀌는 순간 이미지가 이미 떠 있다 (미리 받기 동작)
- Realtime Database에서 `quizImages`를 지운 뒤 새로고침하면 이미지 자리가 접히고 문제는 정상 동작

- [ ] **Step 11: 커밋**

```bash
git add js/player.js js/admin.js css/style.css
git commit -m "feat: 문제 화면 이미지 표시

- 폰: 문제 아래 이미지, 보기는 .opts.tight로 컴팩트하게
- 대형 스크린: 이미지가 있으면 좌우 2단 배치
- w/h로 자리를 미리 잡아 이미지 도착 시 화면이 덜컥거리지 않음
- 다음 문제 이미지를 대기·정답공개 중에 미리 받아 타이머 공평성 확보
- 이미지를 못 받으면 자리를 접고 문제 풀이는 계속

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: 문제별 순위 표시

Task 1에서 만든 `rankQuestion`을 화면에 붙인다.

**Files:**
- Modify: `js/admin.js` (`renderReveal`)
- Modify: `js/player.js` (`renderResult`)

**Interfaces:**
- Consumes: Task 1의 `rankQuestion(question, answersForQ, players, startedAt)`

- [ ] **Step 1: `js/admin.js`의 import에 `rankQuestion`을 추가**

```js
import { checkAnswer, calcScore, rankPlayers, rankQuestion, ROUND_MS } from './logic.js';
```

- [ ] **Step 2: 정답 공개 화면을 좌우 2단으로 바꾼다**

`renderReveal()`의 `누적 순위` 부분(`<h3 class="muted">누적 순위</h3>`부터 그 아래 `.stack` 블록까지)을 교체한다.

```js
  const qRanked = rankQuestion(q, (room.answers || {})[room.currentQ], room.players, room.startedAt);
```

```js
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
```

- [ ] **Step 3: `js/player.js`의 import에 `rankQuestion`을 추가**

```js
import { ROUND_MS, rankPlayers, checkAnswer, rankQuestion } from './logic.js';
```

- [ ] **Step 4: 교육생 정답 공개 화면에 이번 문제 등수를 넣는다**

`renderResult(s)`에서 `correct` 계산 다음에 추가하고, `<span class="pill">` 앞에 한 줄을 끼운다.

```js
  const qRanked = rankQuestion(q, (room.answers || {})[idx], room.players, room.startedAt);
  const qRank = qRanked.findIndex(r => r.id === playerId) + 1;
  const gained = (qRanked.find(r => r.id === playerId) || {}).gained || 0;
```

```js
  s.innerHTML = `<div class="feedback ${correct ? 'ok' : 'no'}">
    <div class="mark">${correct ? '✓' : '✗'}</div>
    <div style="font-size:1.8rem;font-weight:900">${correct ? '정답!' : '아쉬워요'}</div>
    ${correct ? `<div class="big">+${gained}</div>` : `<div style="font-weight:700">정답은 <b>${escT(answerText)}</b></div>`}
    ${qRank ? `<span class="pill" style="font-weight:900">⚡ 이번 문제 ${qRank}번째로 맞힘</span>` : ''}
    <span class="pill">누적 ${myRank}위 · ${me.score || 0}점</span>
    <div class="muted" style="color:rgba(255,255,255,.85)">다음 문제를 기다려 주세요</div>
  </div>`;
```

- [ ] **Step 5: 브라우저에서 확인**

Run: `npx serve .` → 탭 3개(관리자 + 참가자 2명)로 한 문제를 푼다. 두 참가자가 **시간 차를 두고** 답한다.
Expected:
- 강사 화면 왼쪽에 빨리 맞힌 순서와 `2.4초` 같은 걸린 시간, 1등 줄이 보라 테두리
- 오답자는 왼쪽 목록에 없음
- 아무도 못 맞히면 "이번 문제는 맞힌 사람이 없어요"
- 참가자 폰에 `⚡ 이번 문제 1번째로 맞힘`과 `+240` 같은 획득 점수
- 오답 참가자에게는 이번 문제 등수 배지가 없고 정답만 보임

- [ ] **Step 6: 테스트 확인**

Run: `node --test`
Expected: PASS — `pass 15`

- [ ] **Step 7: 커밋**

```bash
git add js/admin.js js/player.js
git commit -m "feat: 문제별 순위 표시

- 강사 정답 공개 화면을 '이번 문제 빨리 맞힌 순' / '누적 순위' 2단으로
- 교육생 폰에 이번 문제 등수와 획득 점수 표시
- 기준은 rankQuestion — 정답 + 제한시간 내, 빨리 맞힌 순

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: 최종 결과 세 화면으로 분리

프로젝터에는 1·2·3등만, 전체 순위는 강사 전용 새 창, 개인은 각자 폰. 관리자 암호를 두 파일이 공유하므로 상수를 별도 모듈로 뺀다.

**Files:**
- Create: `js/config.js`
- Create: `results.html`
- Create: `js/results.js`
- Modify: `js/admin.js` (`ADMIN_PASSWORD` 제거, `renderEnded` 교체)
- Modify: `js/player.js` (`renderFinal`에 맞힌 개수 추가)

**Interfaces:**
- Consumes: Task 1의 `summarize`, `rankPlayers`; Task 6의 `db.getRoom`
- Produces: `js/config.js`의 `ADMIN_PASSWORD`

- [ ] **Step 1: `js/config.js`를 만든다**

```js
// 관리자 암호 — admin.html과 results.html이 함께 쓴다.
// 워크숍마다 바꾸려면 이 값만 고치면 된다.
export const ADMIN_PASSWORD = 'quiz2026';
```

- [ ] **Step 2: `js/admin.js`가 이 상수를 쓰게 한다**

`const ADMIN_PASSWORD = 'quiz2026';` 줄을 지우고 import를 추가한다.

```js
import { ADMIN_PASSWORD } from './config.js';
```

- [ ] **Step 3: 시상대 화면을 1·2·3등만으로 바꾼다**

`renderEnded()`를 교체한다.

```js
function renderEnded() {
  const host = document.getElementById('host');
  stopMusic();
  if (!victoryDone) { victoryDone = true; playVictory(); }   // 승리 팡파레 1회
  const ranked = rankPlayers(room.players);
  const [p1, p2, p3] = ranked;
  const col = (p, cls, medal) => `<div class="col ${cls}">
    <div style="font-size:2.2rem">${medal}</div>
    <div class="who">${p ? escT(p.nick) : '-'}</div>
    <div class="pts">${p ? p.score + '점' : ''}</div>
    <div class="bar">${cls === 'p1' ? 1 : cls === 'p2' ? 2 : 3}</div>
  </div>`;

  host.innerHTML = `<div class="panel" style="flex:1;background:linear-gradient(170deg,#6C4CF1,#5335D4 62%,#4527BC);
                                              color:#fff;border:none">
    <div class="center">
      <div style="font-weight:700;letter-spacing:.2em;opacity:.7">FINAL RESULT</div>
      <h1 style="font-size:3rem">🏆 최종 결과</h1>
    </div>
    <div class="podium" style="flex:1;padding:0 40px">
      ${col(p2, 'p2', '🥈')}${col(p1, 'p1', '👑')}${col(p3, 'p3', '🥉')}
    </div>
    <div class="row" style="justify-content:space-between">
      <button class="btn btn-ghost" id="homeBtn">목록으로</button>
      <button class="btn" id="fullBtn">전체 순위 보기 (강사용)</button>
    </div>
  </div>`;
  document.getElementById('homeBtn').onclick = () => { if (unsub) unsub(); openList(); };
  document.getElementById('fullBtn').onclick = () => {
    window.open('results.html?room=' + roomCode, 'quizResults', 'width=900,height=800');
  };
}
```

> 4위 이하는 이 화면에 **나오지 않는다.** 이게 이 Task의 핵심이다.

- [ ] **Step 4: `results.html`을 만든다**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>퀴즈 배틀 · 전체 순위</title>
<link rel="stylesheet" as="style" crossorigin
      href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css">
<link rel="stylesheet" href="css/style.css">
</head>
<body>
<div class="wrap">

  <!-- 암호 게이트 -->
  <section id="gate" class="panel">
    <h1>전체 순위</h1>
    <p class="muted" style="margin:0">강사용 화면입니다. 관리자 암호를 입력하세요.</p>
    <input id="pw" type="password" placeholder="암호">
    <input id="roomIn" placeholder="방 코드 6자리" maxlength="6">
    <button class="btn" id="pwBtn">결과 보기</button>
    <p id="gateErr" class="hidden err"></p>
  </section>

  <section id="board" class="hidden stack" style="flex:1"></section>
</div>
<script type="module" src="js/results.js"></script>
</body>
</html>
```

- [ ] **Step 5: `js/results.js`를 만든다**

```js
import * as db from './firebase.js';
import { rankPlayers, summarize, checkAnswer } from './logic.js';
import { ADMIN_PASSWORD } from './config.js';

const $ = s => document.querySelector(s);
const preRoom = (new URLSearchParams(location.search).get('room') || '').trim().toUpperCase();
if (preRoom) $('#roomIn').value = preRoom;
$('#pw').focus();

$('#pwBtn').onclick = open;
$('#pw').addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
$('#roomIn').addEventListener('keydown', e => { if (e.key === 'Enter') open(); });

async function open() {
  const err = $('#gateErr');
  err.classList.add('hidden');
  if ($('#pw').value !== ADMIN_PASSWORD) {
    err.textContent = '암호가 틀렸어요.';
    err.classList.remove('hidden');
    return;
  }
  const code = $('#roomIn').value.trim().toUpperCase();
  const room = await db.getRoom(code);
  if (!room) {
    err.textContent = '결과를 찾을 수 없어요. 방 코드를 다시 확인해 주세요.';
    err.classList.remove('hidden');
    return;
  }
  $('#gate').classList.add('hidden');
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
      ${ranked.map((r, i) => `<div class="lrow">
        <span class="n">${i + 1}</span>
        <span class="who">${escT(r.nick)}</span>
        <span class="pill">${(stats[r.id] || {}).correct || 0} / ${total} 정답</span>
        <span class="s">${r.score}</span>
      </div>`).join('')}
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
```

- [ ] **Step 6: 개인 최종 화면에 맞힌 개수를 붙인다**

`js/player.js`의 import에 `summarize`를 추가한다.

```js
import { ROUND_MS, rankPlayers, checkAnswer, rankQuestion, summarize } from './logic.js';
```

`renderFinal(s)`에서 `medal` 계산 다음에 추가하고, 배지 줄을 바꾼다.

```js
  const stats = summarize(room.questions || [], room.answers || {}, room.players || {}, 0);
  const mine = stats[playerId] || { correct: 0 };
```

```js
      <div class="row" style="justify-content:center;margin-top:12px">
        <span class="pill">${me.score || 0}점</span>
        <span class="pill">${mine.correct} / ${room.questions.length} 정답</span>
      </div>
```

- [ ] **Step 7: 브라우저에서 확인**

Run: `npx serve .` → 짧은 퀴즈(2문항)를 끝까지 진행한다.
Expected:
- 강사 화면 최종: 보라 배경 시상대에 1·2·3등만. **4위 참가자 이름이 화면 어디에도 없다**
- `전체 순위 보기` 버튼을 누르면 새 창이 뜨고 암호를 묻는다. 방 코드는 미리 채워져 있다
- 암호 입력 후 4위 이하를 포함한 전체 순위와 `2 / 2 정답` 표시
- 틀린 암호 → "암호가 틀렸어요", 없는 방 코드 → "결과를 찾을 수 없어요"
- `⬇ CSV 저장` → 파일이 받아지고 엑셀에서 한글이 깨지지 않으며 Q1/Q2 열에 O·X가 들어 있다
- 참가자 폰 최종 화면에 등수 + 점수 + `2 / 2 정답`

- [ ] **Step 8: 테스트 확인**

Run: `node --test`
Expected: PASS — `pass 15`

- [ ] **Step 9: 커밋**

```bash
git add js/config.js results.html js/results.js js/admin.js js/player.js
git commit -m "feat: 최종 결과를 세 화면으로 분리

- 프로젝터(admin.html): 1·2·3등 시상대만. 4위 이하는 나오지 않는다
- 강사(results.html): 전체 순위 + 맞힌 개수 + CSV 내보내기, 새 창으로 열림
- 개인(index.html): 내 등수 / 인원 / 점수 / 맞힌 개수
- ADMIN_PASSWORD를 js/config.js로 분리해 두 화면이 공유

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: 문서 갱신과 실기기 확인

README를 새 구조에 맞추고, 실제 Firebase와 실제 폰으로 전 과정을 한 번 돌린다.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README의 2절(관리자 암호)을 고친다**

암호 위치가 바뀌었다.

```markdown
## 2. 관리자 암호
`js/config.js`의 `ADMIN_PASSWORD` 상수를 원하는 값으로 변경.
`admin.html`(진행)과 `results.html`(전체 순위)이 함께 씁니다.
```

- [ ] **Step 2: 5절(배포)에 `results.html`을 추가한다**

```markdown
3. 발급된 URL의 `/index.html`(참가자), `/admin.html`(관리자·대형 스크린),
   `/results.html`(강사용 전체 순위) 사용
```

- [ ] **Step 3: 이미지에 관한 절을 새로 넣는다**

6절 앞에 넣는다.

```markdown
## 6. 문제 이미지
편집기의 문항 카드에 이미지를 끌어다 놓으면 브라우저에서 줄여(긴 변 1280px, JPEG)
Realtime Database의 `quizImages/` 경로에 저장합니다. Firebase Storage는
결제 계정(Blaze)을 요구하므로 쓰지 않습니다.

- 한 장당 400KB를 넘지 않게 자동으로 압축합니다. 못 맞추면 더 단순한 이미지를 요청합니다.
- 이미지는 **방(`rooms/`) 안에 넣지 않습니다.** 방은 참가자 전원이 실시간 구독 중이라
  점수가 바뀔 때마다 이미지까지 다시 내려가게 됩니다. 이 구조를 바꾸지 마세요.
- 무료 요금제 한도는 저장 1GB / 월 전송 10GB입니다. 워크숍 1회(24명 × 10문항)가
  약 50MB이니 여유가 있지만, 자주 쓰신다면 Firebase 콘솔 >
  Realtime Database > 사용량에서 한 번씩 확인하세요.
```

기존 6절(보안 규칙 강화)의 번호를 7절로 바꾼다.

- [ ] **Step 4: 최종 결과 화면 구성을 README에 적는다**

3절(로컬 실행) 뒤에 넣는다.

```markdown
## 4. 결과 화면 구성
| 보는 사람 | 화면 | 내용 |
|---|---|---|
| 모두 (프로젝터) | `admin.html` 최종 | 1·2·3등 시상대만 |
| 강사 | `results.html` (새 창) | 전체 순위 + 맞힌 개수 + CSV |
| 교육생 각자 | `index.html` 최종 | 내 등수 / 점수 / 맞힌 개수 |

강사 노트북과 프로젝터를 **확장 디스플레이**로 쓰세요. 미러링 상태면
전체 순위 창도 프로젝터에 그대로 보입니다.
```

이후 절 번호를 하나씩 밀어 5. 테스트 / 6. 배포 / 7. 문제 이미지 / 8. 보안 규칙으로 정리한다.

- [ ] **Step 5: 전체 테스트를 돌린다**

Run: `node --test`
Expected: PASS — `tests 15`, `pass 15`, `fail 0`

- [ ] **Step 6: 실기기 E2E 체크리스트를 처음부터 끝까지 수행**

Run: `npx serve .` — 같은 와이파이의 **실제 스마트폰**에서 PC의 로컬 IP로 접속한다.

체크리스트 (하나라도 실패하면 고치고 다시):
- [ ] 관리자 암호로 입장 → 새 퀴즈쇼 만들기
- [ ] 객관식 1문항(이미지 있음, x2), O/X 1문항, 단답형 1문항을 만들고 저장
- [ ] 목록에서 `▶ 진행` → 방이 열리고 QR이 보임
- [ ] 폰으로 QR 촬영 → 코드가 자동으로 채워지고 닉네임만 입력해 입장
- [ ] 두 번째 폰(또는 다른 브라우저)으로 한 명 더 입장 → 대기실 인원이 2명
- [ ] `시작하기` → 배경음악 재생, 이미지 문제가 좌우 2단으로 표시
- [ ] 두 폰이 시간 차를 두고 답 제출 → 강사 화면 제출 카운터가 올라감
- [ ] 정답 공개 → 왼쪽에 빨리 맞힌 순(초 단위), 오른쪽에 누적 순위
- [ ] 폰에 `⚡ 이번 문제 N번째로 맞힘`과 획득 점수
- [ ] x2 문제 점수가 2배로 붙음
- [ ] 마지막 문제 후 `최종 결과 발표` → 시상대에 1·2·3등만, 팡파레 재생
- [ ] `전체 순위 보기` → 새 창, 암호 입력 후 전체 순위와 맞힌 개수
- [ ] CSV 저장 → 엑셀에서 한글 정상, Q별 O·X 정확
- [ ] 폰 최종 화면에 내 등수와 맞힌 개수
- [ ] 폰에서 가로 스크롤이 생기는 화면이 하나도 없음

- [ ] **Step 7: 커밋**

```bash
git add README.md
git commit -m "docs: README를 새 구조에 맞게 갱신

- 관리자 암호 위치를 js/config.js로
- 결과 화면 3분리 설명과 확장 디스플레이 안내
- 문제 이미지 절 추가 (DB 저장 이유, 한도, rooms/에 넣지 말 것)
- results.html 배포 안내

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: master로 병합하고 배포**

```bash
git checkout master
git merge --no-ff feat/redesign-2026-09
git push origin master
```

GitHub Pages가 갱신되면 https://nanjungj.github.io/quiz-battle/ 에서 실제로 한 번 더 확인한다.

---

## 자기 점검 결과

**스펙 항목 대비 계획 커버리지**

| 스펙 | 구현 Task |
|---|---|
| 3. 디자인 시스템 (색·폰트·레이아웃) | Task 2 |
| 4. 데이터 모델 (`image` 필드) | Task 6, 7 |
| 5. 이미지 넣기 (압축·저장·캐시·미리받기·삭제) | Task 6, 7, 8 |
| 6. 문제별 순위 (`rankQuestion`, 표시) | Task 1, 9 |
| 7. 최종 결과 3분리 + CSV | Task 10 |
| 8. 편집기 개선 | Task 5, 7 |
| 9. 파일 구조 | Task 1~10 전체 |
| 10. 오류 처리 | Task 6(검증), 7(첨부 실패), 8(로드 실패), 10(방 없음) |
| 11. 테스트 | Task 1(단위), 각 Task의 브라우저 확인, Task 11(실기기 E2E) |
| 12. 리스크 (rooms/에 이미지 금지) | Task 6 주석, Task 11 README |

**이름 일관성 확인 완료**
`rankQuestion`/`summarize`(Task 1 정의 → 9·10에서 사용), `answeredCount`(Task 4 정의 → 4에서 사용),
`prepareImage`/`getImage`/`prefetchImage`/`cacheImage`(Task 6 정의 → 7·8에서 사용),
`newId`/`saveQuizImage`/`deleteQuizImage`/`deleteQuizImages`/`getRoom`(Task 6 정의 → 7·10에서 사용),
`ADMIN_PASSWORD`(Task 10 정의 → admin.js·results.js에서 사용),
`SHAPES`(Task 3·4에서 각 파일에 독립적으로 정의 — 의도된 중복),
`openIdx`(Task 5 정의 → 5·7에서 사용).
