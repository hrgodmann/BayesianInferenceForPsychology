import { choose, fixedSequence, betaSequence, betaCount, updateModels, predictModels } from './math.js';
import { contextualizeQuestion } from './contexts.js';
import { contextualizeExam } from './exam-contexts.js';

export const GENERATOR_VERSION = 6;
export const skills = [
  { id: 'probability', title: 'Probability rules', description: 'Work with conditional and combined probabilities.', icon: 'tree' },
  { id: 'bayes', title: 'Bayes’ rule', description: 'Update which explanation is most likely.', icon: 'cycle' },
  { id: 'sequences', title: 'Sequences & counts', description: 'Calculate ordered outcomes and success counts.', icon: 'measure' },
  { id: 'beta', title: 'Learning a proportion', description: 'Update beta distributions and predict outcomes.', icon: 'uncertainty' },
  { id: 'mixtures', title: 'Combining predictions', description: 'Average predictions across competing models.', icon: 'balance' },
  { id: 'prediction', title: 'Predicting observations', description: 'Use what you have learned to predict what comes next.', icon: 'mind' },
  { id: 'bayes-factors', title: 'Bayes factors & odds', description: 'Compare predictions and update model odds.', icon: 'balance' },
];
// Mulberry32 keeps generated questions deterministic for verification.
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
// Presentation metadata (solution and numberFormat) never changes a generated
// answer, its grading precision, or the random stream. Keep the legacy fields
// available for independent regression comparisons and instructor audits.
const precision = value => {
  let places = value > 0 && (value < 0.01 || value > 0.99 && value < 1) ? 4 : 2;
  // Preserve the distinction between a small probability and impossibility,
  // and between a near-certain prediction and certainty.
  while (value > 0 && value < 1 && places < 8) {
    const rounded = Math.round(value * 10 ** places) / 10 ** places;
    if (rounded > 0 && rounded < 1) break;
    places += 2;
  }
  return places;
};
const step = (prompt, answer, formula, working, unit = 'probability', numberFormat) => ({
  prompt, answer, unit, decimals: precision(answer), formula, working,
  ...(numberFormat ? { numberFormat } : {}),
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
function finish(skillId, seed, item, suffix = '') {
  return {
    id: `v${GENERATOR_VERSION}-${skillId}-${seed >>> 0}${suffix}`, seed: seed >>> 0,
    skillId, unit: 'probability', decimals: precision(item.answer), ...item,
  };
}

// Apply count grammar after the story's vocabulary is chosen. Only visible
// text is visited; numeric answers, seeds, and source records are untouched.
function polishQuestion(question) {
  const polish = value => {
    if (typeof value === 'string') return value
      .replace(/\b1 successes\b/g, '1 success')
      .replace(/\b1 failures\b/g, '1 failure')
      .replace(/\b1 detections\b/g, '1 detection')
      .replace(/\b(1 of (?:the first )?\d+ (?:seeds|trials)) (fail to germinate|germinate|fail|succeed)\b/g,
        (_, subject, verb) => `${subject} ${{ 'fail to germinate': 'fails to germinate', germinate: 'germinates', fail: 'fails', succeed: 'succeeds' }[verb]}`);
    if (Array.isArray(value)) return value.map(polish);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, polish(item)]));
    return value;
  };
  return { ...question, ...Object.fromEntries(['title', 'context', 'prompt', 'table', 'hints', 'steps', 'explanation', 'solution']
    .filter(key => key in question).map(key => [key, polish(question[key])])) };
}

function probability(rng) {
  const variant = pick(rng, ['total', 'total', 'conditional', 'union']);
  if (variant === 'conditional' || variant === 'union') {
    // Construct disjoint cells first, so all displayed margins and overlaps
    // describe a possible population without assuming independence.
    const both = integer(rng, 5, 25), artOnly = integer(rng, 10, 30), musicOnly = integer(rng, 10, 30);
    const neither = 100 - both - artOnly - musicOnly;
    if (variant === 'conditional') {
      const givenMusic = rng() < 0.5;
      const given = givenMusic ? 'music' : 'art', target = givenMusic ? 'art' : 'music';
      const denominator = both + (givenMusic ? musicOnly : artOnly);
      return {
        title: 'Condition on a group',
        context: 'The table counts 100 visitors by the activities they attended. A visitor can attend both art and music, one activity, or neither. Select one visitor at random.',
        table: { headers: ['Visitors', 'Music', 'No music'], rows: [['Art', both, artOnly], ['No art', musicOnly, neither]] },
        prompt: `Given that the visitor attended ${given}, what is the probability that they also attended ${target}?`,
        answer: both / denominator,
        hints: [`Restrict the sample space to visitors who attended ${given}.`, `P(${target} | ${given}) = P(${target} and ${given}) / P(${given}). Count the visitors in both activities and divide by the total in the conditioning group.`],
        steps: [step(`Number of visitors who attended ${given}`, denominator, 'Conditioning group = both activities + only the given activity', `${both} + ${givenMusic ? musicOnly : artOnly} = ${denominator}`, 'number', 'integer')],
        explanation: `There are ${denominator} visitors in the ${given} group, and ${both} of them also attended ${target}. P(${target} | ${given}) = (${both}/100) / (${denominator}/100) = ${both}/${denominator} = ${f(both / denominator)}. The denominator counts the given group, not all 100 visitors.`,
        solution: {
          formula: `P(${target} | ${given}) = P(${target} and ${given}) / P(${given})`,
          working: `(${both}/100) / (${denominator}/100) = ${both}/${denominator} = ${f(both / denominator)}`,
          interpretation: `Among the ${denominator} visitors who attended ${given}, ${both} also attended ${target}. The denominator counts the given group, not all 100 visitors.`,
        },
        source: book('3'),
      };
    }
    const a = (both + artOnly) / 100, b = (both + musicOnly) / 100, intersection = both / 100;
    const answer = (both + artOnly + musicOnly) / 100;
    return {
      title: 'Allow for overlapping events',
      context: 'Select one visitor at random. A means that the visitor attended art; B means that they attended music. The activities can overlap.',
      table: { headers: ['Event', 'Probability'], rows: [['Art: P(A)', f(a)], ['Music: P(B)', f(b)], ['Both: P(A ∩ B)', f(intersection)]] },
      prompt: 'What is the probability that the visitor attended art or music, including visitors who attended both?',
      answer,
      hints: ['Adding P(A) and P(B) counts visitors in both activities twice.', 'Use P(A ∪ B) = P(A) + P(B) − P(A ∩ B).'],
      steps: [step('Sum before removing the double-counted overlap', a + b, 'P(A) + P(B)', `${f(a)} + ${f(b)} = ${f(a + b)}`, 'number')],
      explanation: `P(A ∪ B) = ${f(a)} + ${f(b)} − ${f(intersection)} = ${f(answer)}. Subtract the overlap once so visitors who attended both are counted once. “Or” includes both; independence is not assumed.`,
      solution: {
        formula: 'P(A ∪ B) = P(A) + P(B) − P(A ∩ B)',
        working: `${f(a)} + ${f(b)} − ${f(intersection)} = ${f(answer)}`,
        interpretation: 'Subtract the overlap once so visitors who attended both art and music are counted once. “Or” includes both; independence is not assumed.',
      },
      source: book('3'),
    };
  }
  const backwards = rng() < 1 / 3;
  const three = backwards || rng() < 0.5;
  const groupNames = three ? ['Morning', 'Afternoon', 'Evening'] : ['Morning', 'Afternoon'];
  const ws = three ? pick(rng, [[0.2, 0.3, 0.5], [0.4, 0.35, 0.25], [0.3, 0.2, 0.5]]) : weights(rng);
  const ps = groupNames.map(() => rate(rng));
  const total = ws.reduce((sum, w, i) => sum + w * ps[i], 0);
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
    solution: backwards ? {
      formula: 'P(success | Morning) = [P(success) − known contribution] / P(Morning)',
      working: `(${f(total)} − ${f(known)}) / ${f(ws[0])} = ${f(ps[0])}`,
      interpretation: `The other sessions contribute ${f(known)} to the overall success probability. The remaining contribution belongs to Morning; divide by its probability to recover its conditional success rate.`,
    } : {
      formula: 'P(success) = Σ P(session)P(success | session)',
      working: `${ws.map((w, i) => `${f(w)} × ${f(ps[i])}`).join(' + ')} = ${f(total)}`,
      interpretation: 'Each visitor belongs to exactly one session, so these weighted success probabilities can be added.',
    },
    source: book('3'),
  };
}

