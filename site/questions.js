import { choose, fixedSequence, betaSequence, betaCount, updateModels, predictModels } from './math.js';

export const GENERATOR_VERSION = 2;
export const skills = [
  { id: 'probability', title: 'Probability rules', description: 'Combine probabilities across groups.', icon: 'tree' },
  { id: 'bayes', title: 'Bayes’ rule', description: 'Update which explanation is most likely.', icon: 'cycle' },
  { id: 'sequences', title: 'Sequences & counts', description: 'Calculate ordered outcomes and success counts.', icon: 'measure' },
  { id: 'beta', title: 'Learning a proportion', description: 'Update beta distributions and predict outcomes.', icon: 'uncertainty' },
  { id: 'mixtures', title: 'Combining predictions', description: 'Average predictions across competing models.', icon: 'balance' },
  { id: 'prediction', title: 'Predicting observations', description: 'Use what you have learned to predict what comes next.', icon: 'mind' },
  { id: 'bayes-factors', title: 'Bayes factors & odds', description: 'Compare predictions and update model odds.', icon: 'balance' },
];
export const difficulties = [
  { id: 'foundation', label: 'Foundation', description: 'One main calculation, with simpler models.' },
  { id: 'practice', label: 'Practice', description: 'Combine calculations at quiz level.' },
  { id: 'challenge', label: 'Challenge', description: 'Work backwards or combine more models and observations.' },
];

// Mulberry32: a saved seed reproduces a question without storing its content.
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let x = Math.imul(state ^ (state >>> 15), state | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, items) => items[Math.floor(rng() * items.length)];
const integer = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const f = value => Number(value.toPrecision(7)).toString();
const precision = value => value > 0 && value < 0.01 ? 4 : 2;
const step = (prompt, answer, formula, working, unit = 'probability') => ({
  prompt, answer, unit, decimals: precision(answer), formula, working,
});
const book = chapters => ({ label: `Course book · ${chapters.includes(',') ? 'Chapters' : 'Chapter'} ${chapters}`, chapters });
const weights = rng => {
  const w = pick(rng, [0.25, 0.4, 0.5, 0.6, 0.75]);
  return [w, 1 - w];
};
const rate = rng => integer(rng, 2, 8) / 10;
const modelText = m => m.type === 'fixed' ? `Fixed success probability ${f(m.p)}` : `θ ~ Beta(${m.a}, ${m.b})`;
const modelTable = models => ({ headers: ['Model', 'Prior probability', 'Success rate'], rows: models.map(m => [m.name, f(m.weight), modelText(m)]) });
const likelihood = (model, s, fails) => model.type === 'fixed' ? fixedSequence(model.p, s, fails) : betaSequence(model.a, model.b, s, fails);
const marginal = (models, s, fails) => models.reduce((total, m) => total + m.weight * likelihood(m, s, fails), 0);
function betaProduct(a, b, successes, failures) {
  const factors = [];
  for (let i = 0; i < successes; i++) factors.push(`(${a + i}/${a + b + i})`);
  for (let j = 0; j < failures; j++) factors.push(`(${b + j}/${a + b + successes + j})`);
  return factors.join(' × ') || '1';
}
function sequenceWorking(model, s, fails) {
  return model.type === 'fixed'
    ? `${f(model.p)}^${s} × (1 − ${f(model.p)})^${fails}`
    : betaProduct(model.a, model.b, s, fails);
}
function mixtureWorking(models, values) {
  return models.map((m, i) => `${f(m.weight)} × ${f(values[i])}`).join(' + ');
}
function posteriorWorking(models, s, fails, index = 0) {
  const denominator = marginal(models, s, fails);
  return `${f(models[index].weight)} × ${f(likelihood(models[index], s, fails))} / ${f(denominator)}`;
}
function modelLikelihoodSteps(models, s, fails) {
  return models.map(m => step(`Probability of the observed ordered sequence under ${m.name}`, likelihood(m, s, fails),
    m.type === 'fixed' ? 'P(sequence | θ) = θ^s(1 − θ)^f' : 'P(sequence | model) = B(a + s, b + f) / B(a, b)',
    `${sequenceWorking(m, s, fails)} = ${f(likelihood(m, s, fails))}`));
}
function finish(skillId, seed, difficulty, item, suffix = '') {
  return {
    id: `v${GENERATOR_VERSION}-${skillId}-${seed >>> 0}-${difficulty}${suffix}`, seed: seed >>> 0,
    skillId, difficulty, unit: 'probability', decimals: precision(item.answer), ...item,
  };
}

