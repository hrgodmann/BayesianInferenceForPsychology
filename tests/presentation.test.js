import test from 'node:test';
import assert from 'node:assert/strict';
import { skills, generateQuestion, generateExam } from '../site/questions.js';
import { gradeAnswer, formatAnswer } from '../site/engine.js';
import { renderFormula, renderWorking, renderProse, displayAnswer, isIntegerDisplay, toTeX, workingToTeX } from '../site/math-display.js';

// An independent, exact evaluator for the deliberately limited grammar used in
// the displayed numerical substitutions. It never calls the production maths,
// uses eval, or silently removes unknown characters from an expression.
const gcd = (a, b) => b ? gcd(b, a % b) : a < 0n ? -a : a;
class Rational {
  constructor(n, d = 1n) {
    n = BigInt(n); d = BigInt(d);
    assert.notEqual(d, 0n, 'Displayed expression divides by zero');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d); this.n = n / g; this.d = d / g;
  }
  add(v) { return new Rational(this.n * v.d + v.n * this.d, this.d * v.d); }
  sub(v) { return this.add(new Rational(-v.n, v.d)); }
  mul(v) { return new Rational(this.n * v.n, this.d * v.d); }
  div(v) { return new Rational(this.n * v.d, this.d * v.n); }
  pow(v) {
    assert.equal(v.d, 1n, 'Displayed exponents must be integers');
    return v.n < 0n ? new Rational(this.d ** -v.n, this.n ** -v.n) : new Rational(this.n ** v.n, this.d ** v.n);
  }
  number() { return Number(this.n) / Number(this.d); }
}
function rational(text) {
  const [coefficient, exp = '0'] = String(text).split(/[eE]/);
  const [integer, fraction = ''] = coefficient.split('.');
  const n = BigInt(integer + fraction), exponent = Number(exp) - fraction.length;
  return exponent >= 0 ? new Rational(n * 10n ** BigInt(exponent)) : new Rational(n, 10n ** BigInt(-exponent));
}
const factorials = [1n];
function factorial(n) {
  assert.ok(Number.isSafeInteger(n) && n >= 0);
  for (let i = factorials.length; i <= n; i++) factorials.push(factorials[i - 1] * BigInt(i));
  return factorials[n];
}
function evaluate(text) {
  const source = text.replaceAll('×', '*').replaceAll('−', '-').replaceAll('[', '(').replaceAll(']', ')');
  const tokens = [], lexer = /\s*(\d+(?:\.\d+)?(?:e[+-]?\d+)?|[BC()+\-*/^,])\s*/iy;
  let end = 0;
  while (end < source.length) {
    lexer.lastIndex = end;
    const match = lexer.exec(source);
    assert.ok(match, `Unsupported displayed arithmetic at ${source.slice(end)} in ${text}`);
    tokens.push(match[1]); end = lexer.lastIndex;
  }
  let at = 0;
  const take = wanted => assert.equal(tokens[at++], wanted, text);
  function atom() {
    if (tokens[at] === '-') { at++; return rational('-1').mul(atom()); }
    if (tokens[at] === '(') { at++; const value = sum(); take(')'); return value; }
    if (tokens[at] === 'B' || tokens[at] === 'C') {
      const name = tokens[at++]; take('('); const a = sum(); take(','); const b = sum(); take(')');
      assert.equal(a.d, 1n); assert.equal(b.d, 1n);
      const x = Number(a.n), y = Number(b.n);
      return name === 'B'
        ? new Rational(factorial(x - 1) * factorial(y - 1), factorial(x + y - 1))
        : new Rational(factorial(x), factorial(y) * factorial(x - y));
    }
    const token = tokens[at++]; assert.match(token || '', /^\d/); return rational(token);
  }
  function power() { let value = atom(); if (tokens[at] === '^') { at++; value = value.pow(atom()); } return value; }
  function product() {
    let value = power();
    while (tokens[at] === '*' || tokens[at] === '/') { const op = tokens[at++], rhs = power(); value = op === '*' ? value.mul(rhs) : value.div(rhs); }
    return value;
  }
  function sum() {
    let value = product();
    while (tokens[at] === '+' || tokens[at] === '-') { const op = tokens[at++], rhs = product(); value = op === '+' ? value.add(rhs) : value.sub(rhs); }
    return value;
  }
  const result = sum(); assert.equal(at, tokens.length, text); return result;
}
function verifyWorking(q) {
  assert.ok(q.solution?.formula?.trim(), `${q.id}: missing final formula`);
  assert.ok(q.solution?.working?.trim(), `${q.id}: missing final substitution`);
  assert.ok(q.solution?.interpretation?.trim(), `${q.id}: missing interpretation`);
  verifyNumericalWorking(q.solution.working, q, q.id);
  const terminal = q.solution.working.split(/=|≈/).at(-1).trim();
  assert.match(terminal, /^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i, `${q.id}: working must finish with its numerical result`);
  assert.equal(formatAnswer({ ...q, answer: Number(terminal) }), formatAnswer(q),
    `${q.id}: the displayed working must round to the answer used by the unchanged grader`);
  for (const step of q.solution.preparation || []) {
    assert.ok(step.formula?.trim() && step.prompt?.trim(), `${q.id}: incomplete preparation step`);
    verifyNumericalWorking(step.working, step, `${q.id}: ${step.prompt}`);
    verifyPreparationWeight(q, step);
  }
}
function verifyNumericalWorking(raw, item, label) {
  for (const expression of raw.split(/=|≈/)) {
    const value = evaluate(expression.trim()).number();
    // Existing intermediate display values retain seven significant figures.
    // This bound is much narrower than any accepted final-answer rounding unit.
    assert.ok(Math.abs(value - item.answer) <= 1e-6 * Math.max(Math.abs(item.answer), 1e-12),
      `${label}: displayed ${expression} evaluates to ${value}, expected ${item.answer}`);
  }
}
function verifyPreparationWeight(q, step) {
  const history = /^[45]\./.test(q.title)
    ? q.context.match(/giving (\d+) success(?:es)? and (\d+) failures? in total/)
    : q.context.match(/sequence (?:with|contains) (\d+) success(?:es)? and (\d+) failures?/);
  assert.ok(history, `${q.id}: independent preparation audit needs displayed observation counts`);
  const s = Number(history[1]), f = Number(history[2]);
  const rows = q.table.rows, indices = rows.flatMap(([name], index) => step.prompt.includes(name) ? [index] : []);
  const isMarginal = step.prompt.startsWith('Overall probability');
  assert.equal(indices.length, isMarginal ? 0 : 1, `${q.id}: preparation must name precisely one displayed model or the overall probability: ${step.prompt}`);
  const likelihoods = rows.map(([, weight, model]) => {
    const beta = model.match(/Beta\((\d+), (\d+)\)/);
    let likelihood;
    if (beta) {
      const a = Number(beta[1]), b = Number(beta[2]);
      const integral = (x, y) => new Rational(factorial(x - 1) * factorial(y - 1), factorial(x + y - 1));
      likelihood = integral(a + s, b + f).div(integral(a, b));
    } else {
      const p = rational(model.match(/probability ([\d.]+)/)[1]);
      likelihood = p.pow(rational(s)).mul(rational(1).sub(p).pow(rational(f)));
    }
    return likelihood.mul(rational(weight));
  });
  const total = likelihoods.reduce((a, b) => a.add(b), rational(0));
  const expected = (isMarginal ? total : likelihoods[indices[0]].div(total)).number();
  assert.ok(Math.abs(step.answer - expected) <= 1e-12 * Math.max(1, expected), `${q.id}: preparation probability differs from independent model update`);
}
const count = Number(process.env.BAYESVILLE_PRESENTATION_SEEDS || 2500);
const seeds = new Set([0, 0xffffffff, 0x80000000, 0x7fffffff]);
for (let seed = 0; seed < count; seed++) { seeds.add(seed); seeds.add(Math.imul(seed, 0x9e3779b1) >>> 0); }

