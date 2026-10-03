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
  assert.ok([2, 4, 6, 8].includes(question.decimals));
  assert.equal(question.hints.length, 2);
  assert.ok(question.hints.every(hint => typeof hint === 'string' && hint.length > 15));
  assert.ok(question.steps.length <= 9);
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
function lawData(q) {
  const [, s, f] = q.context.match(/sequence D with (\d+) successes and (\d+) failures?/).map(Number);
  const [, a, b] = q.table.rows[1].at(-1).match(/Beta\((\d+), (\d+)\)/).map(Number);
  const beta = sequence({ a, b }, s, f), law = f ? 0 : 1;
  return { s, f, a, b, beta, law, bf: law / beta };
}
function batchData(q) {
  const ms = q.table.rows.map(([, prior]) => {
    const [, a, b] = prior.match(/Beta\((\d+), (\d+)\)/).map(Number);
    return { a, b };
  });
  const counts = name => {
    const tokens = q.context.match(new RegExp(`${name} = \\(([^)]+)\\)`))[1].split(', ');
    assert.ok(tokens.every(token => ['S', 'F'].includes(token)));
    return [tokens.filter(token => token === 'S').length, tokens.filter(token => token === 'F').length];
  };
  const [s1, f1] = counts('D1'), [s2, f2] = counts('D2');
  const firstBF = sequence(ms[0], s1, f1) / sequence(ms[1], s1, f1);
  const updated = ms.map(m => ({ a: m.a + s1, b: m.b + f1 }));
  const secondBF = sequence(updated[0], s2, f2) / sequence(updated[1], s2, f2);
  const jointBF = sequence(ms[0], s1 + s2, f1 + f2) / sequence(ms[1], s1 + s2, f1 + f2);
  return { ms, s1, f1, s2, f2, firstBF, secondBF, jointBF };
}


test('seven assessed skills generate complete, varied numerical questions in one stream', () => {
  assert.equal(GENERATOR_VERSION, 5);
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

test('probability rules agree with valid event and table arithmetic', () => {
  const variants = new Set();
  for (let seed = 0; seed < 240; seed++) {
    const q = generateQuestion('probability', seed);
    const rows = q.table.rows;
    if (q.title === 'Condition on a group') {
      const [[, both, artOnly], [, musicOnly, neither]] = rows;
      assert.ok([both, artOnly, musicOnly, neither].every(n => Number.isInteger(n) && n >= 0));
      assert.equal(both + artOnly + musicOnly + neither, 100);
      const givenMusic = q.prompt.includes('visitor attended music,');
      const denominator = both + (givenMusic ? musicOnly : artOnly);
      near(q.answer, both / denominator);
      variants.add(givenMusic ? 'conditional-music' : 'conditional-art');
      continue;
    }
    if (q.title === 'Allow for overlapping events') {
      const [a, b, overlap] = rows.map(row => Number(row[1]));
      assert.ok(overlap >= Math.max(0, a + b - 1) - 1e-12 && overlap <= Math.min(a, b));
      near(q.answer, a + b - overlap);
      variants.add('union');
      continue;
    }
    const backwards = rows.some(row => row[2] === '?');
    variants.add(backwards ? 'missing' : `total-${rows.length}`);
    const total = rows.reduce((sum, row) => sum + Number(row[1]) * (row[2] === '?' ? q.answer : Number(row[2])), 0);
    if (backwards) near(total, Number(q.prompt.match(/probability is ([\d.]+)/)[1].replace(/\.$/, '')));
    else near(q.answer, total);
  }
  assert.deepEqual([...variants].sort(), ['conditional-art', 'conditional-music', 'missing', 'total-2', 'total-3', 'union']);
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
    if (q.title === 'Learn from several beta forecasters') {
      assert.ok(models.every(m => 'a' in m));
      assert.equal(new Set(models.map(m => `${m.a},${m.b}`)).size, models.length);
      near(q.answer, predict(post, 1, 0));
      post.forEach((m, i) => {
        near(q.steps[models.length + i].answer, m.weight);
        near(q.steps[2 * models.length + i].answer, m.a / (m.a + m.b));
      });
      variants.add(`all-beta-${models.length}`);
      continue;
    }
    const count = q.prompt.includes('exactly two');
    const one = q.prompt.includes('next trial succeeds');
    variants.add(`${'a' in models[1] ? 'beta' : 'fixed'}-${count ? 'count' : one ? 'one' : 'joint'}`);
    const expected = one ? predict(post, 1, 0) : count ? 3 * predict(post, 2, 1) : predict(post, 2, 0);
    near(q.answer, expected);
    if (!one && !count && Math.abs(expected - predict(post, 1, 0) ** 2) > 0.001) distinguishesNaiveSquaring = true;
  }
  assert.ok(distinguishesNaiveSquaring);
  assert.equal(variants.size, 8);
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
    near(exam[3].answer, updated[1].weight);
    assert.equal(exam[3].answer, exam[2].answer);
    assert.match(exam[3].context, /corrected order/);
    const corrected = exam[3].context.match(/corrected order is \(([^)]+)\)/)[1].split(', ');
    assert.equal(corrected.filter(x => x === 'S').length, s + extraS);
    assert.equal(corrected.filter(x => x === 'F').length, failures + 1 - extraS);
    near(exam[4].answer, predict(updated, future, 0));
    assert.ok(!exam.some(q => q.id === generateQuestion('prediction', seed).id));
  }
  assert.deepEqual([...variants].sort(), ['0-2', '0-3', '1-2', '1-3']);
});

