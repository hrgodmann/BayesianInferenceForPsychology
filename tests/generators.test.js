import test from 'node:test';
import assert from 'node:assert/strict';
import { GENERATOR_VERSION, skills, generateQuestion, generateExam } from '../site/questions.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-11, `${actual} != ${expected}`);
function inspect(question) {
  assert.equal(typeof question.id, 'string');
  assert.ok(Number.isInteger(question.seed) && question.seed >= 0 && question.seed <= 0xffffffff);
  assert.ok(skills.some(skill => skill.id === question.skillId));
  assert.equal(question.difficulty, undefined, 'one practice stream has no difficulty metadata');
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

test('seven assessed skills generate complete, varied numerical questions in one stream', () => {
  assert.equal(GENERATOR_VERSION, 3);
  assert.equal(skills.length, 7);
  const ids = new Set();
  for (const skill of skills) for (let seed = 0; seed < 480; seed++) {
    const q = generateQuestion(skill.id, seed);
    inspect(q);
    assert.ok(!ids.has(q.id)); ids.add(q.id);
    assert.deepEqual(generateQuestion(skill.id, seed), q);
  }
});

test('seed boundaries are reproducible and invalid inputs are rejected', () => {
  for (const skill of skills) for (const seed of [0, 1, 0x80000000, 0xffffffff]) inspect(generateQuestion(skill.id, seed));
  for (const seed of [-1, 1.5, NaN, Infinity, 0x100000000, '12']) {
    assert.throws(() => generateQuestion('bayes', seed), RangeError);
    assert.throws(() => generateExam(seed), RangeError);
  }
  assert.throws(() => generateQuestion('chapter-3', 1), RangeError);
});

test('total probability and missing-rate variants agree with table arithmetic', () => {
  const variants = new Set();
  for (let seed = 0; seed < 240; seed++) {
    const q = generateQuestion('probability', seed);
    const rows = q.table.rows;
    const backwards = rows.some(row => row[2] === '?');
    variants.add(backwards ? 'missing' : `total-${rows.length}`);
    const total = rows.reduce((sum, row) => sum + Number(row[1]) * (row[2] === '?' ? q.answer : Number(row[2])), 0);
    if (backwards) near(total, Number(q.prompt.match(/probability is ([\d.]+)/)[1].replace(/\.$/, '')));
    else near(q.answer, total);
  }
  assert.deepEqual([...variants].sort(), ['missing', 'total-2', 'total-3']);
});

test('sequence, count, and tail variants agree with enumeration of ordered outcomes', () => {
  const variants = new Set();
  for (let seed = 0; seed < 240; seed++) {
    const q = generateQuestion('sequences', seed);
    const p = Number(q.context.match(/probability ([\d.]+)/)[1]);
    const ordered = q.prompt.includes('ordered sequence');
    const tail = q.prompt.includes('at least');
    variants.add(ordered ? 'sequence' : tail ? 'tail' : 'count');
    if (ordered) {
      const tokens = q.prompt.split(': ')[1].match(/[SF]/g);
      near(q.answer, p ** tokens.filter(x => x === 'S').length * (1 - p) ** tokens.filter(x => x === 'F').length);
    } else {
      const n = Number(q.prompt.match(/in (\d+) trials/)[1]);
      const k = tail ? 2 : Number(q.prompt.match(/exactly (\d+)/)[1]);
      let sum = 0;
      for (let bits = 0; bits < 2 ** n; bits++) {
        const successes = bits.toString(2).replaceAll('0', '').length;
        if (tail ? successes >= k : successes === k) sum += p ** successes * (1 - p) ** (n - successes);
      }
      near(q.answer, sum);
    }
  }
  assert.deepEqual([...variants].sort(), ['count', 'sequence', 'tail']);
});

test('joint prediction updates both shared model identity and uncertain rate', () => {
  let distinguishesNaiveSquaring = false;
  const variants = new Set();
  for (let seed = 0; seed < 300; seed++) {
    const q = generateQuestion('prediction', seed);
    const [, s, failures] = q.context.match(/sequence with (\d+) successes and (\d+) failures/).map(Number);
    const models = parseModels(q), post = posterior(models, s, failures);
    const count = q.prompt.includes('exactly two');
    const one = q.prompt.includes('next trial succeeds');
    variants.add(`${'a' in models[1] ? 'beta' : 'fixed'}-${count ? 'count' : one ? 'one' : 'joint'}`);
    const expected = one ? predict(post, 1, 0) : count ? 3 * predict(post, 2, 1) : predict(post, 2, 0);
    near(q.answer, expected);
    if (!one && !count && Math.abs(expected - predict(post, 1, 0) ** 2) > 0.001) distinguishesNaiveSquaring = true;
  }
  assert.ok(distinguishesNaiveSquaring);
  assert.equal(variants.size, 6);
});

test('linked three-model exams are reproducible and all five answers stay consistent', () => {
  const variants = new Set();
  for (let seed = 0; seed < 300; seed++) {
    const exam = generateExam(seed);
    assert.deepEqual(generateExam(seed), exam);
    assert.equal(exam.length, 5);
    assert.equal(new Set(exam.map(q => q.id)).size, 5);
    exam.forEach(inspect);
    const [, s, failures] = exam[0].context.match(/sequence contains (\d+) successes and (\d+) failures?/).map(Number);
    const models = parseModels(exam[0]), post = posterior(models, s, failures);
    assert.equal(models.length, 3);
    assert.ok('a' in models[1]);
    assert.notEqual(models[0].p, models[2].p);
    assert.equal(exam[4].steps.length, 3);
    assert.match(exam[4].explanation, /Meadow workshop/);
    assert.match(exam[4].explanation, /\(\d+\/\d+\) × \(\d+\/\d+\)/);
    const extraS = exam[2].context.includes('additional toy then passes') ? 1 : 0;
    const future = Number(exam[4].prompt.match(/next (\d+) toys/)[1]);
    variants.add(`${extraS}-${future}`);
    const updated = posterior(models, s + extraS, failures + 1 - extraS);
    near(exam[0].answer, post[1].weight);
    near(exam[1].answer, predict(post, 1, 0));
    near(exam[2].answer, updated[1].weight);
    near(exam[3].answer, sequence(updated[1], 1, 0));
    near(exam[4].answer, predict(updated, future, 0));
    assert.ok(!exam.some(q => q.id === generateQuestion('prediction', seed).id));
  }
  assert.deepEqual([...variants].sort(), ['0-2', '0-3', '1-2', '1-3']);
});

test('Bayes reversal and prior mixtures normalize and average the stated models', () => {
  const bayesVariants = new Set(), mixtureVariants = new Set();
  for (let seed = 0; seed < 300; seed++) {
    const q = generateQuestion('bayes', seed);
    const failures = q.prompt.includes('failed inspection') ? 1 : 0;
    const successes = failures ? 0 : q.prompt.includes('two passed') ? 2 : 1;
    const bayesModels = parseModels(q);
    bayesVariants.add(`${bayesModels.length}-${successes}-${failures}`);
    near(q.answer, posterior(bayesModels, successes, failures)[0].weight);
    const mixture = generateQuestion('mixtures', seed);
    const [, k, n] = mixture.prompt.match(/exactly (\d+) of the first (\d+)/).map(Number);
    let combination = 1;
    for (let i = 1; i <= k; i++) combination *= (n - k + i) / i;
    const mixtureModels = parseModels(mixture);
    mixtureVariants.add(mixtureModels.length === 3 ? 'three' : mixtureModels[0].p === 1 ? 'spike' : 'two');
    near(mixture.answer, combination * predict(mixtureModels, k, n - k));
  }
  assert.equal(bayesVariants.size, 6);
  assert.deepEqual([...mixtureVariants].sort(), ['spike', 'three', 'two']);
});

test('beta variants update parameters and integrate the shared unknown rate', () => {
  const variants = new Set();
  for (let seed = 0; seed < 480; seed++) {
    const q = generateQuestion('beta', seed);
    if (q.title === 'Update a beta distribution') {
      const [, a, b] = q.context.match(/Beta\((\d+), (\d+)\)/).map(Number);
      const [, observed, n] = q.prompt.match(/(\d+) of (\d+) seeds/).map(Number);
      const successParameter = q.prompt.includes('first parameter');
      variants.add(successParameter ? 'update-a' : 'update-b');
      near(q.answer, (successParameter ? a : b) + n - observed);
    } else if (q.title.includes('Laplace')) {
      const [, s, failures] = q.prompt.match(/(\d+) successes and (\d+) failures/).map(Number);
      near(q.answer, (s + 1) / (s + failures + 2));
      variants.add(failures === 0 ? 'laplace-all' : 'laplace-mixed');
    } else {
      const [, a, b] = q.context.match(/Beta\((\d+), (\d+)\)/).map(Number);
      const history = q.context.match(/observed (\d+) successes and (\d+) failures/);
      variants.add(history ? 'posterior' : 'prior');
      const model = { a: a + (history ? Number(history[1]) : 0), b: b + (history ? Number(history[2]) : 0) };
      const [, k, n] = q.prompt.match(/exactly (\d+) successes in the next (\d+)/).map(Number);
      let probability = 0;
      for (let bits = 0; bits < 2 ** n; bits++) if (bits.toString(2).replaceAll('0', '').length === k) probability += sequence(model, k, n - k);
      near(q.answer, probability);
    }
  }
  assert.deepEqual([...variants].sort(), ['laplace-all', 'laplace-mixed', 'posterior', 'prior', 'update-a', 'update-b']);
});

test('Bayes factor orientation and probability-to-odds conversions are consistent', () => {
  const variants = new Set();
  for (let seed = 0; seed < 400; seed++) {
    const q = generateQuestion('bayes-factors', seed);
    if (q.context.startsWith('BF_AB')) {
      const first = Number(q.context.match(/BF_AB = (\d+)/)[1]);
      const second = q.context.match(/BF_BC = (\d+)/);
      variants.add(second ? 'transitivity' : 'reciprocal');
      near(q.answer, second ? first * Number(second[1]) : 1 / first);
    } else if (q.context.includes('BF_CB')) {
      const cb = Number(q.context.match(/BF_CB = ([\d.]+)/)[1]);
      const ba = Number(q.context.match(/BF_BA = ([\d.]+)/)[1].replace(/\.$/, ''));
      near(q.answer, 1 / (cb * ba));
      variants.add('both');
    } else if (q.context.includes('P(A) =')) {
      const prior = Number(q.context.match(/P\(A\) = ([\d.]+)/)[1]);
      const bf = Number(q.context.match(/BF_AB = ([\d.]+)/)[1].replace(/\.$/, ''));
      near(q.answer, prior * bf / (prior * bf + 1 - prior));
      variants.add('odds');
    } else {
      const p = Number(q.context.match(/θ = ([\d.]+)/)[1].replace(/\.$/, ''));
      const [, a, b] = q.context.match(/Beta\((\d+), (\d+)\)/).map(Number);
      const [, s, failures] = q.context.match(/sequence with (\d+) successes and (\d+) failures/).map(Number);
      near(q.answer, sequence({ a, b }, s, failures) / sequence({ p }, s, failures));
      variants.add('marginal');
    }
  }
  assert.deepEqual([...variants].sort(), ['both', 'marginal', 'odds', 'reciprocal', 'transitivity']);
});
