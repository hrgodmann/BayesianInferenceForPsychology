import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNumeric, gradeAnswer, formatAnswer, emptyProgress, normalizeProgress,
  recordAttempt, selectQuestions, summarize, restoreSession, latestAttempts,
} from '../site/engine.js';
import { chapters, questions } from '../site/questions.js';

const ids = questions.map(question => question.id);
const byId = new Map(questions.map(question => [question.id, question]));
const question = id => {
  assert.ok(byId.has(id), `Missing question ${id}`);
  return byId.get(id);
};
const attempt = (questionId, overrides = {}) => ({
  id: `round-a:${questionId}`, questionId, correct: false, method: 'checked',
  hinted: false, at: '2026-09-29T10:00:00.000Z', ...overrides,
});

test('calculation grading compares answers rounded to two decimals', () => {
  const q = question('ch3-calc-07'); // Exact probability 3/8, rounded to 0.38.
  for (const input of ['0.38', '0.375', '3/8', '37.5%', '0,38']) {
    assert.equal(gradeAnswer(q, input).correct, true, input);
  }
  for (const input of ['0.37', '0.374', '0.39']) {
    assert.equal(gradeAnswer(q, input).correct, false, input);
  }
  assert.equal(formatAnswer(q), '0.38');
});

test('the same numerical answer works as a decimal, comma, fraction, or percent', () => {
  const q = question('ch3-calc-02'); // 16/29, approximately 0.551724.
  for (const input of ['0.55', '0,55', '55%', '55,17 %', '16/29', ' 16 / 29 ']) {
    assert.equal(gradeAnswer(q, input).correct, true, input);
  }
  assert.equal(gradeAnswer(q, '0.80').correct, false, 'reverse conditional must not pass');
  assert.equal(gradeAnswer(q, '0.32').correct, false, 'joint probability must not pass');
});

test('invalid numbers produce an error without recording a correctness result', () => {
  for (const input of ['', '   ', null, undefined, 'two', '0.4abc', '2/0', 'NaN', 'Infinity', '1e309', '1,2,3', '42%%', '0.2+0.3']) {
    const result = gradeAnswer(question('ch3-calc-01'), input);
    assert.equal(typeof result.error, 'string', `${String(input)} needs an error`);
    assert.equal('correct' in result, false);
  }
});

test('probability bounds are enforced before rounding', () => {
  for (const input of ['-0.01', '1.01', '101%', '42', '1.001', '-0.001']) {
    assert.equal(typeof parseNumeric(input).error, 'string', input);
  }
  assert.deepEqual(parseNumeric('0'), { value: 0 });
  assert.deepEqual(parseNumeric('100%'), { value: 1 });
  assert.deepEqual(parseNumeric('1'), { value: 1 });
});

test('odds, likelihood ratios, and distances can exceed one but cannot use percentages', () => {
  assert.equal(gradeAnswer(question('ch3-calc-08'), '3').correct, true);
  assert.equal(gradeAnswer(question('ch5-calc-04'), '1,5').correct, true);
  assert.equal(gradeAnswer(question('ch5-calc-04'), '3/2').correct, true);
  for (const id of ['ch3-calc-06', 'ch3-calc-08', 'ch5-calc-04']) {
    assert.equal(typeof gradeAnswer(question(id), '60%').error, 'string', id);
    assert.equal(typeof gradeAnswer(question(id), '-1').error, 'string', id);
  }
  assert.equal(formatAnswer(question('ch3-calc-08')), '3.00');
  assert.equal(formatAnswer(question('ch5-calc-04')), '1.50 km');
});

test('true/false grading requires an explicit Boolean selection', () => {
  const trueQuestion = question('synopsis-tf-01');
  const falseQuestion = question('synopsis-tf-02');
  assert.equal(gradeAnswer(trueQuestion, true).correct, true);
  assert.equal(gradeAnswer(trueQuestion, false).correct, false);
  assert.equal(gradeAnswer(falseQuestion, false).correct, true);
  for (const input of [undefined, null, '', 'true', 'false', 0, 1]) {
    assert.equal(typeof gradeAnswer(trueQuestion, input).error, 'string');
  }
  assert.equal(formatAnswer(trueQuestion), 'True');
  assert.equal(formatAnswer(falseQuestion), 'False');
});

