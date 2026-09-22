// 엑셀 표 → 문제 목록.
//
// 순수 함수라 브라우저도 Firebase도 모른다 (test/excel.test.js 에서 검증).
// 엑셀 파일을 읽어 표로 바꾸는 일은 js/admin.js 가 SheetJS로 하고,
// 여기서는 "표가 들어오면 문제로 어떻게 바꾸는가"만 정한다.

const TYPES = {
  '객관식': 'mc',
  'ox': 'ox', 'o/x': 'ox', 'o․x': 'ox', 'ox형': 'ox',
  '단답형': 'short', '단답': 'short',
};
const YES = ['o', '예', 'y', 'yes', 'true', '1', 'v', '✓'];

const cell = v => (v === undefined || v === null) ? '' : String(v).trim();
const squash = s => s.replace(/\s+/g, '').toLowerCase();

// rows: 엑셀 시트를 그대로 옮긴 2차원 배열 (첫 줄이 머리글이면 건너뛴다)
// → { questions, errors } — errors 는 "3행: ..." 형태의 사람이 읽는 문장
export function parseRows(rows) {
  const questions = [];
  const errors = [];
  const all = rows || [];

  // 머리글이 있으면 건너뛴다. 없어도 동작한다.
  const first = cell((all[0] || [])[0]);
  const start = squash(first) === '유형' ? 1 : 0;

  for (let i = start; i < all.length; i++) {
    const row = all[i] || [];
    const at = i + 1;                                  // 엑셀 화면의 행 번호
    const cells = [0, 1, 2, 3, 4, 5, 6, 7].map(j => cell(row[j]));
    if (cells.every(c => c === '')) continue;          // 빈 줄은 건너뛴다

    const q = parseOne(cells, at, errors);
    if (q) questions.push(q);
  }

  if (!questions.length && !errors.length) {
    errors.push('문제가 한 줄도 없어요. "문제" 탭에 한 줄에 하나씩 적어 주세요.');
  }
  return { questions, errors };
}

function parseOne([rawType, text, c1, c2, c3, c4, rawAnswer, rawDouble], at, errors) {
  const type = TYPES[squash(rawType)];
  if (!type) {
    errors.push(`${at}행: 유형은 객관식 / OX / 단답형 중 하나여야 해요 ("${rawType}")`);
    return null;
  }
  if (!text) {
    errors.push(`${at}행: 문제 내용이 비어 있어요`);
    return null;
  }
  const double = YES.includes(squash(rawDouble));

  if (type === 'mc') {
    // 뒤쪽 빈 칸은 버린다 — 보기를 2개나 3개만 써도 된다
    const choices = [c1, c2, c3, c4];
    while (choices.length && choices[choices.length - 1] === '') choices.pop();
    if (choices.length < 2 || choices.some(c => c === '')) {
      errors.push(`${at}행: 객관식은 보기를 2개 이상, 앞에서부터 빈칸 없이 채워 주세요`);
      return null;
    }
    const n = Number(rawAnswer);
    if (!Number.isInteger(n) || n < 1 || n > choices.length) {
      errors.push(`${at}행: 객관식 정답은 보기 번호 1~${choices.length} 중 하나여야 해요 ("${rawAnswer}")`);
      return null;
    }
    return { type, text, choices, answer: n - 1, double };
  }

  if (type === 'ox') {
    const v = squash(rawAnswer);
    if (v !== 'o' && v !== 'x') {
      errors.push(`${at}행: OX 정답은 O 또는 X여야 해요 ("${rawAnswer}")`);
      return null;
    }
    return { type, text, answer: v === 'o' ? 'O' : 'X', double };
  }

  // 단답형 — 인정 답안을 쉼표로 나눈다
  const accepted = rawAnswer.split(',').map(s => s.trim()).filter(Boolean);
  if (!accepted.length) {
    errors.push(`${at}행: 단답형 정답이 비어 있어요. 인정할 답을 쉼표로 나눠 적어 주세요`);
    return null;
  }
  return { type, text, answer: accepted[0], accepted, double };
}
