import test from 'node:test';
import assert from 'node:assert/strict';
import { skills, generateQuestion, generateExam } from '../site/questions.js';
import { gradeAnswer, formatAnswer, roundTo } from '../site/engine.js';

// Audit reference uses BigInt rational arithmetic and factorial beta integrals.
// It reconstructs every input from the student-visible text and tables rather
// than calling the production math helpers or copying generated answers.
const gcd = (a, b) => b ? gcd(b, a % b) : a < 0n ? -a : a;
class Rational {
  constructor(n, d = 1n) {
    n = BigInt(n); d = BigInt(d);
    if (d < 0n) { n = -n; d = -d; }
    assert.notEqual(d, 0n);
    const g = gcd(n, d); this.n = n / g; this.d = d / g;
  }
  add(v) { v = R(v); return new Rational(this.n * v.d + v.n * this.d, this.d * v.d); }
  sub(v) { return this.add(R(v).mul(-1)); }
  mul(v) { v = R(v); return new Rational(this.n * v.n, this.d * v.d); }
  div(v) { v = R(v); return new Rational(this.n * v.d, this.d * v.n); }
  pow(n) { return new Rational(this.n ** BigInt(n), this.d ** BigInt(n)); }
  number() { return Number(this.n) / Number(this.d); }
  rounded(digits) {
    assert.ok(this.n >= 0n);
    const scale = 10n ** BigInt(digits), value = this.n * scale;
    const rounded = value / this.d + (2n * (value % this.d) >= this.d ? 1n : 0n);
    const text = rounded.toString().padStart(digits + 1, '0');
    return digits ? `${text.slice(0, -digits)}.${text.slice(-digits)}` : text;
  }
  fraction() { return `${this.n}/${this.d}`; }
}
function R(value) {
  if (value instanceof Rational) return value;
  const [coefficient, exponentText = '0'] = String(value).replace(/\.$/, '').split(/[eE]/);
  const [whole, rest = ''] = coefficient.split('.');
  const exponent = Number(exponentText) - rest.length;
  const numerator = BigInt(whole + rest);
  return exponent >= 0 ? new Rational(numerator * 10n ** BigInt(exponent)) : new Rational(numerator, 10n ** BigInt(-exponent));
}
const sum = values => values.reduce((total, v) => total.add(v), R(0));
const facts = [1n];
function fact(n) { for (let i = facts.length; i <= n; i++) facts.push(facts[i - 1] * BigInt(i)); return facts[n]; }
const combination = (n, k) => new Rational(fact(n), fact(k) * fact(n - k));
function betaIntegral(a, b) { return new Rational(fact(a - 1) * fact(b - 1), fact(a + b - 1)); }
function likelihood(model, s, f) {
  return model.p ? model.p.pow(s).mul(R(1).sub(model.p).pow(f)) : betaIntegral(model.a + s, model.b + f).div(betaIntegral(model.a, model.b));
}
function models(q) {
  return q.table.rows.map(([name, weight, distribution]) => {
    const beta = distribution.match(/Beta\((\d+), (\d+)\)/);
    return beta ? { name, weight: R(weight), a: Number(beta[1]), b: Number(beta[2]) } : { name, weight: R(weight), p: R(distribution.match(/probability ([\d.]+)/)[1]) };
  });
}
function posterior(ms, s, f) {
  const unnormalized = ms.map(m => m.weight.mul(likelihood(m, s, f))), total = sum(unnormalized);
  return ms.map((m, i) => ({ ...m, weight: unnormalized[i].div(total), ...(!m.p ? { a: m.a + s, b: m.b + f } : {}) }));
}
const marginal = (ms, s, f) => sum(ms.map(m => m.weight.mul(likelihood(m, s, f))));
const pair = (text, expression) => text.match(expression).slice(1).map(Number);
function reference(q) {
  if (q.skillId === 'probability') {
    const ws = q.table.rows.map(row => R(row[1]));
    const backwards = q.table.rows[0][2] === '?';
    if (backwards) {
      const known = sum(q.table.rows.slice(1).map((row, i) => ws[i + 1].mul(R(row[2]))));
      return [R(q.prompt.match(/probability is ([\d.]+)/)[1]).sub(known).div(ws[0]), [known]];
    }
    const joints = q.table.rows.map((row, i) => ws[i].mul(R(row[2])));
    return [sum(joints), [joints[0]]];
  }
  if (q.skillId === 'bayes') {
    const ms = models(q), f = q.prompt.includes('failed') ? 1 : 0, s = q.prompt.includes('followed by') ? 1 : f ? 0 : q.prompt.includes('two passed') ? 2 : 1;
    return [posterior(ms, s, f)[0].weight, [ms[0].weight.mul(likelihood(ms[0], s, f)), marginal(ms, s, f)]];
  }
  if (q.skillId === 'sequences') {
    const p = R(q.context.match(/probability ([\d.]+)/)[1]);
    if (q.prompt.includes('ordered sequence')) {
      const tokens = q.prompt.split(': ')[1].match(/[SF]/g), s = tokens.filter(t => t === 'S').length, f = tokens.length - s;
      return [likelihood({ p }, s, f), [p.pow(s)]];
    }
    const n = Number(q.prompt.match(/in (\d+) trials/)[1]);
    if (q.prompt.includes('at least')) {
      const zero = likelihood({ p }, 0, n), one = likelihood({ p }, 1, n - 1).mul(n);
      return [R(1).sub(zero).sub(one), [zero, one]];
    }
    const k = Number(q.prompt.match(/exactly (\d+)/)[1]), one = likelihood({ p }, k, n - k), c = combination(n, k);
    return [one.mul(c), [c, one]];
  }
  if (q.skillId === 'beta') {
    const [a, b] = pair(q.context, /Beta\((\d+), (\d+)\)/);
    if (q.title.startsWith('Update')) {
      const [observed, n] = pair(q.prompt, /(\d+) of (\d+) seeds/), first = q.prompt.includes('first parameter');
      return [R((first ? a : b) + n - observed), [R(n - observed)]];
    }
    if (q.title.includes('Laplace')) {
      const [s, f] = pair(q.prompt, /(\d+) successes and (\d+) failures/);
      return [R(s + 1).div(s + f + 2), [R(s + 1), R(s + f + 2)]];
    }
    const history = q.context.match(/observed (\d+) successes and (\d+) failures/);
    const aa = a + (history ? +history[1] : 0), bb = b + (history ? +history[2] : 0);
    const [k, n] = pair(q.prompt, /exactly (\d+) successes in the next (\d+)/), c = combination(n, k);
    const seq = likelihood({ a: aa, b: bb }, k, n - k);
    return [seq.mul(c), history ? [R(aa), R(bb), c] : [c, seq]];
  }
  if (q.skillId === 'mixtures') {
    const ms = models(q), [k, n] = pair(q.prompt, /exactly (\d+) of the first (\d+)/), c = combination(n, k);
    const values = ms.map(m => likelihood(m, k, n - k).mul(c));
    return [sum(values.map((v, i) => v.mul(ms[i].weight))), values];
  }
  if (q.skillId === 'prediction') {
    const ms = models(q), [s, f] = pair(q.context, /sequence with (\d+) successes and (\d+) failures/), post = posterior(ms, s, f);
    const count = q.prompt.includes('exactly two'), one = q.prompt.includes('next trial succeeds');
    return [marginal(post, one ? 1 : 2, count ? 1 : 0).mul(count ? 3 : 1), [...ms.map(m => likelihood(m, s, f)), post[0].weight]];
  }
  assert.equal(q.skillId, 'bayes-factors');
  if (q.title === 'Compare beta forecasters') {
    const [k, n] = pair(q.context, /exactly (\d+) successes in (\d+) trials/);
    const values = q.table.rows.map(([, distribution]) => {
      const [a, b] = pair(distribution, /Beta\((\d+), (\d+)\)/);
      return likelihood({ a, b }, k, n - k).mul(combination(n, k));
    });
    const ranked = [...values].sort((a, b) => a.number() - b.number());
    return [ranked[2].div(ranked[0]), values];
  }
  if (q.context.startsWith('BF_AB')) {
    const ab = R(q.context.match(/BF_AB = (\d+)/)[1]), bc = q.context.match(/BF_BC = (\d+)/);
    return [bc ? ab.mul(R(bc[1])) : R(1).div(ab), []];
  }
  if (q.context.includes('BF_CB')) {
    const cb = R(q.context.match(/BF_CB = ([\d.]+)/)[1]), ba = R(q.context.match(/BF_BA = ([\d.]+)/)[1]), ca = cb.mul(ba);
    return [R(1).div(ca), [ca]];
  }
  if (q.context.includes('P(A) =')) {
    const w = R(q.context.match(/P\(A\) = ([\d.]+)/)[1]), bf = R(q.context.match(/BF_AB = ([\d.]+)/)[1]);
    const prior = w.div(R(1).sub(w)), odds = prior.mul(bf);
    return [odds.div(R(1).add(odds)), [prior, odds]];
  }
  const p = R(q.context.match(/θ = ([\d.]+)/)[1]), [a, b] = pair(q.context, /Beta\((\d+), (\d+)\)/), [s, f] = pair(q.context, /sequence with (\d+) successes and (\d+) failures/);
  const point = likelihood({ p }, s, f), beta = likelihood({ a, b }, s, f);
  return [beta.div(point), [point, beta]];
}
function examReference(exam) {
  const ms = models(exam[0]), [s, f] = pair(exam[0].context, /sequence contains (\d+) successes and (\d+) failures?/);
  const extraS = exam[2].context.includes('then passes') ? 1 : 0, extraF = 1 - extraS;
  const post = posterior(ms, s, f), updated = posterior(ms, s + extraS, f + extraF), future = Number(exam[4].prompt.match(/next (\d+) toys/)[1]);
  return [
    [post[1].weight, ms.map(m => likelihood(m, s, f))],
    [marginal(post, 1, 0), [post[1].weight, likelihood(post[1], 1, 0)]],
    [updated[1].weight, post.map(m => likelihood(m, extraS, extraF))],
    [updated[1].weight, ms.map(m => likelihood(m, s + extraS, f + extraF))],
    [marginal(updated, future, 0), updated.map(m => likelihood(m, future, 0))],
  ];
}
// Parse only the arithmetic grammar used in displayed workings; never eval text.
function displayedExpression(text) {
  const tokens = text.replaceAll('×', '*').replaceAll('−', '-').replaceAll('[', '(').replaceAll(']', ')')
    .match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?|[BC()+\-*/^,]/g);
  let cursor = 0;
  function take(wanted) { assert.equal(tokens[cursor++], wanted, text); }
  function atom() {
    if (tokens[cursor] === '(') { cursor++; const value = add(); take(')'); return value; }
    if (tokens[cursor] === 'B' || tokens[cursor] === 'C') {
      const name = tokens[cursor++]; take('('); const a = Number(tokens[cursor++]); take(','); const b = Number(tokens[cursor++]); take(')');
      return name === 'B' ? betaIntegral(a, b) : combination(a, b);
    }
    const token = tokens[cursor++];
    return R(token);
  }
  function power() { let value = atom(); if (tokens[cursor] === '^') { cursor++; value = value.pow(Number(tokens[cursor++])); } return value; }
  function product() { let value = power(); while (tokens[cursor] === '*' || tokens[cursor] === '/') { const op = tokens[cursor++], rhs = power(); value = op === '*' ? value.mul(rhs) : value.div(rhs); } return value; }
  function add() { let value = product(); while (tokens[cursor] === '+' || tokens[cursor] === '-') { const op = tokens[cursor++], rhs = product(); value = op === '+' ? value.add(rhs) : value.sub(rhs); } return value; }
  const answer = add();
  assert.equal(cursor, tokens.length, text);
  return answer;
}
function verifyWorking(step, exact, label) {
  for (const expression of step.working.split('=')) {
    const calculated = displayedExpression(expression.trim()).number();
    // Displayed intermediate decimals use seven significant figures, so their
    // products and quotients can differ slightly from the unrounded result.
    assert.ok(Math.abs(calculated - exact.number()) <= 1e-6 * Math.max(Math.abs(exact.number()), 1e-12), `${label}: working ${expression} differs from ${exact.fraction()}`);
  }
}
function verify(q, expected, label) {
  assert.ok(Math.abs(q.answer - expected.number()) <= 1e-12 * Math.max(1, expected.number()), `${label}: expected ${expected.fraction()}, got ${q.answer}`);
  assert.equal(formatAnswer(q), expected.rounded(q.decimals), `${label}: exact half-up answer`);
  assert.equal(gradeAnswer(q, expected.fraction()).correct, true, `${label}: exact fraction accepted`);
  assert.equal(gradeAnswer(q, expected.rounded(q.decimals)).correct, true, `${label}: exact rounded answer accepted`);
  if (q.unit === 'probability' && expected.n > 0n && expected.n < expected.d) {
    assert.ok(Number(formatAnswer(q)) > 0 && Number(formatAnswer(q)) < 1, `${label}: precision preserves nonzero, noncertain probability`);
    assert.notEqual(gradeAnswer(q, '0').correct, true, `${label}: impossible probability rejected`);
    assert.notEqual(gradeAnswer(q, '1').correct, true, `${label}: certain probability rejected`);
  }
  const wrong = (Number(expected.rounded(q.decimals)) + 10 ** -q.decimals).toFixed(q.decimals);
  assert.notEqual(gradeAnswer(q, wrong).correct, true, `${label}: adjacent rounded answer rejected`);
}
function verifyQuestion(q, expected) {
  verify(q, expected[0], q.id);
  assert.equal(q.steps.length, expected[1].length, `${q.id}: step count`);
  q.steps.forEach((step, i) => {
    verify(step, expected[1][i], `${q.id} step ${i + 1}`);
    verifyWorking(step, expected[1][i], `${q.id} step ${i + 1}`);
  });
}

