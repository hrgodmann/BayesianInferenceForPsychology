import test from 'node:test';
import assert from 'node:assert/strict';
import { generateExam, GENERATOR_VERSION } from '../site/questions.js';
import { parseNumeric, gradeAnswer, formatAnswer, roundTo, normalizeRef, makeRef, refKey, questionFor,
  emptyProgress, normalizeProgress, recordAttempt, latestAttempts, reviewRefs, summarize, restoreSession, appendEndlessRef } from '../site/engine.js';

const ref = makeRef('probability', 123, 'practice');
const attempt = (id = 'a', correct = false, method = 'checked', r = ref) => ({ id, ref: r, correct, method, hinted: false, at: '2026-10-03T12:00:00Z' });
const makeSession = (overrides = {}) => ({ version: GENERATOR_VERSION, id: 'session-test', mode: 'skill', skillId: 'probability', difficulty: 'practice',
  length: 5, refs: Array.from({ length: 5 }, (_, i) => makeRef('probability', 123 + i, 'practice')), index: 0,
  answers: [], hint: 0, input: '', notes: '', guided: false, steps: [], complete: false, ...overrides });

test('numeric input accepts equivalent classroom formats, never evaluates expressions', () => {
  for (const [input, expected] of [['0.42', .42], ['0,42', .42], ['42%', .42], [' 2 / 3 ', 2 / 3], ['4.2e-1', .42], ['0', 0], ['100%', 1]]) assert.equal(parseNumeric(input).value, expected);
  for (const input of ['', '2/0', '1 + 2', 'Infinity', 'NaN', '1,2,3', '-0.1', '102%', '1.1', '<script>']) assert.ok(parseNumeric(input).error, input);
  assert.equal(parseNumeric('12.5', 'ratio').value, 12.5);
  assert.ok(parseNumeric('125%', 'ratio').error);
});
test('explicit half-up rounding, full-precision fractions, and question-specific precision', () => {
  assert.equal(roundTo(.625), .63);
  assert.equal(roundTo(1.005), 1.01);
  assert.equal(roundTo(12.345), 12.35);
  assert.equal(formatAnswer({ answer: .625 }), '0.63');
  assert.equal(gradeAnswer({ answer: .625 }, '5/8').correct, true);
  assert.equal(gradeAnswer({ answer: .625 }, '.63').correct, true);
  assert.equal(gradeAnswer({ answer: .625 }, '.62').correct, false);
  assert.equal(gradeAnswer({ answer: .00432, decimals: 4 }, '.0043').correct, true);
  assert.equal(gradeAnswer({ answer: .00432, decimals: 4 }, '0').correct, false);
  assert.equal(gradeAnswer({ answer: 3.3, unit: 'ratio' }, '3.30').correct, true);
});
test('seed references reproduce exact questions without saving answer content', () => {
  assert.deepEqual(normalizeRef(ref), ref);
  assert.deepEqual(questionFor(ref), questionFor(JSON.parse(JSON.stringify(ref))));
  assert.notEqual(refKey(ref), refKey({ ...ref, seed: 124 }));
  assert.equal(normalizeRef({ ...ref, version: 1 }), null);
  for (const seed of [-1, 1.2, 2 ** 32, NaN]) assert.equal(normalizeRef({ ...ref, seed }), null);
  assert.equal(normalizeRef({ ...ref, skillId: 'old-chapter' }), null);
  assert.equal(normalizeRef({ ...ref, difficulty: 'not-real' }), null);
});
test('bookmarked exam parts retain the full original scenario', () => {
  const refs = generateExam(42).map((q, i) => makeRef('exam', 42, 'practice', i));
  assert.equal(new Set(refs.map(refKey)).size, refs.length);
  refs.forEach((r, i) => assert.deepEqual(questionFor(normalizeRef(r)), generateExam(42)[i]));
  assert.equal(normalizeRef(makeRef('exam', 42, 'practice', 99)), null);
});
test('progress validation discards corrupt data and leaves old chapter progress separate', () => {
  assert.deepEqual(normalizeProgress({ version: 1, attempts: [attempt()] }), emptyProgress());
  const data = normalizeProgress({ version: 2, attempts: [attempt(), attempt('bad', 'yes'), { ...attempt('badtime'), at: 'oops' }, { ...attempt('badref'), ref: { seed: 1 } }], bookmarks: [ref, ref, { ...ref, seed: -1 }] });
  assert.equal(data.attempts.length, 1);
  assert.deepEqual(data.bookmarks, [ref]);
});
test('self-mark replaces one attempt; latest checked success clears its review entry', () => {
  let p = recordAttempt(emptyProgress(), attempt());
  p = recordAttempt(p, attempt('a', true, 'self'));
  assert.equal(p.attempts.length, 1);
  assert.equal(summarize(p).checked, 0);
  assert.equal(summarize(p).self, 1);
  p = recordAttempt(p, attempt('b', false));
  assert.equal(reviewRefs(p).length, 1);
  p = recordAttempt(p, attempt('c', true));
  assert.equal(reviewRefs(p).length, 0);
  assert.equal(latestAttempts(p).size, 1);
  assert.deepEqual(summarize(p), { attempts: 3, checked: 2, correct: 1, self: 1, review: 0 });
});
test('viewed and skipped questions are reviewable but excluded from checked accuracy', () => {
  let p = emptyProgress();
  p = recordAttempt(p, attempt('view', null, 'revealed'));
  p = recordAttempt(p, attempt('skip', null, 'skipped', makeRef('bayes', 8)));
  assert.equal(summarize(p).checked, 0);
  assert.equal(reviewRefs(p).length, 2);
  assert.equal(summarize(p, 'bayes').attempts, 1);
});
test('attempt and bookmark storage bounds prevent unbounded local storage', () => {
  const raw = { version: 2, attempts: Array.from({ length: 5010 }, (_, i) => attempt(String(i))), bookmarks: Array.from({ length: 510 }, (_, i) => makeRef('probability', i)) };
  const p = normalizeProgress(raw);
  assert.equal(p.attempts.length, 5000); assert.equal(p.bookmarks.length, 500);
  assert.equal(recordAttempt(p, attempt('last')).attempts.length, 5000);
});
test('session restores input, notes, hints, and rechecks saved guided answers', () => {
  const q = questionFor(ref), input = String(q.steps[0].answer);
  const restored = restoreSession(makeSession({ input: '42%', notes: 'my working', hint: 99, guided: true, steps: [{ input, checked: true, correct: false }] }));
  assert.equal(restored.input, '42%'); assert.equal(restored.notes, 'my working');
  assert.equal(restored.hint, q.hints.length); assert.equal(restored.steps[0].correct, true);
});
test('invalid references, indexes, duplicate IDs, wrong version, and malformed mode invalidate sessions', () => {
  for (const raw of [null, makeSession({ version: 1 }), makeSession({ index: -1 }), makeSession({ index: 99 }), makeSession({ refs: [ref, ref] }), makeSession({ mode: 'tf' }), makeSession({ refs: [{ ...ref, seed: null }] }), makeSession({ difficulty: 'bad' }), makeSession({ skillId: 'bayes' })]) assert.equal(restoreSession(raw), null);
});
test('session ignores answer records from future questions and unknown references', () => {
  const raw = makeSession({ answers: [{ key: refKey(ref), correct: true, method: 'checked', raw: '0.5' }, { key: refKey(makeRef('probability', 124)), correct: true, method: 'checked' }] });
  assert.equal(restoreSession(raw).answers.length, 1);
});
test('endless and exact-seed review sessions restore without a fixed question-bank size', () => {
  assert.ok(restoreSession(makeSession({ length: 0, refs: [ref] })));
  assert.ok(restoreSession(makeSession({ mode: 'review', skillId: 'review', length: 1, refs: [ref] })));
  const refs = generateExam(7).map((_,i) => makeRef('exam', 7, 'practice', i));
  assert.ok(restoreSession(makeSession({ mode: 'exam', skillId: 'exam', refs, length: refs.length })));
});