test('Bayes reversal and prior mixtures normalize and average the stated models', () => {
  const bayesVariants = new Set(), mixtureVariants = new Set();
  for (let seed = 0; seed < 300; seed++) {
    const q = generateQuestion('bayes', seed);
    if (q.title === 'Posterior probability of a general law') {
      const { s, f } = lawData(q);
      near(q.answer, posterior(parseModels(q), s, f)[0].weight);
      bayesVariants.add('law');
    } else {
      const failures = q.prompt.includes('failed inspection') ? 1 : 0;
      const successes = q.prompt.includes('followed by') ? 1 : failures ? 0 : q.prompt.includes('two passed') ? 2 : 1;
      const bayesModels = parseModels(q);
      bayesVariants.add(`${bayesModels.length}-${successes}-${failures}`);
      near(q.answer, posterior(bayesModels, successes, failures)[0].weight);
    }
    const mixture = generateQuestion('mixtures', seed);
    const [, k, n] = mixture.prompt.match(/exactly (\d+) of the first (\d+)/).map(Number);
    let combination = 1;
    for (let i = 1; i <= k; i++) combination *= (n - k + i) / i;
    const mixtureModels = parseModels(mixture);
    mixtureVariants.add(mixtureModels.length === 3 ? 'three' : mixtureModels[0].p === 1 ? 'spike' : 'two');
    near(mixture.answer, combination * predict(mixtureModels, k, n - k));
  }
  assert.equal(bayesVariants.size, 9);
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
    } else if (q.title === 'Estimate the success rate') {
      const [, a, b] = q.context.match(/Beta\((\d+), (\d+)\)/).map(Number);
      const [, s, f] = q.context.match(/observed (\d+) successes and (\d+) failures/).map(Number);
      near(q.answer, (a + s) / (a + b + s + f));
      variants.add('posterior-mean');
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
  assert.deepEqual([...variants].sort(), ['laplace-all', 'laplace-mixed', 'posterior', 'posterior-mean', 'prior', 'update-a', 'update-b']);
});

