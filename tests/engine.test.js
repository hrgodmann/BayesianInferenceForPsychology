import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNumeric, gradeAnswer, formatAnswer, roundTo } from '../site/engine.js';

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

test('rounding absorbs arithmetic noise at halves without accepting adjacent answers', () => {
  const q = { answer: 13.124999999999993, unit: 'ratio', decimals: 2 };
  assert.equal(formatAnswer(q), '13.13');
  assert.equal(gradeAnswer(q, '105/8').correct, true);
  assert.equal(gradeAnswer(q, '13.13').correct, true);
  assert.equal(gradeAnswer(q, '13.12').correct, false);
  assert.equal(roundTo(.62499999), .62);
  assert.equal(roundTo(.62500001), .63);
  assert.equal(formatAnswer({ answer: .0000128, decimals: 6 }), '0.000013');
});

test('numeric conversion rejects overflow and nonzero underflow without losing genuine zeros', () => {
  const zeroQuestion = { answer: 0, unit: 'probability', decimals: 2 };
  for (const input of [
    '-1e-999', '1e-999', '-1/1e999', '1/1e999', '0/1e999',
    '1e999/1e999', '1e-999/1e-999', '1e-300/1e100',
    '-1e-300/1e100', '5e-324%', '-5e-324%', '1e999',
  ]) {
    assert.ok(parseNumeric(input).error, input);
    assert.ok(gradeAnswer(zeroQuestion, input).error, `${input} must not be graded as zero`);
  }
  for (const input of ['0e-999', '-0e-999', '0e999', '0e-999/2', '-0/1e308', '0e-999%']) {
    assert.equal(parseNumeric(input).value === 0, true, input);
    assert.equal(gradeAnswer(zeroQuestion, input).correct, true, input);
  }
  assert.equal(parseNumeric('2e-300/4e-300').value, .5);
  assert.equal(parseNumeric('1e308/1e308').value, 1);
  assert.equal(parseNumeric('5e-324').value, Number.MIN_VALUE);
});