function generalLaw(rng, posterior) {
  const scenario = pick(rng, ['uniform-equal', 'uniform-unequal', 'beta']);
  const a = scenario === 'beta' ? integer(rng, 2, 5) : 1;
  const b = scenario === 'beta' ? integer(rng, 1, 5) : 1;
  const weight = scenario === 'uniform-equal' ? 0.5 : pick(rng, [0.2, 0.3, 0.6, 0.75]);
  const s = integer(rng, 2, 7), fails = rng() < 0.2 ? 1 : 0;
  const models = [
    { name: 'Law H_L', type: 'fixed', weight, p: 1 },
    { name: 'Beta alternative H_B', type: 'beta', weight: 1 - weight, a, b },
  ];
  const lawLikelihood = fails ? 0 : 1, betaLikelihood = betaSequence(a, b, s, fails);
  const bf = lawLikelihood / betaLikelihood, priorOdds = weight / (1 - weight);
  const posteriorOdds = priorOdds * bf, answer = posterior ? posteriorOdds / (1 + posteriorOdds) : bf;
  const sequence = [...Array(s).fill('S'), ...Array(fails).fill('F')].join(', ');
  const lawWorking = fails ? `1^${s} × (1 − 1)^${fails} = 0` : `1^${s} = 1`;
  const likelihoodSteps = [
    step('Probability of the observed sequence under H_L', lawLikelihood, 'P(D | H_L) = 1 for all successes; 0 if any failure occurs', lawWorking),
    step('Probability of the observed sequence under H_B', betaLikelihood, 'P(D | H_B) = B(a + s, b + f) / B(a, b)', `${betaProduct(a, b, s, fails)} = ${f(betaLikelihood)}`),
  ];
  const evidenceWorking = `BF_LB = P(D | H_L) / P(D | H_B) = ${lawLikelihood} / ${f(betaLikelihood)} = ${f(bf)}.`;
  return {
    title: posterior ? 'Posterior probability of a general law' : 'Evidence for a general law',
    context: `A proposed general law says an automated process always succeeds (H_L: θ = 1). The alternative H_B allows an uncertain success rate. These are the only two models considered. Under either model, all trials share the same θ and are independent conditional on it. Outcomes are recorded without measurement error. You observe one ordered sequence D with ${s} successes and ${fails} ${fails === 1 ? 'failure' : 'failures'}: (${sequence}), where S means success and F means failure.`,
    table: posterior ? modelTable(models) : { headers: ['Model', 'Success rate'], rows: models.map(m => [m.name, modelText(m)]) },
    prompt: posterior ? 'What is P(H_L | D), the posterior probability that the general law holds?' : 'What is BF_LB, the evidence for the general law H_L relative to the beta alternative H_B?',
    answer, unit: posterior ? 'probability' : 'ratio',
    hints: ['Calculate the probability of the whole observed sequence under each model. Under θ = 1, a single failure makes the sequence impossible.', posterior ? 'Divide the sequence probabilities to find BF_LB, multiply the prior odds by this Bayes factor, then convert posterior odds to a probability.' : 'Divide P(D | H_L) by P(D | H_B). Model prior probabilities do not enter a Bayes factor.'],
    steps: posterior ? [...likelihoodSteps,
      step('Bayes factor BF_LB', bf, 'BF_LB = P(D | H_L) / P(D | H_B)', `${lawLikelihood} / ${f(betaLikelihood)} = ${f(bf)}`, 'ratio'),
      step('Posterior odds H_L:H_B', posteriorOdds, 'Posterior odds = [P(H_L) / P(H_B)] × BF_LB', `[${f(weight)} / ${f(1 - weight)}] × ${f(bf)} = ${f(posteriorOdds)}`, 'ratio'),
    ] : likelihoodSteps,
    explanation: `${evidenceWorking} ${posterior ? `Prior odds H_L:H_B = ${f(weight)} / ${f(1 - weight)} = ${f(priorOdds)}. Posterior odds = ${f(priorOdds)} × ${f(bf)} = ${f(posteriorOdds)}. P(H_L | D) = ${f(posteriorOdds)} / (1 + ${f(posteriorOdds)}) = ${f(answer)}. This is the probability that θ is exactly 1, not the probability that the next trial succeeds.` : `This compares how well the two models predict the observed sequence; it is neither a posterior model probability nor a next-success probability.`}${fails ? ' A failure rules out this error-free general law, while remaining possible under the beta alternative.' : a === 1 && b === 1 ? ` With a uniform beta alternative and ${s} successes, BF_LB = ${s} + 1 = ${s + 1}.` : ''}`,
    solution: {
      formula: posterior ? 'P(H_L | D) = posterior odds / (1 + posterior odds)' : 'BF_LB = P(D | H_L) / P(D | H_B)',
      working: posterior
        ? `${f(posteriorOdds)} / (1 + ${f(posteriorOdds)}) = ${f(answer)}`
        : `${lawLikelihood} / [${betaProduct(a, b, s, fails)}] = ${f(bf)}`,
      interpretation: `${posterior ? 'This is the posterior probability that θ is exactly 1, not the probability that the next trial succeeds. The prior odds are updated by the Bayes factor.' : 'This compares how well the two models predict the observed sequence; it is neither a posterior model probability nor a next-success probability. Model prior probabilities do not enter this ratio.'}${fails ? ' A failure rules out this error-free general law, while remaining possible under the beta alternative.' : a === 1 && b === 1 ? ` With a uniform beta alternative and ${s} successes, the Bayes factor is ${s + 1}.` : ''}`,
    },
    source: book('14, 15, 22'),
  };
}

