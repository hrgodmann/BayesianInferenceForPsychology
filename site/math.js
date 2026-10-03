/** Pure probability calculations used by the generated exercises. */

function count(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
}

function probability(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be a probability between 0 and 1.`);
  }
}

function shapes(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0 || !Number.isFinite(a + b)) {
    throw new RangeError('Beta shapes a and b must be positive finite numbers with a finite sum.');
  }
}

function observations(s, f) {
  count(s, 'Successes');
  count(f, 'Failures');
  if (!Number.isSafeInteger(s + f)) {
    throw new RangeError('The total observation count must be a safe integer.');
  }
}

/** Number of distinct success positions in n trials. */
export function choose(n, k) {
  count(n, 'n');
  count(k, 'k');
  if (k > n) throw new RangeError('k cannot exceed n.');
  const steps = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= steps; i++) result *= (n - steps + i) / i;
  // Avoid artifacts such as 55.00000000000001 for small exact integers.
  return result <= Number.MAX_SAFE_INTEGER ? Math.round(result) : result;
}

/** Probability of one specified order, given a fixed success probability. */
export function fixedSequence(p, s, f) {
  probability(p, 'p');
  observations(s, f);
  return p ** s * (1 - p) ** f;
}

/** Integrated probability of one specified order under Beta(a,b). */
export function betaSequence(a, b, s, f) {
  shapes(a, b);
  observations(s, f);
  let result = 1;
  for (let i = 0; i < s; i++) result *= (a + i) / (a + b + i);
  for (let i = 0; i < f; i++) result *= (b + i) / (a + b + s + i);
  return result;
}

/** Beta-binomial probability of k successes in n trials, in any order. */
export function betaCount(a, b, n, k) {
  count(n, 'n');
  count(k, 'k');
  if (k > n) throw new RangeError('k cannot exceed n.');
  shapes(a, b);
  // Small classroom counts are more accurate without a log/exp round trip,
  // especially when the exact result is a decimal rounding boundary.
  if (n <= 100) {
    const direct = choose(n, k) * betaSequence(a, b, k, n - k);
    if (direct > 0 && Number.isFinite(direct)) return direct;
  }
  // Multiplying in log space also works when the counting coefficient alone
  // overflows, although the final probability is representable.
  return Math.exp(logChoose(n, k) + logBetaSequence(a, b, k, n - k));
}

function logChoose(n, k) {
  const steps = Math.min(k, n - k);
  let result = 0;
  for (let i = 1; i <= steps; i++) result += Math.log(n - steps + i) - Math.log(i);
  return result;
}

function logBetaSequence(a, b, s, f) {
  let result = 0;
  for (let i = 0; i < s; i++) result += Math.log(a + i) - Math.log(a + b + i);
  for (let i = 0; i < f; i++) result += Math.log(b + i) - Math.log(a + b + s + i);
  return result;
}

function logFixedSequence(p, s, f) {
  // Explicit zero-count cases avoid 0 * log(0) at fixed probabilities 0 or 1.
  return (s === 0 ? 0 : s * Math.log(p)) + (f === 0 ? 0 : f * Math.log1p(-p));
}

function logSequence(model, s, f) {
  return model.type === 'fixed'
    ? logFixedSequence(model.p, s, f)
    : logBetaSequence(model.a, model.b, s, f);
}

function validateModels(models) {
  if (!Array.isArray(models) || models.length === 0) {
    throw new TypeError('Provide at least one model.');
  }
  for (const model of models) {
    if (!model || !Number.isFinite(model.weight) || model.weight < 0) {
      throw new RangeError('Model weights must be non-negative finite numbers.');
    }
    if (model.type === 'fixed') probability(model.p, 'Fixed model p');
    else if (model.type === 'beta') shapes(model.a, model.b);
    else throw new TypeError('Each model must have type "fixed" or "beta".');
  }
  if (!models.some(model => model.weight > 0)) {
    throw new RangeError('At least one model must have a positive weight.');
  }
}

/**
 * Update both model probabilities and each beta model's parameter distribution.
 * Weights may be unnormalized. Neither the input list nor its models are changed.
 */
export function updateModels(models, s, f) {
  validateModels(models);
  observations(s, f);
  const logWeights = models.map(model => Math.log(model.weight) + logSequence(model, s, f));
  const largest = Math.max(...logWeights);
  if (largest === -Infinity) {
    throw new RangeError('These observations are impossible under every model with positive prior weight.');
  }
  const scaled = logWeights.map(value => Math.exp(value - largest));
  const total = scaled.reduce((sum, value) => sum + value, 0);
  return models.map((model, i) => ({
    ...model,
    weight: scaled[i] / total,
    ...(model.type === 'beta' ? { a: model.a + s, b: model.b + f } : {}),
  }));
}

/**
 * Predict a future sequence after s successes and f failures. The supplied
 * models describe the priors, before those observations. With count:true,
 * predict a success count in any order instead of one particular sequence.
 */
export function predictModels(models, s, f, futureS, futureF, { count: anyOrder = false } = {}) {
  observations(futureS, futureF);
  if (typeof anyOrder !== 'boolean') throw new TypeError('count must be a Boolean.');
  const posterior = updateModels(models, s, f);
  const logCoefficient = anyOrder ? logChoose(futureS + futureF, futureS) : 0;
  return posterior.reduce((sum, model) => {
    if (model.weight === 0) return sum;
    return sum + model.weight * Math.exp(logCoefficient + logSequence(model, futureS, futureF));
  }, 0);
}
