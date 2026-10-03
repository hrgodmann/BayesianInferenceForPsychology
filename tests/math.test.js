import test from 'node:test';
import assert from 'node:assert/strict';
import { choose, fixedSequence, betaSequence, betaCount, updateModels, predictModels } from '../site/math.js';

const close = (actual, expected, message = '', tolerance = 1e-12) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, received ${actual}`);
};
const chefs = () => [
  { name: 'F', weight: 1 / 3, type: 'fixed', p: .75 },
  { name: 'H', weight: 1 / 3, type: 'fixed', p: .45 },
  { name: 'A', weight: 1 / 3, type: 'beta', a: 2, b: 2 },
];

test('binomial coefficients count positions, including empty sequences', () => {
  assert.equal(choose(0, 0), 1);
  assert.equal(choose(8, 0), 1);
  assert.equal(choose(8, 8), 1);
  assert.equal(choose(8, 3), 56);
  assert.equal(choose(11, 9), 55);
  for (let n = 1; n <= 20; n++) {
    for (let k = 0; k <= n; k++) assert.equal(choose(n, k), choose(n, n - k));
  }
});

test('fixed-rate endpoints preserve the probability of an empty sequence', () => {
  close(fixedSequence(.7, 2, 1), .147);
  assert.equal(fixedSequence(0, 0, 0), 1);
  assert.equal(fixedSequence(1, 0, 0), 1);
  assert.equal(fixedSequence(0, 0, 4), 1);
  assert.equal(fixedSequence(1, 4, 0), 1);
  assert.equal(fixedSequence(0, 1, 4), 0);
  assert.equal(fixedSequence(1, 4, 1), 0);
});

test('beta prediction agrees with independently reduced quiz fractions', () => {
  close(betaSequence(6, 2, 3, 0), 7 / 15);
  close(betaCount(1, 1, 3, 2), 1 / 4);
  close(betaCount(6, 2, 3, 2), 7 / 20);
  close(betaCount(15, 15, 3, 2), 45 / 124);
  close(betaSequence(.5, 1.5, 1, 1), 1 / 8, 'noninteger positive shapes');
  assert.equal(betaSequence(2, 3, 0, 0), 1);
  assert.equal(betaCount(2, 3, 0, 0), 1);
});

test('future counts include all arrangements and form a normalized distribution', () => {
  for (const [a, b] of [[1, 1], [6, 2], [.5, .5], [2.5, 9]]) {
    for (let n = 0; n <= 12; n++) {
      let total = 0;
      for (let k = 0; k <= n; k++) {
        const probability = betaCount(a, b, n, k);
        close(probability, choose(n, k) * betaSequence(a, b, k, n - k));
        total += probability;
      }
      close(total, 1, `Beta(${a},${b}), ${n} future observations`);
    }
  }
});

test('the assessed mixed fixed-rate and beta model problem has the expected answers', () => {
  const models = chefs();
  const afterMW = updateModels(models, 1, 1);
  close(afterMW[0].weight, 75 / 254);
  close(predictModels(models, 1, 1, 1, 0), 352 / 635);
  const afterMWW = updateModels(models, 1, 2);
  close(afterMWW[1].weight, 1089 / 2264);
  close(predictModels(models, 1, 2, 3, 0), (375 * 27 / 64 + 1089 * 729 / 8000 + 800 * 5 / 42) / 2264);
});

test('updating preserves inputs and supports unnormalized prior weights', () => {
  const models = chefs().map(model => ({ ...model, weight: 7 }));
  const snapshot = structuredClone(models);
  const result = updateModels(models, 3, 2);
  assert.deepEqual(models, snapshot);
  assert.notEqual(result, models);
  result.forEach((model, i) => assert.notEqual(model, models[i]));
  close(result.reduce((sum, model) => sum + model.weight, 0), 1);
  assert.equal(result[2].a, 5);
  assert.equal(result[2].b, 4);
  assert.equal(result[0].p, .75);
  const equalPrior = updateModels(chefs(), 3, 2);
  result.forEach((model, i) => close(model.weight, equalPrior[i].weight));
});

test('sequential model and parameter updates equal a batch update', () => {
  const sequential = updateModels(updateModels(chefs(), 2, 1), 1, 3);
  const batch = updateModels(chefs(), 3, 4);
  sequential.forEach((model, i) => {
    close(model.weight, batch[i].weight);
    if (model.type === 'beta') {
      assert.equal(model.a, batch[i].a);
      assert.equal(model.b, batch[i].b);
    }
  });
  close(predictModels(sequential, 0, 0, 2, 1), predictModels(chefs(), 3, 4, 2, 1));
});

test('joint future prediction integrates shared uncertainty instead of squaring its mean', () => {
  const uncertainCoin = [{ name: 'Coin', weight: 1, type: 'beta', a: 1, b: 1 }];
  close(predictModels(uncertainCoin, 0, 0, 1, 0), 1 / 2);
  close(predictModels(uncertainCoin, 0, 0, 2, 0), 1 / 3);
  assert.notEqual(predictModels(uncertainCoin, 0, 0, 2, 0), .25);
  close(predictModels(uncertainCoin, 3, 1, 2, 1, { count: true }), 5 / 14);
  close(predictModels(uncertainCoin, 3, 1, 2, 1), 5 / 42);
});

test('analytic future predictions equal enumeration through sequential updates', () => {
  const models = chefs();
  const observed = updateModels(models, 2, 1);
  const paths = [];
  function enumerate(current, s, f, mass) {
    if (s + f === 5) {
      paths.push({ s, f, mass });
      return;
    }
    for (const success of [false, true]) {
      const ds = Number(success);
      const df = Number(!success);
      const nextProbability = predictModels(current, 0, 0, ds, df);
      enumerate(updateModels(current, ds, df), s + ds, f + df, mass * nextProbability);
    }
  }
  enumerate(observed, 0, 0, 1);
  close(paths.reduce((sum, path) => sum + path.mass, 0), 1);
  for (let k = 0; k <= 5; k++) {
    const matching = paths.filter(path => path.s === k);
    close(predictModels(models, 2, 1, k, 5 - k), matching[0].mass);
    close(predictModels(models, 2, 1, k, 5 - k, { count: true }), matching.reduce((sum, path) => sum + path.mass, 0));
  }
});

test('swapping success and failure labels leaves corresponding probabilities unchanged', () => {
  const models = chefs();
  const swapped = models.map(model => model.type === 'fixed'
    ? { ...model, p: 1 - model.p }
    : { ...model, a: model.b, b: model.a });
  close(betaSequence(2, 7, 3, 1), betaSequence(7, 2, 1, 3));
  close(predictModels(models, 4, 1, 3, 2), predictModels(swapped, 1, 4, 2, 3));
  const originalPosterior = updateModels(models, 4, 1);
  updateModels(swapped, 1, 4).forEach((model, i) => close(model.weight, originalPosterior[i].weight));
});

test('zero-weight and contradicted point models retain zero posterior weight', () => {
  const models = [
    { name: 'Always', weight: .5, type: 'fixed', p: 1 },
    { name: 'Never', weight: 0, type: 'fixed', p: 0 },
    { name: 'Unknown', weight: .5, type: 'beta', a: 1, b: 1 },
  ];
  const result = updateModels(models, 1, 1);
  assert.deepEqual(result.map(model => model.weight), [0, 0, 1]);
  close(predictModels(models, 1, 1, 1, 0), .5);
  close(predictModels(models, 0, 0, 0, 0), 1);
});

test('model normalization handles very small likelihoods and very large prior weights', () => {
  const identical = [
    { name: 'First', weight: 1e308, type: 'fixed', p: .5 },
    { name: 'Second', weight: 1e308, type: 'fixed', p: .5 },
  ];
  updateModels(identical, 1500, 1500).forEach(model => close(model.weight, .5));
  // The central count is representable although its coefficient exceeds the
  // largest finite JavaScript number.
  close(betaCount(1, 1, 1200, 600), 1 / 1201, '', 1e-11);
});

test('invalid parameters and impossible observations fail with clear errors', () => {
  for (const invalid of [-1, .5, NaN, Infinity, '2', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => choose(invalid, 0), /integer/);
    assert.throws(() => fixedSequence(.5, invalid, 1), /integer/);
    assert.throws(() => betaSequence(1, 1, 1, invalid), /integer/);
  }
  assert.throws(() => choose(2, 3), /cannot exceed/);
  assert.throws(() => betaCount(1, 1, 2, 3), /cannot exceed/);
  for (const invalid of [-.1, 1.1, NaN, Infinity, '0.5']) assert.throws(() => fixedSequence(invalid, 1, 0), /probability/);
  for (const invalid of [0, -1, NaN, Infinity, '1']) {
    assert.throws(() => betaSequence(invalid, 1, 1, 0), /positive finite/);
    assert.throws(() => betaCount(1, invalid, 2, 1), /positive finite/);
  }
  assert.throws(() => updateModels([], 1, 0), /at least one model/);
  assert.throws(() => updateModels([{ type: 'normal', weight: 1 }], 1, 0), /type/);
  assert.throws(() => updateModels([{ type: 'fixed', p: .5, weight: -1 }], 1, 0), /weights/);
  assert.throws(() => updateModels([{ type: 'fixed', p: .5, weight: 0 }], 1, 0), /positive weight/);
  assert.throws(() => updateModels([{ type: 'fixed', p: 1, weight: 1 }], 1, 1), /impossible/);
  assert.throws(() => predictModels(chefs(), 1, 0, 1, -1), /integer/);
  assert.throws(() => predictModels(chefs(), 1, 0, 1, 0, { count: 'yes' }), /Boolean/);
});

test('small-count fallback recovers a representable beta-binomial probability after sequence underflow', () => {
  const answer = betaCount(1e-308, 1e-308, 100, 50);
  assert.ok(answer > 0);
  assert.ok(Math.abs(answer / 2e-310 - 1) < 1e-10);
});