function sequentialEvidence(rng, total) {
  const a = integer(rng, 1, 5), b = integer(rng, 1, 5);
  const alternatives = Array.from({ length: 25 }, (_, i) => ({ a: 1 + Math.floor(i / 5), b: 1 + i % 5 }))
    .filter(model => model.a !== a || model.b !== b);
  const other = pick(rng, alternatives);
  const models = [{ name: 'Model A', a, b }, { name: 'Model B', ...other }];
  const s1 = integer(rng, 1, 3), f1 = integer(rng, 0, 2);
  const s2 = integer(rng, 1, 3), f2 = integer(rng, 0, 2);
  const first = models.map(m => betaSequence(m.a, m.b, s1, f1));
  const updated = models.map(m => ({ ...m, a: m.a + s1, b: m.b + f1 }));
  const second = updated.map(m => betaSequence(m.a, m.b, s2, f2));
  const firstBF = first[0] / first[1], secondBF = second[0] / second[1];
  const answer = total ? firstBF * secondBF : secondBF;
  const sequence = (s, fails) => [...Array(s).fill('S'), ...Array(fails).fill('F')].join(', ');
  const secondSteps = updated.map((m, i) => step(`Probability of D2 given D1 under ${m.name}`, second[i],
    'P(D2 | D1, model) = B(a + s1 + s2, b + f1 + f2) / B(a + s1, b + f1)',
    `${betaProduct(m.a, m.b, s2, f2)} = ${f(second[i])}`));
  return {
    title: total ? 'Combine evidence across two batches' : 'Evidence from a second batch',
    context: `Two models describe one unknown success rate θ. Under either model, every trial in both batches shares this same θ and is independent conditional on it. The table gives the parameter priors before either batch. The first ordered batch is D1 = (${sequence(s1, f1)}). The second ordered batch is D2 = (${sequence(s2, f2)}). S means success and F means failure. D2 contains new observations collected after D1. BF_AB compares Model A with Model B.`,
    table: { headers: ['Model', 'Prior for θ'], rows: models.map(m => [m.name, `Beta(${m.a}, ${m.b})`]) },
    prompt: total ? 'What is BF_AB(D1, D2), the total evidence for Model A relative to Model B from both batches?' : 'What is BF_AB(D2 | D1), the additional evidence for Model A relative to Model B from the second batch?',
    answer, unit: 'ratio',
    hints: ['First update each model’s beta parameters with the successes and failures in D1. Use these updated distributions to predict the whole ordered sequence D2.', total ? 'Multiply BF_AB(D1) by BF_AB(D2 | D1). Do not predict the second batch using the original parameter priors.' : 'Divide P(D2 | D1, Model A) by P(D2 | D1, Model B). D1 has already been learned from; do not count its evidence a second time.'],
    steps: total ? [step('Bayes factor from the first batch, BF_AB(D1)', firstBF,
      'BF_AB(D1) = P(D1 | A) / P(D1 | B)',
      `[${betaProduct(a, b, s1, f1)}] / [${betaProduct(other.a, other.b, s1, f1)}] = ${f(first[0])} / ${f(first[1])} = ${f(firstBF)}`, 'ratio'), ...secondSteps] : secondSteps,
    explanation: `D1 contains ${s1} ${s1 === 1 ? 'success' : 'successes'} and ${f1} ${f1 === 1 ? 'failure' : 'failures'}. The updated parameter distributions are ${updated.map((m, i) => `${m.name}: Beta(${models[i].a} + ${s1}, ${models[i].b} + ${f1}) = Beta(${m.a}, ${m.b})`).join('; ')}. ${updated.map((m, i) => `P(D2 | D1, ${m.name}) = ${betaProduct(m.a, m.b, s2, f2)} = ${f(second[i])}.`).join(' ')} BF_AB(D2 | D1) = ${f(second[0])} / ${f(second[1])} = ${f(secondBF)}.${total ? ` BF_AB(D1) = ${f(first[0])} / ${f(first[1])} = ${f(firstBF)}. BF_AB(D1, D2) = BF_AB(D1) × BF_AB(D2 | D1) = ${f(firstBF)} × ${f(secondBF)} = ${f(answer)}.` : ' This is only the evidence contributed by D2 after learning from D1.'} Conditional independence given θ does not make the two batches marginally independent when θ is uncertain.`,
    solution: {
      formula: total ? 'BF_AB(D1, D2) = BF_AB(D1) × BF_AB(D2 | D1)' : 'BF_AB(D2 | D1) = P(D2 | D1, A) / P(D2 | D1, B)',
      working: total
        ? `${f(firstBF)} × (${f(second[0])} / ${f(second[1])}) = ${f(firstBF)} × ${f(secondBF)} = ${f(answer)}`
        : `${f(second[0])} / ${f(second[1])} = ${f(secondBF)}`,
      interpretation: `After D1, the parameter distributions are ${updated.map(m => `${m.name}: Beta(${m.a}, ${m.b})`).join('; ')}. Predict D2 using these updated distributions.${total ? ' Multiply the first-batch Bayes factor by this conditional second-batch Bayes factor to combine the evidence.' : ' This ratio measures only the additional evidence from D2; do not count D1 a second time.'} Conditional independence given θ does not make the batches marginally independent when θ is uncertain.`,
    },
    source: book('13, 15, 22'),
  };
}

function bayes(rng) {
  if (rng() < 0.25) return generalLaw(rng, true);
  const ws = rng() < 1 / 3 ? [0.2, 0.3, 0.5] : weights(rng);
  const models = ws.map((weight, i) => ({ name: `Machine ${String.fromCharCode(65 + i)}`, type: 'fixed', weight, p: rate(rng) }));
  const observation = pick(rng, ['success', 'failure', 'two-successes', 'mixed']);
  const failures = observation === 'failure' || observation === 'mixed' ? 1 : 0;
  const successes = observation === 'failure' ? 0 : observation === 'two-successes' ? 2 : 1;
  const event = successes && failures ? 'a passed inspection followed by a failed inspection' : failures ? 'a failed inspection' : successes === 1 ? 'a passed inspection' : 'two passed inspections in a row';
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
    solution: {
      formula: 'P(A | data) = P(A)P(data | A) / P(data)',
      working: `${posteriorWorking(models, successes, failures)} = ${f(updated[0].weight)}`,
      interpretation: 'Divide Machine A’s weighted likelihood by the total weighted likelihood across every possible machine. This normalizes the posterior probabilities to sum to one.',
    },
    source: book('3, 7'),
  };
}

function sequences(rng) {
  const p = rate(rng), n = integer(rng, 4, 7), k = integer(rng, 1, n - 1);
  const variant = pick(rng, ['sequence', 'count', 'tail']);
  const ordered = variant === 'sequence', tail = variant === 'tail';
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
      step('Number of possible orders', choose(n, k), 'C(n, k) = n! / [k!(n − k)!]', `C(${n}, ${k}) = ${choose(n, k)}`, 'number', 'integer'),
      step('Probability of one specified order', oneOrder, 'P(sequence) = p^k(1 − p)^(n − k)', `${f(p)}^${k} × (1 − ${f(p)})^${n - k} = ${f(oneOrder)}`),
    ],
    explanation: tail ? `P(at least 2) = 1 − (1 − ${f(p)})^${n} − ${n} × ${f(p)} × (1 − ${f(p)})^${n - 1} = ${f(answer)}.` : `P(${ordered ? 'this sequence' : 'this count'}) = ${ordered ? '' : `${choose(n, k)} × `}${f(p)}^${k} × (1 − ${f(p)})^${n - k} = ${f(answer)}. ${ordered ? 'A single specified order has no counting factor.' : 'All orders with these counts have equal probability and are mutually exclusive.'}`,
    solution: {
      formula: tail ? 'P(K ≥ 2) = 1 − P(K = 0) − P(K = 1)' : ordered ? 'P(sequence) = p^k(1 − p)^(n − k)' : 'P(K = k) = C(n, k)p^k(1 − p)^(n − k)',
      working: tail
        ? `1 − (1 − ${f(p)})^${n} − ${n} × ${f(p)} × (1 − ${f(p)})^${n - 1} = ${f(answer)}`
        : `${ordered ? '' : `C(${n}, ${k}) × `}${f(p)}^${k} × (1 − ${f(p)})^${n - k} = ${f(answer)}`,
      interpretation: tail ? 'Zero detections, exactly one detection, and at least two detections exhaust the possibilities. Subtracting the first two probabilities leaves the requested event.' : ordered ? 'Only one specified order is requested, so no binomial coefficient is needed. Multiply the success and failure probabilities for those positions.' : 'All orders with these counts have equal probability and are mutually exclusive. Multiply one ordered-sequence probability by the number of orders.',
    },
    source: book('3, 7, 34'),
  };
}

