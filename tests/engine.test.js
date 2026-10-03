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
