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