test('final numerical substitutions independently agree with every answer across generated and full-width seeds', () => {
  const contexts = new Set(), examContexts = new Set();
  for (const seed of seeds) {
    for (const skill of skills) {
      const q = generateQuestion(skill.id, seed); verifyWorking(q);
      contexts.add(`${q.title}|${q.contextId}`);
    }
    for (const [part, q] of generateExam(seed).entries()) { verifyWorking(q); examContexts.add(`${part}|${q.contextId}`); }
  }
  assert.equal(contexts.size, 135, 'Every standalone template in all five contexts');
  assert.equal(examContexts.size, 25, 'Every exam part in all five contexts');
});

function noTypesettingError(html, label) {
  assert.doesNotMatch(html, /math-fallback|katex-error|undefined|NaN/, label);
  if (/class="math-block math-prose"/.test(html)) return;
  assert.match(html, /class="katex"/, label);
  assert.match(html, /<math\b/, `${label}: accessible MathML`);
}

// Convert only the renderer's numerical TeX vocabulary back into independent
// arithmetic. This second check catches changed precedence or missing factors
// in the actual displayed fractions/powers, not just in the source working.
function texArithmetic(tex) {
  const source = tex.replace(/\\(?:left|right)\b/g, '').replace(/\\[,!;]/g, '').replace(/\s+/g, '');
  let at = 0;
  function group() {
    assert.equal(source[at++], '{', tex);
    const result = sequence('}'); assert.equal(source[at++], '}', tex); return result;
  }
  function sequence(stop) {
    let out = '';
    while (at < source.length && source[at] !== stop) {
      if (source[at] === '{') { out += `(${group()})`; continue; }
      if (source[at] !== '\\') { out += source[at++]; continue; }
      const command = source.slice(at).match(/^\\[A-Za-z]+/);
      assert.ok(command, `Unknown TeX token: ${source.slice(at)} in ${tex}`);
      at += command[0].length;
      switch (command[0]) {
        case '\\frac': { const a = group(), b = group(); out += `((${a})/(${b}))`; break; }
        case '\\binom': { const n = group(), k = group(); out += `C(${n},${k})`; break; }
        case '\\mathrm': { const text = group(); assert.equal(text, 'B', tex); out += text; break; }
        case '\\times': out += '*'; break;
        case '\\approx': out += '≈'; break;
        default: assert.fail(`Unknown numerical TeX command ${command[0]} in ${tex}`);
      }
    }
    return out;
  }
  const out = sequence(); assert.equal(at, source.length, tex); return out;
}