function probability(rng, level) {
  const three = level !== 'foundation';
  const groupNames = three ? ['Morning', 'Afternoon', 'Evening'] : ['Morning', 'Afternoon'];
  const ws = three ? pick(rng, [[0.2, 0.3, 0.5], [0.4, 0.35, 0.25], [0.3, 0.2, 0.5]]) : weights(rng);
  const ps = groupNames.map(() => rate(rng));
  const total = ws.reduce((sum, w, i) => sum + w * ps[i], 0);
  const backwards = level === 'challenge';
  const known = ws.slice(1).reduce((sum, w, j) => sum + w * ps[j + 1], 0);
  return {
    title: backwards ? 'Recover a missing success rate' : 'Across all workshop sessions',
    context: 'A visitor attends exactly one workshop session. These sessions cover all possibilities. Success means finishing a puzzle.',
    table: { headers: ['Session', 'P(session)', 'P(success | session)'], rows: groupNames.map((name, i) => [name, f(ws[i]), backwards && i === 0 ? '?' : f(ps[i])]) },
    prompt: backwards ? `The overall success probability is ${f(total)}. What is P(success | Morning)?` : 'What is the probability that a randomly selected visitor finishes the puzzle?',
    answer: backwards ? ps[0] : total,
    hints: ['Weight each conditional success probability by the probability of its session.', backwards ? 'Subtract the known contributions from the overall probability, then divide by P(Morning).' : 'Add the joint probabilities for the mutually exclusive sessions.'],
    steps: backwards
      ? [step('Combined contribution from the afternoon and evening sessions', known, 'Known contribution = Σ P(session)P(success | session)', ws.slice(1).map((w, i) => `${f(w)} × ${f(ps[i + 1])}`).join(' + ') + ` = ${f(known)}`)]
      : [step('Probability of attending in the morning and succeeding', ws[0] * ps[0], 'P(Morning and success) = P(Morning)P(success | Morning)', `${f(ws[0])} × ${f(ps[0])} = ${f(ws[0] * ps[0])}`)],
    explanation: backwards
      ? `P(success | Morning) = (${f(total)} − ${f(known)}) / ${f(ws[0])} = ${f(ps[0])}. The other sessions account for ${f(known)} of the overall success probability.`
      : `P(success) = ${ws.map((w, i) => `${f(w)} × ${f(ps[i])}`).join(' + ')} = ${f(total)}. Each visitor belongs to exactly one session, so these joint probabilities can be added.`,
    source: book('3'),
  };
}

function bayes(rng, level) {
  const ws = level === 'challenge' ? [0.2, 0.3, 0.5] : weights(rng);
  const models = ws.map((weight, i) => ({ name: `Machine ${String.fromCharCode(65 + i)}`, type: 'fixed', weight, p: rate(rng) }));
  const failures = level !== 'foundation' && rng() < 0.5 ? 1 : 0;
  const successes = failures ? 0 : (level === 'challenge' ? 2 : 1);
  const event = failures ? 'a failed inspection' : successes === 1 ? 'a passed inspection' : 'two passed inspections in a row';
  const updated = updateModels(models, successes, failures);
  const total = marginal(models, successes, failures);
  return {
    title: 'Which machine made the parts?',
    context: 'One machine is selected using the prior probabilities below. It makes every part in this question. Inspections are independent conditional on that machine; its success rate remains fixed.',
    table: modelTable(models), prompt: `After ${event}, what is the probability that Machine A was selected?`, answer: updated[0].weight,
    hints: ['Calculate how well each machine predicts the observation. For a failed inspection use 1 − p.', 'Multiply each likelihood by its prior probability, then divide Machine A’s weighted likelihood by their total.'],
    steps: [
      step('Joint probability of Machine A and the observed data', models[0].weight * likelihood(models[0], successes, failures), 'P(A, data) = P(A)P(data | A)', `${f(models[0].weight)} × ${sequenceWorking(models[0], successes, failures)} = ${f(models[0].weight * likelihood(models[0], successes, failures))}`),
      step('Overall probability of the observed data', total, 'P(data) = Σ P(model)P(data | model)', `${mixtureWorking(models, models.map(m => likelihood(m, successes, failures)))} = ${f(total)}`),
    ],
    explanation: `P(A | data) = P(A)P(data | A) / P(data) = ${posteriorWorking(models, successes, failures)} = ${f(updated[0].weight)}. Normalize over every possible machine.`,
    source: book('3, 7'),
  };
}