test('Bayes factor orientation and probability-to-odds conversions are consistent', () => {
  const variants = new Set();
  for (let seed = 0; seed < 400; seed++) {
    const q = generateQuestion('bayes-factors', seed);
    if (q.title === 'Evidence for a general law') {
      near(q.answer, lawData(q).bf);
      variants.add('law');
    } else if (q.title === 'Evidence from a second batch' || q.title === 'Combine evidence across two batches') {
      const { firstBF, secondBF, jointBF } = batchData(q);
      near(firstBF * secondBF, jointBF);
      const total = q.title.startsWith('Combine');
      near(q.answer, total ? jointBF : secondBF);
      variants.add(total ? 'sequential-total' : 'sequential');
    } else if (q.context.startsWith('BF_AB')) {
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
    } else if (q.title === 'Compare beta forecasters') {
      const [, k, n] = q.context.match(/exactly (\d+) successes in (\d+) trials/).map(Number);
      const predictions = q.table.rows.map(([, prior]) => {
        const [, a, b] = prior.match(/Beta\((\d+), (\d+)\)/).map(Number);
        return sequence({ a, b }, k, n - k);
      });
      near(q.answer, Math.max(...predictions) / Math.min(...predictions));
      assert.equal(new Set(predictions.map(p => p.toFixed(12))).size, 3, 'best and worst are unambiguous');
      variants.add('forecasters');
    } else {
      const p = Number(q.context.match(/θ = ([\d.]+)/)[1].replace(/\.$/, ''));
      const [, a, b] = q.context.match(/Beta\((\d+), (\d+)\)/).map(Number);
      const [, s, failures] = q.context.match(/sequence with (\d+) successes and (\d+) failures/).map(Number);
      near(q.answer, sequence({ a, b }, s, failures) / sequence({ p }, s, failures));
      variants.add('marginal');
    }
  }
  assert.deepEqual([...variants].sort(), ['both', 'forecasters', 'law', 'marginal', 'odds', 'reciprocal', 'sequential', 'sequential-total', 'transitivity']);
});

test('general-law questions include uniform alternatives, unequal odds, and exact zero after an exception', () => {
  const coverage = new Set();
  let distinguishesLawFromNextSuccess = false;
  for (let seed = 0; seed < 1200; seed++) for (const skill of ['bayes', 'bayes-factors']) {
    const q = generateQuestion(skill, seed);
    if (!q.title.includes('general law')) continue;
    const { s, f, a, b, beta, bf } = lawData(q);
    const uniform = a === 1 && b === 1;
    coverage.add(`${skill}-${f ? 'exception' : uniform ? 'uniform' : 'beta'}`);
    if (f) {
      assert.equal(q.answer, 0, 'an error-free law cannot generate an exception');
      assert.ok(beta > 0, 'the alternative still predicts these data');
    } else if (uniform) near(bf, s + 1);
    if (skill === 'bayes') {
      const prior = Number(q.table.rows[0][1]);
      const odds = prior / (1 - prior) * bf;
      near(q.answer, odds / (1 + odds));
      near(q.steps.at(-1).answer, odds);
      coverage.add(prior === .5 ? 'equal-priors' : 'unequal-priors');
      const betaMean = (a + s) / (a + b + s + f);
      const next = q.answer + (1 - q.answer) * betaMean;
      if (!f && Math.abs(next - q.answer) > .01) distinguishesLawFromNextSuccess = true;
      if (uniform && !f && prior === .5) near(q.answer, (s + 1) / (s + 2));
    }
  }
  assert.deepEqual([...coverage].sort(), ['bayes-beta', 'bayes-exception', 'bayes-factors-beta', 'bayes-factors-exception', 'bayes-factors-uniform', 'bayes-uniform', 'equal-priors', 'unequal-priors']);
  assert.ok(distinguishesLawFromNextSuccess);
});