test('self-assessment replaces the current attempt without double counting it', () => {
  const id = 'ch3-calc-01';
  const pristine = emptyProgress();
  const checked = recordAttempt(pristine, attempt(id));
  const selfAssessed = recordAttempt(checked, attempt(id, { correct: true, method: 'self' }));
  assert.equal(pristine.attempts.length, 0, 'recording must not mutate an earlier snapshot');
  assert.equal(checked.attempts[0].correct, false);
  assert.equal(selfAssessed.attempts.length, 1);
  assert.equal(selfAssessed.attempts[0].method, 'self');
  assert.deepEqual(summarize(selfAssessed, ids), {
    practiced: 1, understood: 1, review: 0, checked: 0, checkedCorrect: 0,
  });
  const changedMind = recordAttempt(selfAssessed, attempt(id, { correct: false, method: 'self' }));
  assert.equal(changedMind.attempts.length, 1);
  assert.equal(summarize(changedMind, ids).review, 1);
});

test('review follows the latest attempt and drops a question after a correct retry', () => {
  const id = 'ch3-calc-02';
  let progress = recordAttempt(emptyProgress(), attempt(id));
  assert.deepEqual(selectQuestions(questions, { pool: 'review' }, progress).map(q => q.id), [id]);
  progress = recordAttempt(progress, attempt(id, {
    id: `round-b:${id}`, correct: true, at: '2026-09-29T11:00:00.000Z',
  }));
  assert.equal(progress.attempts.length, 2, 'separate practice rounds retain separate attempts');
  assert.deepEqual(selectQuestions(questions, { pool: 'review' }, progress), []);
  assert.deepEqual(summarize(progress, ids), {
    practiced: 1, understood: 1, review: 0, checked: 2, checkedCorrect: 1,
  });
});

test('viewing a solution without self-assessing leaves the question for review', () => {
  const id = 'ch3-calc-03';
  const progress = recordAttempt(emptyProgress(), attempt(id, { correct: null, method: 'skipped' }));
  assert.deepEqual(selectQuestions(questions, { pool: 'review' }, progress).map(q => q.id), [id]);
  assert.deepEqual(summarize(progress, ids), {
    practiced: 1, understood: 0, review: 1, checked: 0, checkedCorrect: 0,
  });
});

test('a retried question returns to the top of recent discoveries', () => {
  const practicedIds = ids.slice(0, 10);
  let progress = emptyProgress();
  for (const id of practicedIds) progress = recordAttempt(progress, attempt(id));
  const retriedId = practicedIds[0];
  progress = recordAttempt(progress, attempt(retriedId, {
    id: `round-b:${retriedId}`, correct: true, at: '2026-09-29T11:00:00.000Z',
  }));
  const recent = [...latestAttempts(progress).values()].reverse();
  assert.equal(recent.length, practicedIds.length, 'a retry must not duplicate a question');
  assert.deepEqual(recent.map(a => a.questionId), [retriedId, ...practicedIds.slice(1).reverse()]);
  assert.equal(recent[0].correct, true, 'the newest assessment must replace the earlier one');
  assert.ok(recent.slice(0, 8).some(a => a.questionId === retriedId), 'the latest retry must appear in the visible recent list');
});