test('independent exact rational audit of every skill answer and intermediate step', () => {
  const count = Number(process.env.BAYESVILLE_AUDIT_SEEDS || 2500);
  const failures = new Map();
  for (let seed = 0; seed < count; seed++) for (const skill of skills) {
    const q = generateQuestion(skill.id, seed);
    try { verifyQuestion(q, reference(q)); }
    catch (error) {
      const key = `${q.title}: ${error.actual} != ${error.expected}`;
      if (!failures.has(key)) failures.set(key, { seed, skill: skill.id, message: error.message });
    }
  }
  assert.deepEqual([...failures.values()], []);
});

test('independent exact rational audit of all linked exam answers and steps', () => {
  const count = Number(process.env.BAYESVILLE_AUDIT_SEEDS || 2500);
  for (let seed = 0; seed < count; seed++) {
    const exam = generateExam(seed), expected = examReference(exam);
    exam.forEach((q, i) => verifyQuestion(q, expected[i]));
  }
});

test('beta-binomial rounding agrees with exact factorial ratios throughout generated parameter range', async () => {
  const { betaCount } = await import('../site/math.js');
  for (let a = 1; a <= 15; a++) for (let b = 1; b <= 15; b++) {
    for (let n = 0; n <= 6; n++) for (let k = 0; k <= n; k++) {
      const exact = likelihood({ a, b }, k, n - k).mul(combination(n, k));
      const answer = betaCount(a, b, n, k);
      verify({ answer, decimals: answer > 0 && answer < 0.01 ? 4 : 2 }, exact, `Beta(${a},${b}), ${k}/${n}`);
    }
  }
});