test('restoration rejects endless exam/review modes and incomplete finite sessions', () => {
  const refs = generateExam(7).map((_,i) => makeRef('exam', 7, 'practice', i));
  assert.equal(restoreSession(makeSession({ mode: 'exam', skillId: 'exam', refs, length: 0 })), null);
  assert.equal(restoreSession(makeSession({ mode: 'review', skillId: 'review', refs: [ref], length: 0 })), null);
  assert.equal(restoreSession(makeSession({ refs: [ref], length: 5 })), null);
  assert.equal(restoreSession(makeSession({ mode: 'exam', skillId: 'exam', refs, length: refs.length, difficulty: 'challenge' })), null);
});
test('endless sessions roll their reference window and remain resumable after 5000 questions', () => {
  const refs = Array.from({ length: 5000 }, (_, i) => makeRef('probability', i));
  const first = { key: refKey(refs[0]), correct: false, method: 'checked', raw: '0' };
  const last = { key: refKey(refs.at(-1)), correct: true, method: 'checked', raw: '0.5' };
  let session = makeSession({ length: 0, refs, index: 4999, answers: [first, last] });
  session = appendEndlessRef(session, makeRef('probability', 5000));
  session.index++;
  assert.equal(session.refs.length, 5000); assert.equal(session.index, 4999);
  assert.equal(session.offset + session.index + 1, 5001);
  assert.equal(session.answers.length, 1);
  assert.deepEqual(restoreSession(session).refs.at(-1), makeRef('probability', 5000));
  assert.equal(restoreSession(session).offset, 1);
  assert.throws(() => appendEndlessRef(makeSession(), ref));
});