function verifyTypesetWorking(raw, item, label) {
  for (const expression of texArithmetic(workingToTeX(raw, item)).split(/=|≈/)) {
    const shown = evaluate(expression).number();
    assert.ok(Math.abs(shown - item.answer) <= 1e-6 * Math.max(Math.abs(item.answer), 1e-12),
      `${label}: typeset substitution ${expression} changes its numerical meaning`);
  }
}

test('every formula and worked substitution typesets with accessible maths across every template and story', () => {
  const cases = new Map();
  for (let seed = 0; seed < 1500; seed++) {
    for (const skill of skills) {
      const q = generateQuestion(skill.id, seed);
      const signature = `${q.title}|${q.contextId}|${q.steps.map(s => s.formula).join('|')}`;
      if (!cases.has(signature)) cases.set(signature, q);
    }
  }
  for (const seed of [0, 1, 2, 3, 4, 76, 0x80000000, 0xffffffff]) {
    for (const q of generateExam(seed)) cases.set(q.id, q);
  }
  for (const q of cases.values()) {
    noTypesettingError(renderFormula(q.solution.formula), q.id);
    noTypesettingError(renderWorking(q.solution.working, q), q.id);
    verifyTypesetWorking(q.solution.working, q, q.id);
    for (const step of [...q.steps, ...q.solution.preparation || []]) {
      noTypesettingError(renderFormula(step.formula), `${q.id}: ${step.prompt}`);
      noTypesettingError(renderWorking(step.working, step), `${q.id}: ${step.prompt}`);
      verifyTypesetWorking(step.working, step, `${q.id}: ${step.prompt}`);
    }
    for (const prose of [q.context, q.prompt, q.solution.interpretation, ...q.hints, ...q.table?.rows.flat() || []]) {
      assert.doesNotMatch(renderProse(String(prose)), /math-fallback|katex-error|undefined|NaN/, `${q.id}: ${prose}`);
    }
  }
});