function beta(rng) {
  const variant = pick(rng, ['update', 'laplace', 'prior-count', 'posterior-count', 'mean']);
  const a = integer(rng, 1, 6), b = integer(rng, 1, 6);
  const s = integer(rng, 2, 7), fails = variant === 'laplace' && rng() < 0.5 ? 0 : integer(rng, 1, 4);
  const askSuccessParameter = rng() < 0.5;
  if (variant === 'mean') return {
    title: 'Estimate the success rate',
    context: `A plant nursery models a shared germination rate as θ ~ Beta(${a}, ${b}) before observing any seeds. Germination outcomes are independent conditional on θ. You have observed ${s} successes and ${fails} failures.`,
    prompt: 'What is the posterior mean of the germination rate θ?',
    answer: (a + s) / (a + b + s + fails),
    hints: ['Update the beta distribution by adding successes to a and failures to b.', 'The mean of Beta(a′, b′) is a′ / (a′ + b′). Use both prior information and the observations.'],
    steps: [
      step('Posterior success parameter a′', a + s, 'a′ = a + successes', `${a} + ${s} = ${a + s}`, 'number', 'integer'),
      step('Posterior failure parameter b′', b + fails, 'b′ = b + failures', `${b} + ${fails} = ${b + fails}`, 'number', 'integer'),
    ],
    explanation: `The posterior is Beta(${a + s}, ${b + fails}). Its mean is E(θ | data) = (${a} + ${s}) / (${a} + ${b} + ${s} + ${fails}) = ${f((a + s) / (a + b + s + fails))}. This is an estimate of the underlying rate. In this Bernoulli model it also equals the probability of success on the next trial; it is not the probability that θ equals this exact value.`,
    solution: {
      formula: 'E(θ | data) = (a + s) / (a + b + s + f)',
      working: `(${a} + ${s}) / (${a} + ${b} + ${s} + ${fails}) = ${f((a + s) / (a + b + s + fails))}`,
      interpretation: `The posterior is Beta(${a + s}, ${b + fails}). Its mean estimates the underlying rate. In this Bernoulli model it also equals the next-success probability; it is not the probability that θ equals this exact value.`,
    },
    source: book('8, 9'),
  };
  if (variant === 'update') return {
    title: 'Update a beta distribution', context: `A plant nursery models the germination rate as θ ~ Beta(${a}, ${b}). Seeds germinate independently conditional on the same θ.`,
    prompt: askSuccessParameter ? `${fails} of ${s + fails} seeds fail to germinate. What is the updated first parameter a′ in Beta(a′, b′)?` : `${s} of ${s + fails} seeds germinate. What is the updated second parameter b′ in Beta(a′, b′)?`, answer: askSuccessParameter ? a + s : b + fails, unit: 'number', numberFormat: 'integer',
    hints: [askSuccessParameter ? 'Subtract the failed seeds from the total to find the successes.' : 'Count the seeds that failed to germinate.', 'A beta posterior adds successes to a and failures to b.'],
    steps: [askSuccessParameter ? step('Number of successes', s, 'Successes = total − failures', `${s + fails} − ${fails} = ${s}`, 'number', 'integer') : step('Number of failures', fails, 'Failures = total − successes', `${s + fails} − ${s} = ${fails}`, 'number', 'integer')],
    explanation: `Beta(a + successes, b + failures) = Beta(${a} + ${s}, ${b} + ${fails}) = Beta(${a + s}, ${b + fails}). Therefore ${askSuccessParameter ? `a′ = ${a + s}` : `b′ = ${b + fails}`}.`, source: book('8'),
    solution: {
      formula: askSuccessParameter ? 'a′ = a + successes' : 'b′ = b + failures',
      working: askSuccessParameter ? `${a} + ${s} = ${a + s}` : `${b} + ${fails} = ${b + fails}`,
      interpretation: `Add the ${s} successes to the first parameter and the ${fails} failures to the second. The updated distribution is Beta(${a + s}, ${b + fails}).`,
    },
  };
  if (variant === 'laplace') return {
    title: 'Laplace’s rule of succession', context: 'A uniform Beta(1, 1) prior describes an unknown success rate. All trials share this same rate and are independent conditional on it.',
    prompt: `You observe ${s} successes and ${fails} failures. What is the probability that the next trial succeeds?`, answer: (s + 1) / (s + fails + 2),
    hints: ['Update the uniform prior to Beta(1 + successes, 1 + failures).', 'For Beta(a′, b′), the next-success probability is a′ / (a′ + b′).'],
    steps: [step('Updated success parameter a′', s + 1, 'a′ = 1 + successes', `1 + ${s} = ${s + 1}`, 'number', 'integer'), step('Sum of posterior parameters', s + fails + 2, 'a′ + b′ = successes + failures + 2', `${s} + ${fails} + 2 = ${s + fails + 2}`, 'number', 'integer')],
    explanation: `P(next success | data) = (${s} + 1) / (${s} + ${fails} + 2) = ${f((s + 1) / (s + fails + 2))}. This is Laplace’s rule with both successes and failures.`, source: book('8, 9'),
    solution: {
      formula: 'P(next success | data) = (s + 1) / (s + f + 2)',
      working: `(${s} + 1) / (${s} + ${fails} + 2) = ${f((s + 1) / (s + fails + 2))}`,
      interpretation: `The uniform prior updates to Beta(${s + 1}, ${fails + 1}). Its mean gives Laplace’s next-success probability, accounting for both successes and failures.`,
    },
  };
  const posterior = variant === 'posterior-count', n = integer(rng, 3, 5), k = integer(rng, 1, n);
  const aa = a + (posterior ? s : 0), bb = b + (posterior ? fails : 0);
  const answer = betaCount(aa, bb, n, k);
  return {
    title: posterior ? 'Predict a future count after learning' : 'Predict a count from a beta prior',
    context: `The success rate has prior θ ~ Beta(${a}, ${b}). All observations use the same θ and are independent conditional on it.${posterior ? ` You have observed ${s} successes and ${fails} failures.` : ' No observations have been collected yet.'}`,
    prompt: `What is the probability of exactly ${k} successes in the next ${n} trials, in any order?`, answer,
    hints: [posterior ? 'Update both beta parameters before making the prediction.' : 'Average the binomial probability across the whole beta prior.', 'Use C(n, k) × B(a′ + k, b′ + n − k) / B(a′, b′); do not substitute only the mean success rate.'],
    steps: posterior ? [
      step('Posterior success parameter a′', aa, 'a′ = a + successes', `${a} + ${s} = ${aa}`, 'number', 'integer'),
      step('Posterior failure parameter b′', bb, 'b′ = b + failures', `${b} + ${fails} = ${bb}`, 'number', 'integer'),
      step('Number of possible future orders', choose(n, k), 'C(n, k)', `C(${n}, ${k}) = ${choose(n, k)}`, 'number', 'integer'),
    ] : [step('Number of possible orders', choose(n, k), 'C(n, k)', `C(${n}, ${k}) = ${choose(n, k)}`, 'number', 'integer'), step('Probability of one specified order', betaSequence(a, b, k, n - k), 'B(a + k, b + n − k) / B(a, b)', `B(${a + k}, ${b + n - k}) / B(${a}, ${b}) = ${betaProduct(a, b, k, n - k)} = ${f(betaSequence(a, b, k, n - k))}`)],
    explanation: `P(K = ${k}) = C(${n}, ${k}) × B(${aa + k}, ${bb + n - k}) / B(${aa}, ${bb}) = ${choose(n, k)} × [${betaProduct(aa, bb, k, n - k)}] = ${f(answer)}. ${posterior ? `The updated distribution is Beta(${aa}, ${bb}).` : 'This prediction includes uncertainty about θ.'} Each predictive factor uses the beta parameters updated by the preceding outcomes.`, source: book('8, 9, 12'),
    solution: {
      formula: posterior ? 'P(K = k | data) = C(n, k)B(a′ + k, b′ + n − k) / B(a′, b′)' : 'P(K = k) = C(n, k)B(a + k, b + n − k) / B(a, b)',
      working: `C(${n}, ${k}) × B(${aa + k}, ${bb + n - k}) / B(${aa}, ${bb}) = ${choose(n, k)} × [${betaProduct(aa, bb, k, n - k)}] = ${f(answer)}`,
      interpretation: `${posterior ? `Use the updated distribution Beta(${aa}, ${bb}) to predict the future count.` : 'Average over the whole beta prior to include uncertainty about θ.'} Each predictive factor updates after the preceding outcome. Multiply by the number of possible orders; substituting only the beta mean would omit uncertainty about θ.`,
    },
  };
}