test('chapter, question type, and pool filters are combined', () => {
  const bookmarkIds = ['ch3-calc-01', 'ch3-tf-01', 'ch5-calc-01'];
  let progress = { ...emptyProgress(), bookmarks: bookmarkIds };
  for (const id of bookmarkIds) progress = recordAttempt(progress, attempt(id));
  progress = recordAttempt(progress, attempt('ch3-calc-02', { correct: true }));
  const selectIds = options => selectQuestions(questions, options, progress).map(q => q.id);
  assert.equal(selectIds({ chapterId: '3', type: 'mixed' }).length, 16);
  assert.equal(selectIds({ chapterId: '3', type: 'tf' }).length, 7);
  assert.equal(selectIds({ chapterId: '3', type: 'calculation' }).length, 9);
  assert.deepEqual(selectIds({ chapterId: '3', type: 'calculation', pool: 'bookmarks' }), ['ch3-calc-01']);
  assert.deepEqual(selectIds({ chapterId: '3', type: 'calculation', pool: 'review' }), ['ch3-calc-01']);
  assert.deepEqual(selectIds({ chapterId: '1', type: 'calculation' }), []);
  assert.equal(selectIds({ chapterId: 'all', type: 'mixed', pool: 'all' }).length, 48);
  assert.deepEqual(selectIds({ chapterId: 'unknown' }), []);
});

test('progress restoration handles missing or unsupported data safely', () => {
  for (const raw of [null, undefined, false, {}, { version: 99 }, { version: 1, attempts: 'oops', bookmarks: 8 }]) {
    assert.deepEqual(normalizeProgress(raw, ids), emptyProgress());
  }
});

test('progress restoration removes corrupt attempts and unknown or duplicate bookmarks', () => {
  const id = 'ch3-calc-01';
  const normalized = normalizeProgress({
    version: 1,
    attempts: [
      attempt(id), null, {}, attempt('deleted-question'),
      attempt(id, { id: 42 }), attempt(id, { correct: 'yes' }),
      attempt(id, { at: 'invalid date' }), attempt(id, { at: null }),
    ],
    bookmarks: [id, id, 'deleted-question', null],
  }, ids);
  assert.deepEqual(normalized.attempts, [attempt(id)]);
  assert.deepEqual(normalized.bookmarks, [id]);
  assert.equal(summarize(normalized, ids).practiced, 1);
});

const savedSession = overrides => ({
  id: 'round-restored', ids: ['ch3-calc-01', 'ch3-calc-02'], index: 1,
  answers: [{ questionId: 'ch3-calc-01', correct: true, method: 'checked', hinted: true, raw: '0.58' }],
  chapterId: '3', type: 'calculation', pool: 'all', hint: 1,
  revealed: false, selection: null, input: '16/29', notes: '32 correct out of 58', complete: false,
  ...overrides,
});

test('a paused session restores answers, input, hints, and scratchpad', () => {
  const raw = savedSession();
  const restored = restoreSession(raw, questions);
  assert.deepEqual(restored, raw);
  assert.equal(gradeAnswer(question(restored.ids[restored.index]), restored.input).correct, true);
});

test('corrupt session identity, question lists, and indices cannot start a broken round', () => {
  for (const raw of [
    null, {}, savedSession({ id: 3 }), savedSession({ ids: [] }),
    savedSession({ ids: ['deleted-question'], index: 0 }),
    savedSession({ ids: ['ch3-calc-01', 'ch3-calc-01'] }),
    savedSession({ index: -1 }), savedSession({ index: 2 }), savedSession({ index: 0.5 }),
  ]) assert.equal(restoreSession(raw, questions), null);
});

test('session restoration sanitizes malformed preferences and answer data', () => {
  const restored = restoreSession(savedSession({
    type: 'essay', pool: 'mystery', hint: 80, selection: 'false', input: 42, notes: null,
    answers: [null, {}, { questionId: 'deleted-question', correct: true },
      { questionId: 'ch3-calc-01', correct: 'true' }],
  }), questions);
  assert.equal(restored.type, 'mixed');
  assert.equal(restored.pool, 'all');
  assert.equal(restored.hint, 0);
  assert.equal(restored.selection, null);
  assert.equal(restored.input, '');
  assert.equal(restored.notes, '');
  assert.deepEqual(restored.answers, []);
});

test('corrupt session answers cannot inflate the results beyond its question list', () => {
  const restored = restoreSession(savedSession({
    ids: ['ch3-calc-01'], index: 0,
    answers: [
      { questionId: 'ch3-calc-01', correct: false, method: 'checked' },
      { questionId: 'ch3-calc-01', correct: true, method: 'self' },
      { questionId: 'ch5-calc-01', correct: true, method: 'checked' },
    ],
  }), questions);
  assert.equal(restored.answers.length, 1, 'one answer per question in the current round');
  assert.equal(restored.answers[0].questionId, 'ch3-calc-01');
  assert.equal(restored.answers[0].correct, true, 'keep the final self-assessment');
});