function sequences(rng, level) {
  const p = rate(rng), n = integer(rng, 4, 7), k = integer(rng, 1, n - 1);
  const ordered = level === 'foundation', tail = level === 'challenge';
  const sequence = [...Array(k).fill('S'), ...Array(n - k).fill('F')].join(', ');
  const oneOrder = fixedSequence(p, k, n - k);
  const answer = tail ? 1 - fixedSequence(p, 0, n) - n * fixedSequence(p, 1, n - 1) : oneOrder * (ordered ? 1 : choose(n, k));
  return {
    title: tail ? 'At least two successes' : ordered ? 'One specified sequence' : 'A count in any order',
    context: `A sensor detects a signal with fixed probability ${f(p)} on each independent trial. S denotes detection and F denotes no detection.`,
    prompt: tail ? `What is the probability of at least two detections in ${n} trials?` : ordered ? `What is the probability of this exact ordered sequence: ${sequence}?` : `What is the probability of exactly ${k} detections in ${n} trials, in any order?`,
    answer,
    hints: [tail ? 'Use the complement: subtract zero and one detection from 1.' : ordered ? 'Multiply the success and failure probabilities for this single order.' : 'Calculate one sequence probability, then count how many orders have these same counts.', tail ? 'There are n possible positions for a single detection.' : ordered ? 'Do not add a binomial coefficient when the order is specified.' : 'The number of orders is n! / [k!(n − k)!].'],
    steps: tail ? [
      step('Probability of zero detections', fixedSequence(p, 0, n), 'P(0) = (1 − p)^n', `(1 − ${f(p)})^${n} = ${f(fixedSequence(p, 0, n))}`),
      step('Probability of exactly one detection', n * fixedSequence(p, 1, n - 1), 'P(1) = n p (1 − p)^(n − 1)', `${n} × ${f(p)} × (1 − ${f(p)})^${n - 1} = ${f(n * fixedSequence(p, 1, n - 1))}`),
    ] : ordered ? [step('Probability of the successes in the specified positions', p ** k, 'Success contribution = p^k', `${f(p)}^${k} = ${f(p ** k)}`)] : [
      step('Number of possible orders', choose(n, k), 'C(n, k) = n! / [k!(n − k)!]', `C(${n}, ${k}) = ${choose(n, k)}`, 'number'),
      step('Probability of one specified order', oneOrder, 'P(sequence) = p^k(1 − p)^(n − k)', `${f(p)}^${k} × (1 − ${f(p)})^${n - k} = ${f(oneOrder)}`),
    ],
    explanation: tail ? `P(at least 2) = 1 − (1 − ${f(p)})^${n} − ${n} × ${f(p)} × (1 − ${f(p)})^${n - 1} = ${f(answer)}.` : `P(${ordered ? 'this sequence' : 'this count'}) = ${ordered ? '' : `${choose(n, k)} × `}${f(p)}^${k} × (1 − ${f(p)})^${n - k} = ${f(answer)}. ${ordered ? 'A single specified order has no counting factor.' : 'All orders with these counts have equal probability and are mutually exclusive.'}`,
    source: book('3, 7, 34'),
  };
}

