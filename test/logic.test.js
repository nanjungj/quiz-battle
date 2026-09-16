import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUND_MS, generateRoomCode, normalize, checkAnswer, calcScore, rankPlayers,
  rankQuestion, summarize
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
