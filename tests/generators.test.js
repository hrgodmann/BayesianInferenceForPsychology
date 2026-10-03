import test from 'node:test';
import assert from 'node:assert/strict';
import { GENERATOR_VERSION, skills, difficulties, generateQuestion, generateExam } from '../site/questions.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-11, `${actual} != ${expected}`);
function inspect(question) {
  assert.equal(typeof question.id, 'string');
  assert.ok(Number.isInteger(question.seed) && question.seed >= 0 && question.seed <= 0xffffffff);
  assert.ok(skills.some(skill => skill.id === question.skillId));
  assert.ok(difficulties.some(level => level.id === question.difficulty));
  for (const field of ['title', 'context', 'prompt', 'explanation']) assert.ok(question[field]?.trim(), field);
  assert.ok(Number.isFinite(question.answer));
  assert.ok(question.answer >= 0);
  if (question.unit === 'probability') assert.ok(question.answer <= 1);
  assert.ok(['probability', 'ratio', 'number'].includes(question.unit));
  assert.ok([2, 4].includes(question.decimals));
  assert.equal(question.hints.length, 2);
  assert.ok(question.hints.every(hint => typeof hint === 'string' && hint.length > 15));
  assert.ok(question.steps.length <= 3);
  for (const step of question.steps) {
    assert.ok(Number.isFinite(step.answer) && step.answer >= 0);
    if (step.unit === 'probability') assert.ok(step.answer <= 1);
    for (const field of ['prompt', 'formula', 'working']) assert.ok(step[field]?.trim(), field);
    assert.ok(/[0-9]/.test(step.working));
  }
  assert.ok(question.source.label && question.source.chapters);
  assert.ok(/[0-9]/.test(question.explanation), 'worked answer substitutes numbers');
  assert.equal(question.type, undefined, 'no true/false questions');
  if (question.table) {
    assert.ok(question.table.headers.length > 0);
    assert.ok(question.table.rows.length > 0);
    assert.ok(question.table.rows.every(row => row.length === question.table.headers.length));
  }
}
function parseModels(question) {
  return question.table.rows.map(([name, weight, distribution]) => {
    const beta = distribution.match(/Beta\((\d+), (\d+)\)/);
    return beta ? { name, weight: Number(weight), a: Number(beta[1]), b: Number(beta[2]) } : { name, weight: Number(weight), p: Number(distribution.match(/probability ([\d.]+)/)[1]) };
  });
}
// Independent sequential expansion: no shared beta-function implementation.
function sequence(model, successes, failures) {
  if ('p' in model) return model.p ** successes * (1 - model.p) ** failures;
  let probability = 1;
  for (let i = 0; i < successes; i++) probability *= (model.a + i) / (model.a + model.b + i);
  for (let j = 0; j < failures; j++) probability *= (model.b + j) / (model.a + model.b + successes + j);
  return probability;
}
function posterior(models, s, f) {
  const raw = models.map(model => model.weight * sequence(model, s, f));
  const sum = raw.reduce((a, b) => a + b);
  return models.map((model, i) => ({ ...model, weight: raw[i] / sum, ...('a' in model ? { a: model.a + s, b: model.b + f } : {}) }));
}
function predict(models, s, f) { return models.reduce((sum, model) => sum + model.weight * sequence(model, s, f), 0); }

test('seven assessed skill areas and three levels generate complete finite numerical questions', () => {
  assert.equal(GENERATOR_VERSION, 2);
  assert.equal(skills.length, 7);
  assert.equal(difficulties.length, 3);
  const ids = new Set();
  for (const skill of skills) for (const difficulty of difficulties) for (let seed = 0; seed < 160; seed++) {
    const q = generateQuestion(skill.id, seed, difficulty.id);
    inspect(q);
    assert.ok(!ids.has(q.id)); ids.add(q.id);
    assert.deepEqual(generateQuestion(skill.id, seed, difficulty.id), q);
  }
});

test('seed boundaries are reproducible and invalid inputs are rejected', () => {
  for (const skill of skills) for (const seed of [0, 1, 0x80000000, 0xffffffff]) inspect(generateQuestion(skill.id, seed));
  for (const seed of [-1, 1.5, NaN, Infinity, 0x100000000, '12']) assert.throws(() => generateQuestion('bayes', seed), RangeError);
  assert.throws(() => generateQuestion('chapter-3', 1), RangeError);
  assert.throws(() => generateQuestion('bayes', 1, 'impossible'), RangeError);
});