function mixtures(rng) {
  const variant = pick(rng, ['spike-uniform', 'two-models', 'three-models']);
  const spike = variant === 'spike-uniform';
  const ws = spike ? [0.5, 0.5] : weights(rng);
  const models = [
    { name: 'Model A', type: 'fixed', weight: ws[0], p: spike ? 1 : rate(rng) },
    { name: 'Model B', type: 'beta', weight: ws[1], a: spike ? 1 : integer(rng, 1, 6), b: spike ? 1 : integer(rng, 1, 6) },
  ];
  if (variant === 'three-models') {
    models[0].weight = 0.3; models[1].weight = 0.4;
    models.push({ name: 'Model C', type: 'beta', weight: 0.3, a: integer(rng, 2, 7), b: integer(rng, 2, 7) });
  }
  const n = integer(rng, 2, 5), k = spike ? n : integer(rng, 1, n - 1);
  const values = models.map(m => choose(n, k) * likelihood(m, k, n - k));
  const answer = values.reduce((sum, v, i) => sum + models[i].weight * v, 0);
  return {
    title: 'Combine prior predictions', context: 'These are competing models of a seed variety’s germination rate. One model describes the entire batch. Under each model, all seeds share the same θ and are independent conditional on it. A beta prior describes uncertainty about that shared rate. No data have been observed.',
    table: modelTable(models), prompt: `What is the overall prior predictive probability that exactly ${k} of the first ${n} seeds germinate, in any order?`, answer,
    hints: ['First calculate the event probability separately under each model.', 'Weight those predictions by the prior model probabilities and add them.'],
    steps: models.map((m, i) => step(`Predictive probability under ${m.name}`, values[i], m.type === 'fixed' ? 'P(K = k) = C(n, k)p^k(1 − p)^(n − k)' : 'P(K = k) = C(n, k)B(a + k, b + n − k) / B(a, b)', `${choose(n, k)} × ${sequenceWorking(m, k, n - k)} = ${f(values[i])}`)),
    explanation: `P(data) = Σ P(model)P(data | model) = ${mixtureWorking(models, values)} = ${f(answer)}. Use prior model weights because no data have yet been observed.`, source: book('12, 15, 22'),
    solution: {
      formula: 'P(K = k) = Σ P(model)P(K = k | model)',
      working: `${mixtureWorking(models, values)} = ${f(answer)}`,
      interpretation: 'Average the whole count prediction from each competing model. Use prior model weights because no data have been observed. One model and one shared rate describe the entire batch.',
    },
  };
}

function forecasterPrediction(rng) {
  const number = pick(rng, [2, 3]);
  const ws = number === 2 ? weights(rng) : pick(rng, [[0.2, 0.3, 0.5], [0.25, 0.5, 0.25], [0.4, 0.4, 0.2]]);
  const priors = [[1, 1], [2, 5], [5, 2], [4, 4], [2, 2], [1, 4], [4, 1], [6, 3]];
  const models = ws.map((weight, i) => {
    const [a, b] = priors.splice(integer(rng, 0, priors.length - 1), 1)[0];
    return { name: `Forecaster ${String.fromCharCode(65 + i)}`, type: 'beta', weight, a, b };
  });
  const s = integer(rng, 1, 4), fails = integer(rng, 0, 3);
  const post = updateModels(models, s, fails);
  const predictions = post.map(m => m.a / (m.a + m.b));
  const answer = post.reduce((total, m, i) => total + m.weight * predictions[i], 0);
  return {
    title: 'Learn from several beta forecasters',
    context: `These forecasters are competing models of one shared success rate θ. Trials are independent conditional on θ. The table gives their priors before any data. You observe an ordered sequence with ${s} successes and ${fails} failures: (${[...Array(s).fill('S'), ...Array(fails).fill('F')].join(', ')}), where S means success and F means failure.`,
    table: modelTable(models),
    prompt: 'After updating all forecasters, what is the model-averaged probability that the next trial succeeds?',
    answer,
    hints: ['There are two updates: update each beta distribution, and update the probability of each forecaster using how well it predicted the observed sequence.', 'For each forecaster, multiply its posterior model probability by its updated beta mean. Add these contributions; do not use the original model weights or choose only the best forecaster.'],
    steps: [
      ...modelLikelihoodSteps(models, s, fails),
      ...post.map((m, i) => step(`Posterior probability of ${m.name}`, m.weight, 'P(model | data) = P(model)P(data | model) / P(data)', `${posteriorWorking(models, s, fails, i)} = ${f(m.weight)}`)),
      ...post.map((m, i) => step(`Next-success probability within ${m.name}`, predictions[i], 'P(next success | model, data) = (a + s) / (a + b + s + f)', `${m.a} / (${m.a} + ${m.b}) = ${f(predictions[i])}`)),
    ],
    explanation: `${post.map(m => `${m.name} has posterior probability ${f(m.weight)} and updates to Beta(${m.a}, ${m.b})`).join('; ')}. P(next success | data) = ${mixtureWorking(post, predictions)} = ${f(answer)}. The model probabilities describe uncertainty about which forecaster to use; each beta distribution describes uncertainty about θ within that model. Update both before averaging.`,
    solution: {
      formula: 'P(next success | data) = Σ P(model | data)P(next success | model, data)',
      working: `${post.map(m => `${f(m.weight)} × (${m.a} / (${m.a} + ${m.b}))`).join(' + ')} = ${f(answer)}`,
      interpretation: `The updated distributions are ${post.map(m => `${m.name}: Beta(${m.a}, ${m.b})`).join('; ')}. Update both the model probabilities and the beta distributions before averaging: they represent uncertainty between models and within each model, respectively.`,
    },
    source: book('12, 13'),
  };
}

function prediction(rng) {
  if (rng() < 1 / 3) return forecasterPrediction(rng);
  const variant = pick(rng, ['next', 'joint', 'count']);
  const uncertain = rng() < 0.5;
  const ws = weights(rng);
  const models = [
    { name: 'Model A', type: 'fixed', weight: ws[0], p: rate(rng) },
    uncertain ? { name: 'Model B', type: 'beta', weight: ws[1], a: integer(rng, 2, 6), b: integer(rng, 2, 6) } : { name: 'Model B', type: 'fixed', weight: ws[1], p: rate(rng) },
  ];
  const s = integer(rng, 1, 3), fails = integer(rng, 0, 2);
  const futureS = variant === 'next' ? 1 : 2, futureF = variant === 'count' ? 1 : 0, count = variant === 'count';
  const post = updateModels(models, s, fails);
  const values = post.map(m => (count ? choose(futureS + futureF, futureS) : 1) * likelihood(m, futureS, futureF));
  const answer = predictModels(models, s, fails, futureS, futureF, { count });
  return {
    title: variant === 'next' ? 'Predict the next success' : 'Predict several future observations',
    context: `One model describes a testing device throughout all past and future trials. Trials are independent conditional on its fixed θ; in Model B, a beta distribution (when listed) describes uncertainty about this shared θ. You observe an ordered sequence with ${s} successes and ${fails} failures: (${[...Array(s).fill('S'), ...Array(fails).fill('F')].join(', ')}), where S means success and F means failure.`,
    table: modelTable(models), prompt: count ? 'What is the probability of exactly two successes in the next three trials, in any order?' : `What is the probability that ${futureS === 1 ? 'the next trial succeeds' : 'both of the next two trials succeed'}?`, answer,
    hints: ['Update model probabilities using the observed sequence; also update the beta parameters, if present.', futureS === 1 ? 'Average the next-success predictions using posterior model weights.' : 'Calculate the entire future event within each model, then average. Do not square the model-averaged one-step prediction.'],
    steps: [...modelLikelihoodSteps(models, s, fails), step('Posterior probability of Model A', post[0].weight, 'P(A | data) = P(A)P(data | A) / P(data)', `${posteriorWorking(models, s, fails)} = ${f(post[0].weight)}`)],
    explanation: `Posterior weights are ${post.map(m => `${m.name}: ${f(m.weight)}`).join(', ')}. ${post.filter(m => m.type === 'beta').map(m => `${m.name} updates to Beta(${m.a}, ${m.b}).`).join(' ')} Within-model future probabilities are ${post.map((m, i) => `${m.name}: ${count ? `${choose(futureS + futureF, futureS)} × ` : ''}${sequenceWorking(m, futureS, futureF)} = ${f(values[i])}`).join('; ')}. The final prediction is ${mixtureWorking(post, values)} = ${f(answer)}.`, source: book('7, 9, 12, 22'),
    solution: {
      preparation: [step('Posterior probability of Model B', post[1].weight,
        'P(B | data) = P(B)P(data | B) / P(data)',
        `${posteriorWorking(models, s, fails, 1)} = ${f(post[1].weight)}`)],
      formula: 'P(future event | data) = Σ P(model | data)P(future event | model, data)',
      working: `${post.map(m => `${f(m.weight)} × [${count ? `C(${futureS + futureF}, ${futureS}) × ` : ''}${sequenceWorking(m, futureS, futureF)}]`).join(' + ')} = ${f(answer)}`,
      interpretation: `${post.filter(m => m.type === 'beta').map(m => `${m.name} updates to Beta(${m.a}, ${m.b}).`).join(' ')} Average the within-model predictions using posterior model probabilities.${count ? ' Include all three orders with two successes and one failure.' : futureS > 1 ? ' Predict both successes jointly within each model; do not square the overall next-success probability.' : ' For an uncertain beta rate, use the updated beta mean.'} The same model and rate describe the past and future trials.`.trim(),
    },
  };
}