function beta(rng, level) {
  let a = integer(rng, 1, 6), b = integer(rng, 1, 6);
  const s = integer(rng, 2, 7), fails = level === 'practice' && rng() < 0.5 ? 0 : integer(rng, 1, 4);
  const askSuccessParameter = rng() < 0.5;
  if (level === 'foundation') return {
    title: 'Update a beta distribution', context: `A plant nursery models the germination rate as θ ~ Beta(${a}, ${b}). Seeds germinate independently conditional on the same θ.`,
    prompt: askSuccessParameter ? `${fails} of ${s + fails} seeds fail to germinate. What is the updated first parameter a′ in Beta(a′, b′)?` : `${s} of ${s + fails} seeds germinate. What is the updated second parameter b′ in Beta(a′, b′)?`, answer: askSuccessParameter ? a + s : b + fails, unit: 'number',
    hints: [askSuccessParameter ? 'Subtract the failed seeds from the total to find the successes.' : 'Count the seeds that failed to germinate.', 'A beta posterior adds successes to a and failures to b.'],
    steps: [askSuccessParameter ? step('Number of successes', s, 'Successes = total − failures', `${s + fails} − ${fails} = ${s}`, 'number') : step('Number of failures', fails, 'Failures = total − successes', `${s + fails} − ${s} = ${fails}`, 'number')],
    explanation: `Beta(a + successes, b + failures) = Beta(${a} + ${s}, ${b} + ${fails}) = Beta(${a + s}, ${b + fails}). Therefore ${askSuccessParameter ? `a′ = ${a + s}` : `b′ = ${b + fails}`}.`, source: book('8'),
  };
  if (level === 'practice' && rng() < 0.4) return {
    title: 'Laplace’s rule of succession', context: 'A uniform Beta(1, 1) prior describes an unknown success rate. All trials share this same rate and are independent conditional on it.',
    prompt: `You observe ${s} successes and ${fails} failures. What is the probability that the next trial succeeds?`, answer: (s + 1) / (s + fails + 2),
    hints: ['Update the uniform prior to Beta(1 + successes, 1 + failures).', 'For Beta(a′, b′), the next-success probability is a′ / (a′ + b′).'],
    steps: [step('Updated success parameter a′', s + 1, 'a′ = 1 + successes', `1 + ${s} = ${s + 1}`, 'number'), step('Sum of posterior parameters', s + fails + 2, 'a′ + b′ = successes + failures + 2', `${s} + ${fails} + 2 = ${s + fails + 2}`, 'number')],
    explanation: `P(next success | data) = (${s} + 1) / (${s} + ${fails} + 2) = ${f((s + 1) / (s + fails + 2))}. This is Laplace’s rule with both successes and failures.`, source: book('8, 9'),
  };
  const posterior = level === 'challenge', n = integer(rng, 3, 5), k = integer(rng, 1, n);
  const aa = a + (posterior ? s : 0), bb = b + (posterior ? fails : 0);
  const answer = betaCount(aa, bb, n, k);
  return {
    title: posterior ? 'Predict a future count after learning' : 'Predict a count from a beta prior',
    context: `The success rate has prior θ ~ Beta(${a}, ${b}). All observations use the same θ and are independent conditional on it.${posterior ? ` You have observed ${s} successes and ${fails} failures.` : ' No observations have been collected yet.'}`,
    prompt: `What is the probability of exactly ${k} successes in the next ${n} trials, in any order?`, answer,
    hints: [posterior ? 'Update both beta parameters before making the prediction.' : 'Average the binomial probability across the whole beta prior.', 'Use C(n, k) × B(a′ + k, b′ + n − k) / B(a′, b′); do not substitute only the mean success rate.'],
    steps: posterior ? [
      step('Posterior success parameter a′', aa, 'a′ = a + successes', `${a} + ${s} = ${aa}`, 'number'),
      step('Posterior failure parameter b′', bb, 'b′ = b + failures', `${b} + ${fails} = ${bb}`, 'number'),
      step('Number of possible future orders', choose(n, k), 'C(n, k)', `C(${n}, ${k}) = ${choose(n, k)}`, 'number'),
    ] : [step('Number of possible orders', choose(n, k), 'C(n, k)', `C(${n}, ${k}) = ${choose(n, k)}`, 'number'), step('Probability of one specified order', betaSequence(a, b, k, n - k), 'B(a + k, b + n − k) / B(a, b)', `B(${a + k}, ${b + n - k}) / B(${a}, ${b}) = ${betaProduct(a, b, k, n - k)} = ${f(betaSequence(a, b, k, n - k))}`)],
    explanation: `P(K = ${k}) = C(${n}, ${k}) × B(${aa + k}, ${bb + n - k}) / B(${aa}, ${bb}) = ${choose(n, k)} × [${betaProduct(aa, bb, k, n - k)}] = ${f(answer)}. ${posterior ? `The updated distribution is Beta(${aa}, ${bb}).` : 'This prediction includes uncertainty about θ.'} Each predictive factor uses the beta parameters updated by the preceding outcomes.`, source: book('8, 9, 12'),
  };
}