test('total probability and backwards missing-rate questions agree with table arithmetic', () => {
  for (let seed = 0; seed < 80; seed++) for (const difficulty of difficulties) {
    const q = generateQuestion('probability', seed, difficulty.id);
    const rows = q.table.rows;
    const total = rows.reduce((sum, row) => sum + Number(row[1]) * (row[2] === '?' ? q.answer : Number(row[2])), 0);
    if (difficulty.id === 'challenge') near(total, Number(q.prompt.match(/probability is ([\d.]+)/)[1].replace(/\.$/, '')));
    else near(q.answer, total);
  }
});

test('sequence, count, and tail answers agree with enumeration of ordered outcomes', () => {
  for (let seed = 0; seed < 60; seed++) for (const difficulty of difficulties) {
    const q = generateQuestion('sequences', seed, difficulty.id);
    const p = Number(q.context.match(/probability ([\d.]+)/)[1]);
    if (difficulty.id === 'foundation') {
      const tokens = q.prompt.split(': ')[1].match(/[SF]/g);
      near(q.answer, p ** tokens.filter(x => x === 'S').length * (1 - p) ** tokens.filter(x => x === 'F').length);
    } else {
      const n = Number(q.prompt.match(/in (\d+) trials/)[1]);
      const k = difficulty.id === 'practice' ? Number(q.prompt.match(/exactly (\d+)/)[1]) : 2;
      let sum = 0;
      for (let bits = 0; bits < 2 ** n; bits++) {
        const successes = bits.toString(2).replaceAll('0', '').length;
        if (difficulty.id === 'practice' ? successes === k : successes >= k) sum += p ** successes * (1 - p) ** (n - successes);
      }
      near(q.answer, sum);
    }
  }
});

test('joint prediction updates both shared model identity and uncertain rate', () => {
  let distinguishesNaiveSquaring = false;
  for (let seed = 0; seed < 100; seed++) for (const difficulty of difficulties) {
    const q = generateQuestion('prediction', seed, difficulty.id);
    const [, s, failures] = q.context.match(/sequence with (\d+) successes and (\d+) failures/).map(Number);
    const post = posterior(parseModels(q), s, failures);
    const expected = difficulty.id === 'foundation' ? predict(post, 1, 0) : difficulty.id === 'practice' ? predict(post, 2, 0) : 3 * predict(post, 2, 1);
    near(q.answer, expected);
    if (difficulty.id === 'practice' && Math.abs(expected - predict(post, 1, 0) ** 2) > 0.001) distinguishesNaiveSquaring = true;
  }
  assert.ok(distinguishesNaiveSquaring);
});

test('linked exams are independently reproducible and all five answers stay consistent', () => {
  for (let seed = 0; seed < 100; seed++) for (const difficulty of difficulties) {
    const exam = generateExam(seed, difficulty.id);
    assert.deepEqual(generateExam(seed, difficulty.id), exam);
    assert.equal(exam.length, 5);
    assert.equal(new Set(exam.map(q => q.id)).size, 5);
    exam.forEach(inspect);
    const [, s, failures] = exam[0].context.match(/sequence contains (\d+) successes and (\d+) failures/).map(Number);
    const models = parseModels(exam[0]), post = posterior(models, s, failures);
    assert.equal(models.length, difficulty.id === 'foundation' ? 2 : 3);
    assert.ok('a' in models[1]);
    if (difficulty.id !== 'foundation') {
      assert.notEqual(models[0].p, models[2].p);
      assert.equal(exam[4].steps.length, 3);
      assert.match(exam[4].explanation, /Meadow workshop/);
    }
    assert.match(exam[4].explanation, /\(\d+\/\d+\) × \(\d+\/\d+\)/);
    const extraS = difficulty.id === 'challenge' ? 0 : 1;
    const updated = posterior(models, s + extraS, failures + 1 - extraS);
    near(exam[0].answer, post[1].weight);
    near(exam[1].answer, predict(post, 1, 0));
    near(exam[2].answer, updated[1].weight);
    near(exam[3].answer, sequence(updated[1], 1, 0));
    near(exam[4].answer, predict(updated, difficulty.id === 'challenge' ? 3 : 2, 0));
    assert.ok(!exam.some(q => q.id === generateQuestion('prediction', seed, difficulty.id).id));
  }
});