test('the bank has unique identifiers, complete teaching feedback, and valid chapter links', () => {
  assert.equal(questions.length, 48);
  assert.equal(new Set(ids).size, questions.length);
  assert.equal(new Set(chapters.map(chapter => chapter.id)).size, chapters.length);
  for (const chapter of chapters) {
    for (const key of ['id', 'number', 'title', 'bookTitle', 'description', 'pages', 'icon']) {
      assert.equal(typeof chapter[key], 'string', `${chapter.id}: ${key}`);
      assert.ok(chapter[key].trim().length);
    }
    assert.ok([1, 2].includes(chapter.week));
    assert.ok(questions.some(q => q.chapterId === chapter.id));
  }
  for (const q of questions) {
    assert.ok(chapters.some(chapter => chapter.id === q.chapterId), q.id);
    for (const key of ['id', 'title', 'prompt', 'explanation', 'concept']) {
      assert.equal(typeof q[key], 'string', `${q.id}: ${key}`);
      assert.ok(q[key].trim().length, `${q.id}: empty ${key}`);
    }
    assert.ok(['tf', 'calculation'].includes(q.type));
    assert.ok(['Foundation', 'Apply', 'Stretch'].includes(q.difficulty));
    assert.equal(q.hints.length, 2, q.id);
    assert.ok(q.hints.every(hint => typeof hint === 'string' && hint.trim().length > 0), q.id);
    assert.equal(typeof q.source.chapter, 'string');
    assert.equal(typeof q.source.pages, 'string');
    if (q.type === 'tf') assert.equal(typeof q.answer, 'boolean', q.id);
    else {
      assert.ok(Number.isFinite(q.answer), q.id);
      assert.ok(q.answer >= 0, q.id);
      if (!q.unit || q.unit === 'probability') assert.ok(q.answer <= 1, q.id);
      assert.match(q.prompt, /two decimals/i);
      assert.ok(q.working.length > 0, q.id);
    }
    if (q.table) {
      assert.ok(q.table.headers.length > 0);
      assert.ok(q.table.rows.every(row => row.length === q.table.headers.length), q.id);
    }
  }
});

test('all sixteen calculation answers agree with independent counts or algebra', () => {
  // These keys use alternative counts or simplified fractions instead of copying
  // the expressions in questions.js, including both farmer indifference equations.
  const independentlyCalculated = {
    'ch3-calc-01': (320 + 210 + 50) / 1000,
    'ch3-calc-02': 320 / (320 + 210 + 50),
    'ch3-calc-03': 200 / (80 + 140 + 200),
    'ch3-calc-04': (45 + 30 - 12) / 100,
    'ch3-calc-05': 30 / 100,
    'ch3-calc-06': 3 / 5,
    'ch3-calc-07': 3 / (3 + 5),
    'ch3-calc-08': 54 / 18,
    'ch3-calc-09': 90 / (90 + 180),
    'ch5-calc-01': 62 / 100,
    'ch5-calc-02': 1 / 6,
    'ch5-calc-03': (18 - 9) / (18 - 6),
    'ch5-calc-04': (8 - 5) / 2,
    'ch6-calc-01': 73 / 100,
    'ch6-calc-02': 28 / 100,
    'ch6-calc-03': 45 / 100,
  };
  const numerical = questions.filter(q => q.type === 'calculation');
  assert.equal(numerical.length, 16);
  assert.equal(Object.keys(independentlyCalculated).length, numerical.length);
  for (const q of numerical) {
    assert.ok(Math.abs(q.answer - independentlyCalculated[q.id]) < 1e-12, q.id);
    assert.equal(gradeAnswer(q, String(independentlyCalculated[q.id])).correct, true, q.id);
    assert.equal(gradeAnswer(q, independentlyCalculated[q.id].toFixed(2)).correct, true, q.id);
  }
});