function mixtures(rng, level) {
  const ws = level === 'foundation' ? [0.5, 0.5] : weights(rng);
  const models = [
    { name: 'Model A', type: 'fixed', weight: ws[0], p: level === 'foundation' ? 1 : rate(rng) },
    { name: 'Model B', type: 'beta', weight: ws[1], a: level === 'foundation' ? 1 : integer(rng, 1, 6), b: level === 'foundation' ? 1 : integer(rng, 1, 6) },
  ];
  if (level === 'challenge') {
    models[0].weight = 0.3; models[1].weight = 0.4;
    models.push({ name: 'Model C', type: 'beta', weight: 0.3, a: integer(rng, 2, 7), b: integer(rng, 2, 7) });
  }
  const n = integer(rng, 2, 5), k = level === 'foundation' ? n : integer(rng, 1, n - 1);
  const values = models.map(m => choose(n, k) * likelihood(m, k, n - k));
  const answer = values.reduce((sum, v, i) => sum + models[i].weight * v, 0);
  return {
    title: 'Combine prior predictions', context: 'These are competing models of a seed variety’s germination rate. One model describes the entire batch. Within a beta model, all seeds share one unknown θ and are independent conditional on it. No data have been observed.',
    table: modelTable(models), prompt: `What is the overall prior predictive probability that exactly ${k} of the first ${n} seeds germinate, in any order?`, answer,
    hints: ['First calculate the event probability separately under each model.', 'Weight those predictions by the prior model probabilities and add them.'],
    steps: models.map((m, i) => step(`Predictive probability under ${m.name}`, values[i], m.type === 'fixed' ? 'P(K = k) = C(n, k)p^k(1 − p)^(n − k)' : 'P(K = k) = C(n, k)B(a + k, b + n − k) / B(a, b)', `${choose(n, k)} × ${sequenceWorking(m, k, n - k)} = ${f(values[i])}`)),
    explanation: `P(data) = Σ P(model)P(data | model) = ${mixtureWorking(models, values)} = ${f(answer)}. Use prior model weights because no data have yet been observed.`, source: book('12, 15, 22'),
  };
}

function prediction(rng, level) {
  const ws = weights(rng);
  const models = [
    { name: 'Model A', type: 'fixed', weight: ws[0], p: rate(rng) },
    level === 'challenge' ? { name: 'Model B', type: 'beta', weight: ws[1], a: integer(rng, 2, 6), b: integer(rng, 2, 6) } : { name: 'Model B', type: 'fixed', weight: ws[1], p: rate(rng) },
  ];
  const s = level === 'foundation' ? 1 : integer(rng, 1, 3), fails = level === 'foundation' ? 0 : integer(rng, 1, 2);
  const futureS = level === 'foundation' ? 1 : 2, futureF = level === 'challenge' ? 1 : 0, count = level === 'challenge';
  const post = updateModels(models, s, fails);
  const values = post.map(m => (count ? choose(futureS + futureF, futureS) : 1) * likelihood(m, futureS, futureF));
  const answer = predictModels(models, s, fails, futureS, futureF, { count });
  return {
    title: level === 'foundation' ? 'Predict the next success' : 'Predict several future observations',
    context: `One model describes a testing device throughout all past and future trials. Trials are independent conditional on its fixed θ; in Model B, a beta distribution (when listed) describes uncertainty about this shared θ. You observe an ordered sequence with ${s} successes and ${fails} failures.`,
    table: modelTable(models), prompt: count ? 'What is the probability of exactly two successes in the next three trials, in any order?' : `What is the probability that ${futureS === 1 ? 'the next trial succeeds' : 'both of the next two trials succeed'}?`, answer,
    hints: ['Update model probabilities using the observed sequence; also update the beta parameters, if present.', futureS === 1 ? 'Average the next-success predictions using posterior model weights.' : 'Calculate the entire future event within each model, then average. Do not square the model-averaged one-step prediction.'],
    steps: [...modelLikelihoodSteps(models, s, fails), step('Posterior probability of Model A', post[0].weight, 'P(A | data) = P(A)P(data | A) / P(data)', `${posteriorWorking(models, s, fails)} = ${f(post[0].weight)}`)],
    explanation: `Posterior weights are ${post.map(m => `${m.name}: ${f(m.weight)}`).join(', ')}. ${post.filter(m => m.type === 'beta').map(m => `${m.name} updates to Beta(${m.a}, ${m.b}).`).join(' ')} Within-model future probabilities are ${post.map((m, i) => `${m.name}: ${count ? `${choose(futureS + futureF, futureS)} × ` : ''}${sequenceWorking(m, futureS, futureF)} = ${f(values[i])}`).join('; ')}. The final prediction is ${mixtureWorking(post, values)} = ${f(answer)}.`, source: book('7, 9, 12, 22'),
  };
}

