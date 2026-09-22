import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRows } from '../js/excel.js';

const HEADER = ['유형', '문제', '보기1', '보기2', '보기3', '보기4', '정답', 'x2'];

test('parseRows: 세 유형을 모두 변환한다', () => {
  const { questions, errors } = parseRows([
    HEADER,
    ['객관식', '수도는?', '서울', '부산', '대구', '인천', 2, ''],
    ['OX', '지구는 둥글다', '', '', '', '', 'O', ''],
    ['단답형', '장군 이름은?', '', '', '', '', '이순신, 이순신 장군', ''],
  ]);
  assert.deepEqual(errors, []);
  assert.equal(questions.length, 3);
  assert.deepEqual(questions[0], {
    type: 'mc', text: '수도는?', choices: ['서울', '부산', '대구', '인천'], answer: 1, double: false,
  });
  assert.deepEqual(questions[1], { type: 'ox', text: '지구는 둥글다', answer: 'O', double: false });
  assert.deepEqual(questions[2], {
    type: 'short', text: '장군 이름은?',
    answer: '이순신', accepted: ['이순신', '이순신 장군'], double: false,
  });
});

test('parseRows: 정답 번호는 1부터 세고 0부터 저장한다', () => {
  const { questions, errors } = parseRows([
    HEADER,
    ['객관식', 'Q', 'a', 'b', 'c', 'd', 1, ''],
    ['객관식', 'Q', 'a', 'b', 'c', 'd', 4, ''],
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(questions.map(q => q.answer), [0, 3]);
});

test('parseRows: 보기를 2~3개만 채워도 된다', () => {
  const { questions, errors } = parseRows([
    HEADER,
    ['객관식', 'Q', '예', '아니오', '', '', 2, ''],
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(questions[0].choices, ['예', '아니오']);
  assert.equal(questions[0].answer, 1);
});

test('parseRows: x2 열은 O/예/Y를 모두 받는다', () => {
  const { questions } = parseRows([
    HEADER,
    ['OX', 'Q1', '', '', '', '', 'O', 'O'],
    ['OX', 'Q2', '', '', '', '', 'O', '예'],
    ['OX', 'Q3', '', '', '', '', 'O', 'Y'],
    ['OX', 'Q4', '', '', '', '', 'O', ''],
  ]);
  assert.deepEqual(questions.map(q => q.double), [true, true, true, false]);
});

test('parseRows: 머리글이 없어도 첫 줄부터 읽는다', () => {
  const { questions, errors } = parseRows([
    ['OX', '지구는 둥글다', '', '', '', '', 'O', ''],
  ]);
  assert.deepEqual(errors, []);
  assert.equal(questions.length, 1);
});

test('parseRows: 빈 줄은 건너뛴다', () => {
  const { questions, errors } = parseRows([
    HEADER,
    ['OX', 'Q1', '', '', '', '', 'O', ''],
    ['', '', '', '', '', '', '', ''],
    [],
    ['OX', 'Q2', '', '', '', '', 'X', ''],
  ]);
  assert.deepEqual(errors, []);
  assert.equal(questions.length, 2);
});

test('parseRows: 유형이 틀리면 엑셀 행 번호와 함께 알려준다', () => {
  const { errors } = parseRows([
    HEADER,
    ['사지선다', 'Q', 'a', 'b', 'c', 'd', 1, ''],
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^2행/);                 // 머리글이 1행이므로 데이터는 2행부터
  assert.match(errors[0], /객관식/);
  assert.match(errors[0], /사지선다/);
});

test('parseRows: 문제 내용이 비면 오류', () => {
  const { errors } = parseRows([HEADER, ['OX', '', '', '', '', '', 'O', '']]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^2행/);
  assert.match(errors[0], /문제 내용/);
});

test('parseRows: 객관식 정답이 번호가 아니거나 범위를 벗어나면 오류', () => {
  const { errors } = parseRows([
    HEADER,
    ['객관식', 'Q', 'a', 'b', 'c', 'd', '서울', ''],   // 2행 — 번호가 아님
    ['객관식', 'Q', 'a', 'b', 'c', 'd', 5, ''],        // 3행 — 보기 4개인데 5
    ['객관식', 'Q', 'a', 'b', '', '', 3, ''],          // 4행 — 보기 2개인데 3
  ]);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /^2행/);
  assert.match(errors[1], /^3행/);
  assert.match(errors[2], /^4행/);
});

test('parseRows: 객관식 보기가 2개 미만이면 오류', () => {
  const { errors } = parseRows([HEADER, ['객관식', 'Q', '하나만', '', '', '', 1, '']]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /보기/);
});

test('parseRows: OX 정답은 O 또는 X만', () => {
  const { errors } = parseRows([HEADER, ['OX', 'Q', '', '', '', '', '참', '']]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /O/);
});

test('parseRows: 단답형 정답이 비면 오류', () => {
  const { errors } = parseRows([HEADER, ['단답형', 'Q', '', '', '', '', '   ', '']]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /정답/);
});

test('parseRows: 오류가 있는 줄은 questions에 넣지 않는다', () => {
  const { questions, errors } = parseRows([
    HEADER,
    ['OX', '멀쩡한 문제', '', '', '', '', 'O', ''],
    ['사지선다', '망가진 문제', '', '', '', '', 'O', ''],
  ]);
  assert.equal(errors.length, 1);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].text, '멀쩡한 문제');
});

test('parseRows: 빈 파일은 안내 문구를 돌려준다', () => {
  assert.equal(parseRows([]).errors.length, 1);
  assert.equal(parseRows([HEADER]).errors.length, 1);
  assert.match(parseRows([HEADER]).errors[0], /문제/);
});

test('parseRows: 유형과 정답의 공백·대소문자를 봐준다', () => {
  const { questions, errors } = parseRows([
    HEADER,
    [' ox ', 'Q1', '', '', '', '', ' o ', ''],
    ['O/X', 'Q2', '', '', '', '', 'x', ''],
    [' 객관식 ', 'Q3', ' 가 ', ' 나 ', '', '', ' 2 ', ''],
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(questions.map(q => q.type), ['ox', 'ox', 'mc']);
  assert.deepEqual(questions.map(q => q.answer), ['O', 'X', 1]);
  assert.deepEqual(questions[2].choices, ['가', '나']);
});