test('integer presentation does not change calculation precision or make nearby non-integers correct', () => {
  const q = { answer: 7, decimals: 2, unit: 'number', numberFormat: 'integer' };
  assert.equal(isIntegerDisplay(q), true);
  assert.equal(displayAnswer(q), '7');
  assert.equal(formatAnswer(q), '7.00', 'The existing grading precision is untouched');
  for (const raw of ['7', '7.00', '14/2', '7,00']) assert.equal(gradeAnswer(q, raw).correct, true);
  for (const raw of ['6.6', '7.4', '6.99', '7.01']) assert.equal(gradeAnswer(q, raw).correct, false, raw);
  const unmarked = { answer: 7, decimals: 2, unit: 'ratio' };
  assert.equal(isIntegerDisplay(unmarked), false, 'Whole-valued ratios are not automatically counts');
  assert.equal(displayAnswer(unmarked), '7.00');
  let found = 0;
  for (let seed = 0; seed < 100; seed++) for (const skill of skills) {
    const q = generateQuestion(skill.id, seed);
    for (const item of [q, ...q.steps]) {
      if (!isIntegerDisplay(item)) continue;
      found++;
      assert.equal(item.unit, 'number');
      assert.equal(Number.isInteger(item.answer), true);
      assert.equal(displayAnswer(item), String(item.answer));
      assert.equal(item.decimals, 2, 'Display-only change retains two-place grading');
      assert.equal(gradeAnswer(item, String(item.answer + 0.4)).correct, false);
    }
  }
  assert.ok(found > 100);
});

test('fractions, powers, sums, subscripts and binomial notation preserve explicit structure', () => {
  assert.equal(toTeX('1 / (2 + 3)'), '\\frac{1}{2 + 3}');
  assert.equal(evaluate(texArithmetic(toTeX('2 × 3 / (4 + 2)'))).number(), 1);
  assert.equal(evaluate(texArithmetic(toTeX('(1 / 2)^3 × (1 − 1 / 2)^2'))).number(), 1 / 32);
  assert.equal(evaluate(texArithmetic(toTeX('C(5, 2) × B(3, 4) / B(1, 1)'))).number(), 1 / 6);
  assert.match(toTeX('P(K = k) = C(n, k)p^k(1 − p)^(n − k)'), /\\binom\{n\}\{k\}.*p\^\{k\}.*\^\{n - k\}/);
  assert.match(toTeX('BF_AB = P(D | A) / P(D | B)'), /\\mathrm\{BF\}_\{AB\}/);
  assert.match(toTeX('P(data) = Σ P(model)P(data | model)'), /\\sum/);
});

test('equal signs distinguish exact substitutions from rounded intermediate values', () => {
  for (const source of ['2 + 3 = 5', '1 / 8 = 0.125', 'C(5, 2) = 10']) {
    assert.doesNotMatch(workingToTeX(source), /\\approx/, source);
  }
  for (const source of ['1 / 3 = 0.3333333', '2 / 7 = 0.2857143', '1 / 3 = 2 / 6 = 0.3333333']) {
    assert.match(workingToTeX(source), /\\approx/, source);
  }
  assert.equal((workingToTeX('1 / 3 = 2 / 6 = 0.3333333').match(/\\approx/g) || []).length, 1);
});

test('mathematical and prose rendering escape authored text and disable arbitrary HTML', () => {
  for (const render of [renderFormula, renderProse]) {
    const html = render('<script>alert(1)</script> <img src=x onerror=alert(2)>');
    assert.doesNotMatch(html, /<script|<img/i);
  }
  assert.equal(typeof toTeX('1 / (2 + 3)'), 'string');
});