function bayesFactors(rng) {
  const variant = pick(rng, ['reciprocal', 'transitivity', 'both', 'odds', 'marginal', 'forecasters', 'law', 'sequential', 'sequential-total']);
  if (variant === 'law') return generalLaw(rng, false);
  if (variant === 'sequential' || variant === 'sequential-total') return sequentialEvidence(rng, variant === 'sequential-total');
  if (variant === 'reciprocal' || variant === 'transitivity') {
    const first = integer(rng, 2, 8), second = integer(rng, 2, 6), reciprocal = variant === 'reciprocal';
    return {
      title: reciprocal ? 'Reverse a Bayes factor' : 'Link two model comparisons', context: `BF_AB = ${first}${reciprocal ? '.' : ` and BF_BC = ${second}. Both compare predictions for exactly the same data.`} BF_XY means P(data | X) / P(data | Y).`,
      prompt: reciprocal ? 'What is BF_BA?' : 'What is BF_AC?', answer: reciprocal ? 1 / first : first * second, unit: 'ratio',
      hints: [reciprocal ? 'Reversing the comparison swaps numerator and denominator.' : 'Write out the two likelihood ratios and cancel the shared Model B term.', reciprocal ? 'Take the reciprocal.' : 'Multiply BF_AB by BF_BC.'],
      steps: [], explanation: reciprocal ? `BF_BA = 1 / BF_AB = 1 / ${first} = ${f(1 / first)}.` : `BF_AC = BF_AB × BF_BC = ${first} × ${second} = ${first * second}. The Model B likelihood cancels.`, source: book('22'),
      solution: {
        formula: reciprocal ? 'BF_BA = 1 / BF_AB' : 'BF_AC = BF_AB × BF_BC',
        working: reciprocal ? `1 / ${first} = ${f(1 / first)}` : `${first} × ${second} = ${first * second}`,
        interpretation: reciprocal ? 'Reversing the comparison swaps its numerator and denominator, so take the reciprocal.' : 'The Model B likelihood cancels when the two likelihood ratios are multiplied. Both Bayes factors must concern exactly the same data.',
      },
    };
  }
  if (variant === 'both') {
    const cb = pick(rng, [0.25, 0.5, 2, 3, 4, 6]), ba = pick(rng, [0.25, 0.5, 2, 3, 4, 6]);
    const ca = cb * ba;
    return {
      title: 'Link and reverse model comparisons', context: `For the same observed data, BF_CB = ${cb} and BF_BA = ${ba}. BF_XY means P(data | X) / P(data | Y).`,
      prompt: 'What is BF_AC, the evidence for Model A relative to Model C?', answer: 1 / ca, unit: 'ratio',
      hints: ['Combine BF_CB and BF_BA to obtain BF_CA: the Model B likelihood cancels.', 'The requested comparison goes from A to C. Reverse BF_CA by taking its reciprocal.'],
      steps: [step('Bayes factor BF_CA', ca, 'BF_CA = BF_CB × BF_BA', `${cb} × ${ba} = ${f(ca)}`, 'ratio')],
      explanation: `BF_AC = 1 / BF_CA = 1 / (BF_CB × BF_BA) = 1 / (${cb} × ${ba}) = ${f(1 / ca)}. Both transitivity and reversal are needed.`, source: book('22'),
      solution: {
        formula: 'BF_AC = 1 / (BF_CB × BF_BA)',
        working: `1 / (${cb} × ${ba}) = ${f(1 / ca)}`,
        interpretation: 'Multiplying the two given Bayes factors cancels Model B and gives the evidence for C relative to A. Reverse that comparison to obtain the requested evidence for A relative to C. All comparisons concern the same data.',
      },
    };
  }
  if (variant === 'odds') {
    const w = pick(rng, [0.2, 0.3, 0.4, 0.6, 0.7]), bf = pick(rng, [0.25, 0.5, 2, 3, 4, 6]);
    const priorOdds = w / (1 - w), odds = priorOdds * bf, answer = odds / (1 + odds);
    return {
      title: 'Evidence and posterior model probability', context: `Models A and B are mutually exclusive and exhaustive. P(A) = ${f(w)} before observing the data. The data yield BF_AB = ${bf}, meaning P(data | A) / P(data | B) = ${bf}.`,
      prompt: 'What is the posterior probability of Model A?', answer,
      hints: ['Convert the prior probability to odds A:B, then multiply by BF_AB.', 'Convert posterior odds O to a probability using O / (1 + O).'],
      steps: [step('Prior odds A:B', priorOdds, 'Prior odds = P(A) / P(B)', `${f(w)} / ${f(1 - w)} = ${f(priorOdds)}`, 'ratio'), step('Posterior odds A:B', odds, 'Posterior odds = prior odds × BF_AB', `${f(priorOdds)} × ${bf} = ${f(odds)}`, 'ratio')],
      explanation: `P(A | data) = posterior odds / (1 + posterior odds) = ${f(odds)} / (1 + ${f(odds)}) = ${f(answer)}. The Bayes factor updates the prior odds.`, source: book('3, 22'),
      solution: {
        formula: 'P(A | data) = posterior odds / (1 + posterior odds)',
        working: `${f(odds)} / (1 + ${f(odds)}) = ${f(answer)}`,
        interpretation: 'The Bayes factor multiplies the prior odds. Convert the resulting posterior odds to a probability; a Bayes factor alone is not a posterior probability.',
      },
    };
  }
  if (variant === 'forecasters') {
    const n = integer(rng, 3, 6), k = integer(rng, 1, n - 1);
    const candidates = Array.from({ length: 36 }, (_, i) => ({ a: 1 + Math.floor(i / 6), b: 1 + i % 6 }))
      .map(model => ({ ...model, prediction: betaCount(model.a, model.b, n, k) }));
    const models = [];
    while (models.length < 3) {
      const remaining = candidates.filter(model => models.every(other => Math.abs(model.prediction - other.prediction) > 1e-12));
      models.push({ ...pick(rng, remaining), name: `Forecaster ${String.fromCharCode(65 + models.length)}` });
    }
    const ranked = [...models].sort((a, b) => b.prediction - a.prediction);
    const best = ranked[0], worst = ranked[2], answer = best.prediction / worst.prediction;
    return {
      title: 'Compare beta forecasters',
      context: `Three forecasters specify beta priors for one shared success rate θ. Within each model, trials are independent conditional on θ. Before observing any data, they predict exactly ${k} successes in ${n} trials, in any order.`,
      table: { headers: ['Forecaster', 'Prior for θ'], rows: models.map(model => [model.name, `Beta(${model.a}, ${model.b})`]) },
      prompt: 'What is the Bayes factor for the forecaster that predicts this count best, relative to the one that predicts it worst?',
      answer, unit: 'ratio',
      hints: ['Compute the prior predictive probability of this same count under each beta prior. Include all possible orders.', 'Divide the largest predictive probability by the smallest. Use unrounded values; the common counting factor cancels in the ratio.'],
      steps: models.map(model => step(`Count probability under ${model.name}`, model.prediction, 'P(K = k) = C(n, k)B(a + k, b + n − k) / B(a, b)', `${choose(n, k)} × [${betaProduct(model.a, model.b, k, n - k)}] = ${f(model.prediction)}`)),
      explanation: `${best.name} predicts this count best (${f(best.prediction)}), and ${worst.name} predicts it worst (${f(worst.prediction)}). BF(best, worst) = ${f(best.prediction)} / ${f(worst.prediction)} = ${f(answer)}. These data are ${f(answer)} times as probable under ${best.name} as under ${worst.name}. This compares predictive evidence for these data, not posterior model probabilities.`,
      solution: {
        formula: 'BF(best, worst) = P(data | best) / P(data | worst)',
        working: `${f(best.prediction)} / ${f(worst.prediction)} = ${f(answer)}`,
        interpretation: `${best.name} predicts this count best, and ${worst.name} predicts it worst. The ratio compares their predictive evidence for these same data, not their posterior model probabilities. The common counting factor cancels.`,
      },
      source: book('12, 22'),
    };
  }
  const a = integer(rng, 1, 5), b = integer(rng, 1, 5), p = pick(rng, [0.3, 0.5, 0.7]);
  const s = integer(rng, 2, 5), fails = integer(rng, 1, 3);
  const alternative = betaSequence(a, b, s, fails), point = fixedSequence(p, s, fails), answer = alternative / point;
  return {
    title: 'Compare a point model with a beta model', context: `Model A fixes θ = ${p}. Model B assigns θ ~ Beta(${a}, ${b}). All trials share the same θ and are independent conditional on it. You observe a specified ordered sequence with ${s} successes and ${fails} failures: (${[...Array(s).fill('S'), ...Array(fails).fill('F')].join(', ')}), where S means success and F means failure.`,
    prompt: 'What is BF_BA, the evidence for Model B relative to Model A?', answer, unit: 'ratio',
    hints: ['Calculate the marginal probability of the whole observed sequence under each model.', 'Divide Model B’s integrated prediction by Model A’s fixed-rate prediction. Model prior probabilities are not part of this Bayes factor.'],
    steps: [step('Sequence probability under Model A', point, 'P(data | A) = p^s(1 − p)^f', `${p}^${s} × (1 − ${p})^${fails} = ${f(point)}`), step('Sequence probability under Model B', alternative, 'P(data | B) = B(a + s, b + f) / B(a, b)', `B(${a + s}, ${b + fails}) / B(${a}, ${b}) = ${betaProduct(a, b, s, fails)} = ${f(alternative)}`)],
    explanation: `BF_BA = P(data | B) / P(data | A) = ${f(alternative)} / ${f(point)} = ${f(answer)}. It compares predictions for the same ordered sequence.`, source: book('12, 17, 22'),
    solution: {
      formula: 'BF_BA = P(data | B) / P(data | A)',
      working: `[${betaProduct(a, b, s, fails)}] / [${p}^${s} × (1 − ${p})^${fails}] = ${f(answer)}`,
      interpretation: 'Compare the predictions for the same specified order. Model B averages over its beta prior, while Model A uses its fixed rate. Model prior probabilities do not enter the Bayes factor.',
    },
  };
}