test('known rounding-boundary seeds accept exact fractions and half-up answers', () => {
  for (const [seed, fraction, rounded] of [[117, '105/8', '13.13'], [4581, '49/40', '1.23'], [6638, '25/8', '3.13']]) {
    const q = generateQuestion('bayes-factors', seed);
    assert.equal(formatAnswer(q), rounded);
    assert.equal(gradeAnswer(q, fraction).correct, true);
    assert.equal(gradeAnswer(q, rounded).correct, true);
  }
  const tinyStep = generateQuestion('sequences', 76).steps[0];
  assert.equal(tinyStep.decimals, 6);
  assert.equal(formatAnswer(tinyStep), '0.000013');
  assert.equal(gradeAnswer(tinyStep, '0').correct, false);
});

test('rounding noise guard does not accept materially below-half inputs', () => {
  for (const [value, decimals, expected] of [[.1249999999, 2, .12], [13.12499999, 2, 13.12], [.00001249999, 6, .000012], [.9999499999, 4, .9999]]) {
    assert.equal(roundTo(value, decimals), expected);
  }
});

test('every possible beta forecaster pair rounds its evidence ratio correctly', async () => {
  const { betaCount } = await import('../site/math.js');
  const priors = Array.from({ length: 36 }, (_, i) => ({ a: 1 + Math.floor(i / 6), b: 1 + i % 6 }));
  for (let n = 3; n <= 6; n++) for (let k = 1; k < n; k++) {
    const values = priors.map(model => ({
      ...model, exact: likelihood(model, k, n - k).mul(combination(n, k)),
      actual: betaCount(model.a, model.b, n, k),
    }));
    for (const first of values) for (const second of values) {
      const exact = first.exact.div(second.exact);
      if (exact.n < exact.d) continue;
      verify({ answer: first.actual / second.actual, decimals: 2, unit: 'ratio' }, exact,
        `Beta(${first.a},${first.b}) vs Beta(${second.a},${second.b}), ${k}/${n}`);
    }
  }
});