test('sequential evidence predicts new batches after learning and obeys the chain identity', () => {
  const coverage = new Set();
  let separatesFreshPriorError = false, separatesIncrementFromTotal = false;
  for (let seed = 0; seed < 1200; seed++) {
    const q = generateQuestion('bayes-factors', seed);
    if (!['Evidence from a second batch', 'Combine evidence across two batches'].includes(q.title)) continue;
    const { ms, s2, f2, firstBF, secondBF, jointBF } = batchData(q);
    const total = q.title.startsWith('Combine');
    near(q.answer, total ? jointBF : secondBF);
    near(firstBF * secondBF, jointBF);
    assert.ok(q.answer > 0 && Number.isFinite(q.answer));
    coverage.add(total ? 'total' : 'additional');
    coverage.add(q.answer < 1 ? 'favors-B' : q.answer > 1 ? 'favors-A' : 'neutral');
    const freshPriorBF = sequence(ms[0], s2, f2) / sequence(ms[1], s2, f2);
    if (Math.abs(secondBF - freshPriorBF) > .05) separatesFreshPriorError = true;
    if (Math.abs(secondBF - jointBF) > .05) separatesIncrementFromTotal = true;
  }
  assert.ok(coverage.has('total') && coverage.has('additional'));
  assert.ok(coverage.has('favors-A') && coverage.has('favors-B'));
  assert.ok(separatesFreshPriorError);
  assert.ok(separatesIncrementFromTotal);
});

test('beta forecaster prediction updates both distributions and model weights before averaging', () => {
  const sizes = new Set();
  let uniform = false, equalPrior = false, unequalPrior = false;
  let separatesOldWeights = false, separatesBestOnly = false;
  for (let seed = 0; seed < 1200; seed++) {
    const q = generateQuestion('prediction', seed);
    if (q.title !== 'Learn from several beta forecasters') continue;
    const [, s, f] = q.context.match(/sequence with (\d+) successes and (\d+) failures/).map(Number);
    const ms = parseModels(q), post = posterior(ms, s, f), means = post.map(m => m.a / (m.a + m.b));
    sizes.add(ms.length);
    uniform ||= ms.some(m => m.a === 1 && m.b === 1);
    equalPrior ||= ms.every(m => Math.abs(m.weight - 1 / ms.length) < 1e-12);
    unequalPrior ||= ms.some(m => Math.abs(m.weight - 1 / ms.length) > 1e-12);
    near(ms.reduce((total, m) => total + m.weight, 0), 1);
    near(post.reduce((total, m) => total + m.weight, 0), 1);
    const expected = post.reduce((total, m, i) => total + m.weight * means[i], 0);
    near(q.answer, expected);
    const oldWeights = ms.reduce((total, m, i) => total + m.weight * means[i], 0);
    if (Math.abs(expected - oldWeights) > .01) separatesOldWeights = true;
    const best = post.reduce((winner, m, i) => m.weight > post[winner].weight ? i : winner, 0);
    if (Math.abs(expected - means[best]) > .01) separatesBestOnly = true;
    post.forEach((m, i) => {
      near(q.steps[ms.length + i].answer, m.weight);
      near(q.steps[2 * ms.length + i].answer, means[i]);
    });
  }
  assert.deepEqual([...sizes].sort(), [2, 3]);
  assert.ok(uniform && equalPrior && unequalPrior);
  assert.ok(separatesOldWeights && separatesBestOnly);
});

test('overlap examples can exceed one before subtraction without declaring an invalid probability', () => {
  let sawSumAboveOne = false;
  for (let seed = 0; seed < 2500; seed++) {
    const q = generateQuestion('probability', seed);
    if (q.title !== 'Allow for overlapping events') continue;
    const [a, b, overlap] = q.table.rows.map(row => Number(row[1]));
    const cells = [overlap, a - overlap, b - overlap, 1 - a - b + overlap];
    assert.ok(cells.every(value => value >= -1e-12 && value <= 1));
    near(cells.reduce((sum, value) => sum + value, 0), 1);
    if (a + b > 1) {
      sawSumAboveOne = true;
      assert.equal(q.steps[0].unit, 'number');
      near(q.steps[0].answer, a + b);
      assert.ok(q.answer <= 1);
    }
  }
  assert.ok(sawSumAboveOne);
});