function bayesFactors(rng, level) {
  if (level === 'foundation') {
    const first = integer(rng, 2, 8), second = integer(rng, 2, 6), reciprocal = rng() < 0.5;
    return {
      title: reciprocal ? 'Reverse a Bayes factor' : 'Link two model comparisons', context: `BF_AB = ${first}${reciprocal ? '.' : ` and BF_BC = ${second}. Both compare predictions for exactly the same data.`} BF_XY means P(data | X) / P(data | Y).`,
      prompt: reciprocal ? 'What is BF_BA?' : 'What is BF_AC?', answer: reciprocal ? 1 / first : first * second, unit: 'ratio',
      hints: [reciprocal ? 'Reversing the comparison swaps numerator and denominator.' : 'Write out the two likelihood ratios and cancel the shared Model B term.', reciprocal ? 'Take the reciprocal.' : 'Multiply BF_AB by BF_BC.'],
      steps: [], explanation: reciprocal ? `BF_BA = 1 / BF_AB = 1 / ${first} = ${f(1 / first)}.` : `BF_AC = BF_AB × BF_BC = ${first} × ${second} = ${first * second}. The Model B likelihood cancels.`, source: book('22'),
    };
  }
  if (level === 'practice' && rng() < 0.45) {
    const cb = pick(rng, [0.25, 0.5, 2, 3, 4, 6]), ba = pick(rng, [0.25, 0.5, 2, 3, 4, 6]);
    const ca = cb * ba;
    return {
      title: 'Link and reverse model comparisons', context: `For the same observed data, BF_CB = ${cb} and BF_BA = ${ba}. BF_XY means P(data | X) / P(data | Y).`,
      prompt: 'What is BF_AC, the evidence for Model A relative to Model C?', answer: 1 / ca, unit: 'ratio',
      hints: ['Combine BF_CB and BF_BA to obtain BF_CA: the Model B likelihood cancels.', 'The requested comparison goes from A to C. Reverse BF_CA by taking its reciprocal.'],
      steps: [step('Bayes factor BF_CA', ca, 'BF_CA = BF_CB × BF_BA', `${cb} × ${ba} = ${f(ca)}`, 'ratio')],
      explanation: `BF_AC = 1 / BF_CA = 1 / (BF_CB × BF_BA) = 1 / (${cb} × ${ba}) = ${f(1 / ca)}. Both transitivity and reversal are needed.`, source: book('22'),
    };
  }
  if (level === 'practice') {
    const w = pick(rng, [0.2, 0.3, 0.4, 0.6, 0.7]), bf = pick(rng, [0.25, 0.5, 2, 3, 4, 6]);
    const priorOdds = w / (1 - w), odds = priorOdds * bf, answer = odds / (1 + odds);
    return {
      title: 'Evidence and posterior model probability', context: `Models A and B are mutually exclusive and exhaustive. P(A) = ${f(w)} before observing the data. The data yield BF_AB = ${bf}, meaning P(data | A) / P(data | B) = ${bf}.`,
      prompt: 'What is the posterior probability of Model A?', answer,
      hints: ['Convert the prior probability to odds A:B, then multiply by BF_AB.', 'Convert posterior odds O to a probability using O / (1 + O).'],
      steps: [step('Prior odds A:B', priorOdds, 'Prior odds = P(A) / P(B)', `${f(w)} / ${f(1 - w)} = ${f(priorOdds)}`, 'ratio'), step('Posterior odds A:B', odds, 'Posterior odds = prior odds × BF_AB', `${f(priorOdds)} × ${bf} = ${f(odds)}`, 'ratio')],
      explanation: `P(A | data) = posterior odds / (1 + posterior odds) = ${f(odds)} / (1 + ${f(odds)}) = ${f(answer)}. The Bayes factor updates the prior odds.`, source: book('3, 22'),
    };
  }
  const a = integer(rng, 1, 5), b = integer(rng, 1, 5), p = pick(rng, [0.3, 0.5, 0.7]);
  const s = integer(rng, 2, 5), fails = integer(rng, 1, 3);
  const alternative = betaSequence(a, b, s, fails), point = fixedSequence(p, s, fails), answer = alternative / point;
  return {
    title: 'Compare a point model with a beta model', context: `Model A fixes θ = ${p}. Model B assigns θ ~ Beta(${a}, ${b}). All trials share the same θ and are independent conditional on it. You observe a specified ordered sequence with ${s} successes and ${fails} failures.`,
    prompt: 'What is BF_BA, the evidence for Model B relative to Model A?', answer, unit: 'ratio',
    hints: ['Calculate the marginal probability of the whole observed sequence under each model.', 'Divide Model B’s integrated prediction by Model A’s fixed-rate prediction. Model prior probabilities are not part of this Bayes factor.'],
    steps: [step('Sequence probability under Model A', point, 'P(data | A) = p^s(1 − p)^f', `${p}^${s} × (1 − ${p})^${fails} = ${f(point)}`), step('Sequence probability under Model B', alternative, 'P(data | B) = B(a + s, b + f) / B(a, b)', `B(${a + s}, ${b + fails}) / B(${a}, ${b}) = ${betaProduct(a, b, s, fails)} = ${f(alternative)}`)],
    explanation: `BF_BA = P(data | B) / P(data | A) = ${f(alternative)} / ${f(point)} = ${f(answer)}. It compares predictions for the same ordered sequence.`, source: book('12, 17, 22'),
  };
}