const generators = { probability, bayes, sequences, beta, mixtures, prediction, 'bayes-factors': bayesFactors };
function validate(skillId, seed) {
  if (!Object.hasOwn(generators, skillId)) throw new RangeError(`Unknown skill: ${skillId}`);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xFFFFFFFF) throw new RangeError('Seed must be a uint32 integer.');
}
export function generateQuestion(skillId, seed) {
  validate(skillId, seed);
  // A per-skill salt makes the same seed vary independently across skills.
  const salt = skills.findIndex(s => s.id === skillId) * 0x9E3779B9;
  // Story selection does not consume the numerical generator's random stream.
  // The app's uint32 seed increment changes seed % 5 on every new question.
  return polishQuestion(contextualizeQuestion(finish(skillId, seed, generators[skillId](random((seed + salt) >>> 0))), seed % 5));
}

export function generateExam(seed) {
  validate('prediction', seed);
  const rng = random(seed ^ 0xA51CE), ws = pick(rng, [[0.2, 0.3, 0.5], [0.25, 0.5, 0.25], [0.4, 0.35, 0.25]]);
  const models = [
    { name: 'Harbor workshop', type: 'fixed', weight: ws[0], p: pick(rng, [0.4, 0.5, 0.6, 0.7]) },
    { name: 'Garden workshop', type: 'beta', weight: ws[1], a: integer(rng, 2, 5), b: integer(rng, 2, 5) },
  ];
  models.push({ name: 'Meadow workshop', type: 'fixed', weight: ws[2], p: pick(rng, [0.2, 0.3, 0.5, 0.7, 0.8].filter(p => p !== models[0].p)) });
  // Cycle the requested source independently of the five story settings.
  const targetIndex = Math.floor(seed / 5) % models.length;
  const target = models[targetIndex];
  const s = integer(rng, 2, 4), fails = integer(rng, 1, 3);
  const extraS = integer(rng, 0, 1), extraF = 1 - extraS;
  const post = updateModels(models, s, fails), extraPost = updateModels(models, s + extraS, fails + extraF);
  const next = predictModels(models, s, fails, 1, 0);
  const future = integer(rng, 2, 3);
  const joint = predictModels(models, s + extraS, fails + extraF, future, 0);
  const firstOrder = [...Array(s).fill('S'), ...Array(fails).fill('F')];
  const correctedOrder = [...firstOrder, extraS ? 'S' : 'F'].reverse();
  const intro = `A box of toys comes from one of three workshops. Every toy in this exercise comes from that same workshop. A success means a toy passes inspection. Outcomes are independent conditional on the workshop’s fixed θ. At the Garden workshop, one shared unknown θ has the beta prior listed below. The first specified sequence contains ${s} successes and ${fails} failure${fails === 1 ? '' : 's'}. In recorded order it is (${firstOrder.join(', ')}), where S means pass and F means failure. The table gives the priors before any inspections.`;
  const later = `${intro} One additional toy then ${extraS ? 'passes' : 'fails'} inspection, giving ${s + extraS} successes and ${fails + extraF} failure${fails + extraF === 1 ? '' : 's'} in total.`;
  const common = { table: modelTable(models), source: book('7, 8, 9, 12, 22') };
  const firstMarginal = marginal(models, s, fails);
  const allMarginal = marginal(models, s + extraS, fails + extraF);
  const items = [
    {
      ...common, title: '1. Identify the workshop', context: intro,
      prompt: `After the first sequence, what is the probability that the box came from the ${target.name}?`, answer: post[targetIndex].weight,
      hints: ['Calculate the sequence probability under each workshop.', 'Weight each likelihood by its prior model probability and normalize.'],
      steps: modelLikelihoodSteps(models, s, fails),
      explanation: `P(${target.name} | first sequence) = ${posteriorWorking(models, s, fails, targetIndex)} = ${f(post[targetIndex].weight)}. Within Garden, the posterior is Beta(${post[1].a}, ${post[1].b}).`,
      solution: {
        preparation: [step('Overall probability of the first ordered sequence', firstMarginal,
          'P(data) = Σ P(model)P(data | model)',
          `${mixtureWorking(models, models.map(m => likelihood(m, s, fails)))} = ${f(firstMarginal)}`)],
        formula: 'P(model | data) = P(model)P(data | model) / P(data)',
        working: `${posteriorWorking(models, s, fails, targetIndex)} = ${f(post[targetIndex].weight)}`,
        interpretation: `Weight the ${target.name} likelihood by its prior probability and normalize over all three workshops. Within Garden, the parameter posterior is Beta(${post[1].a}, ${post[1].b}). One workshop generated the whole observed sequence.`,
      },
    },
    {
      ...common, title: '2. Predict the next inspection', context: intro,
      prompt: 'Given the first sequence, what is the probability that the next toy passes?', answer: next,
      hints: ['Use posterior workshop probabilities from the first sequence.', 'Garden’s next-pass probability uses its updated beta mean; the fixed workshop rates do not change.'],
      steps: [step('Posterior probability of Garden', post[1].weight, 'P(Garden | data) = prior × likelihood / marginal likelihood', `${posteriorWorking(models, s, fails, 1)} = ${f(post[1].weight)}`), step('Next-pass probability within Garden', post[1].a / (post[1].a + post[1].b), 'P(next success | Garden, data) = a′ / (a′ + b′)', `${post[1].a} / (${post[1].a} + ${post[1].b}) = ${f(post[1].a / (post[1].a + post[1].b))}`)],
      explanation: `P(next pass | first sequence) = ${mixtureWorking(post, post.map(m => likelihood(m, 1, 0)))} = ${f(next)}. Both the model weights and Garden’s parameter distribution reflect the first sequence.`,
      solution: {
        preparation: [0, 2].map(i => step(`Posterior probability of ${models[i].name}`, post[i].weight,
          'P(model | data) = P(model)P(data | model) / P(data)',
          `${posteriorWorking(models, s, fails, i)} = ${f(post[i].weight)}`)),
        formula: 'P(next success | data) = Σ P(model | data)P(next success | model, data)',
        working: `${post.map(m => `${f(m.weight)} × [${sequenceWorking(m, 1, 0)}]`).join(' + ')} = ${f(next)}`,
        interpretation: `Both the workshop probabilities and Garden’s parameter distribution reflect the first sequence. Garden now uses Beta(${post[1].a}, ${post[1].b}); the fixed rates in Harbor and Meadow do not change. Average all three next-pass predictions.`,
      },
    },
    {
      ...common, title: '3. Update after another observation', context: later,
      prompt: `What is the updated probability that the box came from the ${target.name}?`, answer: extraPost[targetIndex].weight,
      hints: ['Use the previous posterior as the prior for this new observation.', 'Predict the new outcome within each updated workshop model, then normalize their weighted predictions.'],
      steps: post.map(m => step(`Probability of the additional ${extraS ? 'pass' : 'failure'} under ${m.name}`, likelihood(m, extraS, extraF), 'Use the posterior predictive probability within this model', `${sequenceWorking(m, extraS, extraF)} = ${f(likelihood(m, extraS, extraF))}`)),
      explanation: `P(${target.name} | all observations) = ${f(post[targetIndex].weight)} × ${f(likelihood(post[targetIndex], extraS, extraF))} / (${mixtureWorking(post, post.map(m => likelihood(m, extraS, extraF)))}) = ${f(extraPost[targetIndex].weight)}. Equivalently update the original priors with all ${s + extraS} successes and ${fails + extraF} failures.`,
      solution: {
        formula: 'P(H | D, x) = P(H | D)P(x | H, D) / P(x | D)',
        working: `${f(post[targetIndex].weight)} × ${f(likelihood(post[targetIndex], extraS, extraF))} / (${mixtureWorking(post, post.map(m => likelihood(m, extraS, extraF)))}) = ${f(extraPost[targetIndex].weight)}`,
        interpretation: `Here H is the ${target.name}, D is the first sequence, and x is the additional outcome. Use the previous posterior as the prior for this new outcome. This gives the same result as updating the original priors with all ${s + extraS} successes and ${fails + extraF} failures.`,
      },
    },
    {
      ...common, title: '4. Correct the order of the observations',
      context: `${later} You discover that these same toys were recorded in the wrong order. The corrected order is (${correctedOrder.join(', ')}). No extra toys have been inspected.`,
      prompt: `With the corrected order, what is the probability that the box came from the ${target.name}?`, answer: extraPost[targetIndex].weight,
      hints: ['Count successes and failures in the corrected sequence. Has either count changed?', 'With a shared constant rate and conditional independence, each model assigns the same probability to every order with these counts. Do not treat the correction as new data.'],
      steps: modelLikelihoodSteps(models, s + extraS, fails + extraF),
      explanation: `The corrected sequence still contains ${s + extraS} successes and ${fails + extraF} failure${fails + extraF === 1 ? '' : 's'}. Under each fixed-rate model its probability is θ^s(1 − θ)^f; integrating this same expression under Garden also depends only on the counts. Thus P(${target.name} | corrected sequence) = ${posteriorWorking(models, s + extraS, fails + extraF, targetIndex)} = ${f(extraPost[targetIndex].weight)}, unchanged from part 3. The working groups successes first to evaluate the likelihood from the counts. This is one specified order, so no binomial coefficient is needed. Order invariance follows from the models stated here; it is not a rule for every time-dependent process.`,
      solution: {
        preparation: [step('Overall probability of the corrected ordered sequence', allMarginal,
          'P(data) = Σ P(model)P(data | model)',
          `${mixtureWorking(models, models.map(m => likelihood(m, s + extraS, fails + extraF)))} = ${f(allMarginal)}`)],
        formula: 'P(model | data) = P(model)P(data | model) / P(data)',
        working: `${posteriorWorking(models, s + extraS, fails + extraF, targetIndex)} = ${f(extraPost[targetIndex].weight)}`,
        interpretation: `The corrected sequence still has ${s + extraS} successes and ${fails + extraF} failures, so the posterior for the ${target.name} is unchanged from part 3. Under these shared-rate, conditionally independent models, each likelihood depends only on those counts. The working groups successes first to evaluate one specified order; no binomial coefficient is needed. Reordering is not new data, and order invariance is not a rule for every time-dependent process.`,
      },
    },
    {
      ...common, title: '5. Predict several future inspections', context: later,
      prompt: `Allowing for all ${models.length} possible workshops, what is the probability that all of the next ${future} toys pass?`, answer: joint,
      hints: ['Within each workshop, calculate the joint probability of all future passes.', 'Average those joint probabilities using the latest posterior workshop weights. Do not raise the overall next-pass probability to a power.'],
      steps: extraPost.map(m => step(`Probability of ${future} future passes under ${m.name}`, likelihood(m, future, 0), m.type === 'fixed' ? 'P(all pass | θ) = θ^m' : 'P(all pass | updated beta) = B(a′ + m, b′) / B(a′, b′)', `${sequenceWorking(m, future, 0)} = ${f(likelihood(m, future, 0))}`)),
      explanation: `Posterior workshop weights are ${extraPost.map(m => `${m.name}: ${f(m.weight)}`).join(', ')}. Garden’s joint prediction is ${betaProduct(extraPost[1].a, extraPost[1].b, future, 0)} = ${f(likelihood(extraPost[1], future, 0))}. P(all ${future} pass | all data) = ${mixtureWorking(extraPost, extraPost.map(m => likelihood(m, future, 0)))} = ${f(joint)}. Each beta predictive factor updates after the preceding success; future outcomes share the same workshop and rate.`,
      solution: {
        preparation: extraPost.map((m, i) => step(`Posterior probability of ${m.name} after all observations`, m.weight,
          'P(model | data) = P(model)P(data | model) / P(data)',
          `${posteriorWorking(models, s + extraS, fails + extraF, i)} = ${f(m.weight)}`)),
        formula: 'P(future event | data) = Σ P(model | data)P(future event | model, data)',
        working: `${extraPost.map(m => `${f(m.weight)} × [${sequenceWorking(m, future, 0)}]`).join(' + ')} = ${f(joint)}`,
        interpretation: `Average the joint predictions using workshop probabilities updated by all observations. Garden uses Beta(${extraPost[1].a}, ${extraPost[1].b}), and each predictive factor updates after the preceding success. Future outcomes share the same workshop and rate; do not raise the overall next-pass probability to a power.`,
      },
    },
  ];
  return contextualizeExam(items.map((item, i) => finish('prediction', seed, item, `-exam-${i + 1}`)), seed % 5).map(polishQuestion);
}