test('Bayes reversal and prior mixtures normalize and average the stated models', () => {
  for (let seed = 0; seed < 80; seed++) for (const difficulty of difficulties) {
    const q = generateQuestion('bayes', seed, difficulty.id);
    const failures = q.prompt.includes('failed inspection') ? 1 : 0;
    const successes = failures ? 0 : q.prompt.includes('two passed') ? 2 : 1;
    near(q.answer, posterior(parseModels(q), successes, failures)[0].weight);
    const mixture = generateQuestion('mixtures', seed, difficulty.id);
    const [, k, n] = mixture.prompt.match(/exactly (\d+) of the first (\d+)/).map(Number);
    let combination = 1;
    for (let i = 1; i <= k; i++) combination *= (n - k + i) / i;
    near(mixture.answer, combination * predict(parseModels(mixture), k, n - k));
  }
});

test('beta exercises use updated parameters and integrate the shared unknown rate', () => {
  let sawLaplaceAllSuccess = false;
  const posteriorParameters = new Set();
  for (let seed = 0; seed < 160; seed++) for (const difficulty of difficulties) {
    const q = generateQuestion('beta', seed, difficulty.id);
    if (difficulty.id === 'foundation') {
      const [, a, b] = q.context.match(/Beta\((\d+), (\d+)\)/).map(Number);
      const [, observed, n] = q.prompt.match(/(\d+) of (\d+) seeds/).map(Number);
      const successParameter = q.prompt.includes('first parameter');
      posteriorParameters.add(successParameter ? 'a' : 'b');
      near(q.answer, (successParameter ? a : b) + n - observed);
    } else if (q.title.includes('Laplace')) {
      const [, s, failures] = q.prompt.match(/(\d+) successes and (\d+) failures/).map(Number);
      near(q.answer, (s + 1) / (s + failures + 2));
      if (failures === 0) sawLaplaceAllSuccess = true;
    } else {
      const [, a, b] = q.context.match(/Beta\((\d+), (\d+)\)/).map(Number);
      const history = q.context.match(/observed (\d+) successes and (\d+) failures/);
      const model = { a: a + (history ? Number(history[1]) : 0), b: b + (history ? Number(history[2]) : 0) };
      const [, k, n] = q.prompt.match(/exactly (\d+) successes in the next (\d+)/).map(Number);
      let probability = 0;
      for (let bits = 0; bits < 2 ** n; bits++) if (bits.toString(2).replaceAll('0', '').length === k) probability += sequence(model, k, n - k);
      near(q.answer, probability);
    }
  }
  assert.ok(sawLaplaceAllSuccess);
  assert.deepEqual([...posteriorParameters].sort(), ['a', 'b']);
});

test('Bayes factor orientation and probability-to-odds conversions are consistent', () => {
  const practiceVariants = new Set();
  for (let seed = 0; seed < 100; seed++) for (const difficulty of difficulties) {
    const q = generateQuestion('bayes-factors', seed, difficulty.id);
    if (difficulty.id === 'foundation') {
      const first = Number(q.context.match(/BF_AB = (\d+)/)[1]);
      const second = q.context.match(/BF_BC = (\d+)/);
      near(q.answer, second ? first * Number(second[1]) : 1 / first);
    } else if (difficulty.id === 'practice') {
      if (q.context.includes('BF_CB')) {
        const cb = Number(q.context.match(/BF_CB = ([\d.]+)/)[1]);
        const ba = Number(q.context.match(/BF_BA = ([\d.]+)/)[1].replace(/\.$/, ''));
        near(q.answer, 1 / (cb * ba));
        practiceVariants.add('inversion-and-transitivity');
      } else {
        const prior = Number(q.context.match(/P\(A\) = ([\d.]+)/)[1]);
        const bf = Number(q.context.match(/BF_AB = ([\d.]+)/)[1].replace(/\.$/, ''));
        near(q.answer, prior * bf / (prior * bf + 1 - prior));
        practiceVariants.add('odds');
      }
    } else {
      const p = Number(q.context.match(/θ = ([\d.]+)/)[1].replace(/\.$/, ''));
      const [, a, b] = q.context.match(/Beta\((\d+), (\d+)\)/).map(Number);
      const [, s, failures] = q.context.match(/sequence with (\d+) successes and (\d+) failures/).map(Number);
      near(q.answer, sequence({ a, b }, s, failures) / sequence({ p }, s, failures));
    }
  }
  assert.equal(practiceVariants.size, 2);
});