const generators = { probability, bayes, sequences, beta, mixtures, prediction, 'bayes-factors': bayesFactors };
function validate(skillId, seed, difficulty) {
  if (!Object.hasOwn(generators, skillId)) throw new RangeError(`Unknown skill: ${skillId}`);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xFFFFFFFF) throw new RangeError('Seed must be a uint32 integer.');
  if (!difficulties.some(d => d.id === difficulty)) throw new RangeError(`Unknown difficulty: ${difficulty}`);
}
export function generateQuestion(skillId, seed, difficulty = 'practice') {
  validate(skillId, seed, difficulty);
  // A per-skill salt makes the same seed vary independently across skills.
  const salt = skills.findIndex(s => s.id === skillId) * 0x9E3779B9;
  return finish(skillId, seed, difficulty, generators[skillId](random((seed + salt) >>> 0), difficulty));
}

export function generateExam(seed, difficulty = 'practice') {
  validate('prediction', seed, difficulty);
  const rng = random(seed ^ 0xA51CE), ws = difficulty === 'foundation' ? [0.5, 0.5] : pick(rng, [[0.2, 0.3, 0.5], [0.25, 0.5, 0.25], [0.4, 0.35, 0.25]]);
  const models = [
    { name: 'Harbor workshop', type: 'fixed', weight: ws[0], p: pick(rng, [0.4, 0.5, 0.6, 0.7]) },
    { name: 'Garden workshop', type: 'beta', weight: ws[1], a: difficulty === 'foundation' ? 1 : integer(rng, 2, 5), b: difficulty === 'foundation' ? 1 : integer(rng, 2, 5) },
  ];
  if (difficulty !== 'foundation') models.push({ name: 'Meadow workshop', type: 'fixed', weight: ws[2], p: pick(rng, [0.2, 0.3, 0.5, 0.7, 0.8].filter(p => p !== models[0].p)) });
  const s = difficulty === 'foundation' ? 1 : integer(rng, 2, 4), fails = difficulty === 'foundation' ? 1 : integer(rng, 1, 3);
  const extraS = difficulty === 'challenge' ? 0 : 1, extraF = 1 - extraS;
  const post = updateModels(models, s, fails), extraPost = updateModels(models, s + extraS, fails + extraF);
  const next = predictModels(models, s, fails, 1, 0);
  const future = difficulty === 'challenge' ? 3 : 2;
  const joint = predictModels(models, s + extraS, fails + extraF, future, 0);
  const intro = `A box of toys comes from one of ${models.length === 2 ? 'two' : 'three'} workshops. Every toy in this exercise comes from that same workshop. A success means a toy passes inspection. Outcomes are independent conditional on the workshop’s fixed θ. At the Garden workshop, one shared unknown θ has the beta prior listed below. The first specified sequence contains ${s} successes and ${fails} failures.`;
  const later = `${intro} One additional toy then ${extraS ? 'passes' : 'fails'} inspection, giving ${s + extraS} successes and ${fails + extraF} failures in total.`;
  const common = { table: modelTable(models), source: book('7, 8, 9, 12, 22') };
  const items = [
    {
      ...common, title: '1. Identify the workshop', context: intro,
      prompt: 'After the first sequence, what is the probability that the box came from the Garden workshop?', answer: post[1].weight,
      hints: ['Calculate the sequence probability under each workshop.', 'Weight each likelihood by its prior model probability and normalize.'],
      steps: modelLikelihoodSteps(models, s, fails),
      explanation: `P(Garden | first sequence) = ${posteriorWorking(models, s, fails, 1)} = ${f(post[1].weight)}. Within Garden, the posterior is Beta(${post[1].a}, ${post[1].b}).`,
    },
    {
      ...common, title: '2. Predict the next inspection', context: intro,
      prompt: 'Given the first sequence, what is the probability that the next toy passes?', answer: next,
      hints: ['Use posterior workshop probabilities from the first sequence.', 'Garden’s next-pass probability uses its updated beta mean; the fixed workshop rates do not change.'],
      steps: [step('Posterior probability of Garden', post[1].weight, 'P(Garden | data) = prior × likelihood / marginal likelihood', `${posteriorWorking(models, s, fails, 1)} = ${f(post[1].weight)}`), step('Next-pass probability within Garden', post[1].a / (post[1].a + post[1].b), 'P(next success | Garden, data) = a′ / (a′ + b′)', `${post[1].a} / (${post[1].a} + ${post[1].b}) = ${f(post[1].a / (post[1].a + post[1].b))}`)],
      explanation: `P(next pass | first sequence) = ${mixtureWorking(post, post.map(m => likelihood(m, 1, 0)))} = ${f(next)}. Both the model weights and Garden’s parameter distribution reflect the first sequence.`,
    },
    {
      ...common, title: '3. Update after another observation', context: later,
      prompt: 'What is the updated probability that the box came from the Garden workshop?', answer: extraPost[1].weight,
      hints: ['Use the previous posterior as the prior for this new observation.', 'Predict the new outcome within each updated workshop model, then normalize their weighted predictions.'],
      steps: post.map(m => step(`Probability of the additional ${extraS ? 'pass' : 'failure'} under ${m.name}`, likelihood(m, extraS, extraF), 'Use the posterior predictive probability within this model', `${sequenceWorking(m, extraS, extraF)} = ${f(likelihood(m, extraS, extraF))}`)),
      explanation: `P(Garden | all observations) = ${f(post[1].weight)} × ${f(likelihood(post[1], extraS, extraF))} / (${mixtureWorking(post, post.map(m => likelihood(m, extraS, extraF)))}) = ${f(extraPost[1].weight)}. Equivalently update the original priors with all ${s + extraS} successes and ${fails + extraF} failures.`,
    },
    {
      ...common, title: '4. Predict within the uncertain-rate model', context: later,
      prompt: 'Conditional on the box coming from Garden, what is the probability that the next toy passes?', answer: extraPost[1].a / (extraPost[1].a + extraPost[1].b),
      hints: ['Conditioning on Garden removes the need to average across workshops.', 'Add all successes and failures to Garden’s original beta parameters, then use its posterior mean.'],
      steps: [step('Garden’s updated success parameter', extraPost[1].a, 'a′ = a + all successes', `${models[1].a} + ${s + extraS} = ${extraPost[1].a}`, 'number'), step('Garden’s updated failure parameter', extraPost[1].b, 'b′ = b + all failures', `${models[1].b} + ${fails + extraF} = ${extraPost[1].b}`, 'number')],
      explanation: `Garden now has Beta(${extraPost[1].a}, ${extraPost[1].b}), so P(next pass | Garden, all data) = ${extraPost[1].a} / (${extraPost[1].a} + ${extraPost[1].b}) = ${f(extraPost[1].a / (extraPost[1].a + extraPost[1].b))}.`,
    },
    {
      ...common, title: '5. Predict several future inspections', context: later,
      prompt: `Allowing for all ${models.length} possible workshops, what is the probability that all of the next ${future} toys pass?`, answer: joint,
      hints: ['Within each workshop, calculate the joint probability of all future passes.', 'Average those joint probabilities using the latest posterior workshop weights. Do not raise the overall next-pass probability to a power.'],
      steps: extraPost.map(m => step(`Probability of ${future} future passes under ${m.name}`, likelihood(m, future, 0), m.type === 'fixed' ? 'P(all pass | θ) = θ^m' : 'P(all pass | updated beta) = B(a′ + m, b′) / B(a′, b′)', `${sequenceWorking(m, future, 0)} = ${f(likelihood(m, future, 0))}`)),
      explanation: `Posterior workshop weights are ${extraPost.map(m => `${m.name}: ${f(m.weight)}`).join(', ')}. Garden’s joint prediction is ${betaProduct(extraPost[1].a, extraPost[1].b, future, 0)} = ${f(likelihood(extraPost[1], future, 0))}. P(all ${future} pass | all data) = ${mixtureWorking(extraPost, extraPost.map(m => likelihood(m, future, 0)))} = ${f(joint)}. Each beta predictive factor updates after the preceding success; future outcomes share the same workshop and rate.`,
    },
  ];
  return items.map((item, i) => finish('prediction', seed, difficulty, item, `-exam-${i + 1}`));
}
