// Narrative choices are independent of the numerical RNG. These functions only
// copy student-facing text; answers, precision, arithmetic and sources stay intact.
const freezeCatalog = entries => Object.freeze(entries.map(([id, label]) => Object.freeze({ id, label })));
const processStories = Object.freeze([
  null,
  {
    id: 'parcel-deliveries', label: 'Parcel deliveries',
    setting: 'Each trial tracks a parcel on the same delivery route. Success means arrival by its deadline; failure means missing that deadline.',
    fixedEvent: 'A parcel on one delivery route arrives by its deadline',
  },
  {
    id: 'robot-placements', label: 'Robot placements',
    setting: 'Each trial is a placement attempt by the same robot. Success means placing an object inside a marked target; failure means placing it outside.',
    fixedEvent: 'A robot places an object inside a marked target',
  },
  {
    id: 'packet-delivery', label: 'Packet delivery',
    setting: 'Each trial sends a packet over the same connection. Success means receiving an intact packet; failure means that no intact packet is received.',
    fixedEvent: 'A packet sent over one connection is received intact',
  },
  {
    id: 'arcade-launches', label: 'Arcade launches',
    setting: 'Each trial uses the same automatic ball launcher. Success means landing a ball inside a target; failure means landing it outside.',
    fixedEvent: 'An automatic ball launcher lands a ball inside a target',
  },
]);
const processCatalog = (id, label) => freezeCatalog([[id, label], ...processStories.slice(1).map(s => [s.id, s.label])]);

// Each family has exactly five choices: its original story plus four additions.
// IDs are local to the family; callers can use `${family}:${id}` as a full ID.
export const contextCatalog = Object.freeze({
  overlap: freezeCatalog([
    ['visitor-activities', 'Art and music activities'],
    ['summer-festival', 'Summer festival'],
    ['library-workshops', 'Library workshops'],
    ['outdoor-camp', 'Outdoor camp'],
    ['science-fair', 'Science fair'],
  ]),
  groups: freezeCatalog([
    ['workshop-sessions', 'Workshop sessions'],
    ['delivery-routes', 'Delivery routes'],
    ['packing-stations', 'Packing stations'],
    ['library-branches', 'Library branches'],
    ['arcade-machines', 'Arcade machines'],
  ]),
  sources: freezeCatalog([
    ['part-machines', 'Part-making machines'],
    ['seed-nurseries', 'Seed nurseries'],
    ['courier-services', 'Courier services'],
    ['radio-transmitters', 'Radio transmitters'],
    ['page-printers', 'Page printers'],
  ]),
  sequences: processCatalog('signal-detection', 'Signal detection'),
  beta: processCatalog('original-beta', 'Seeds and success rates'),
  mixtures: processCatalog('seed-mixtures', 'Seed germination'),
  prediction: processCatalog('testing-device', 'Device testing'),
  forecasters: processCatalog('success-forecasters', 'Success-rate forecasters'),
  law: processCatalog('automated-process', 'An automated process'),
  evidence: processCatalog('model-comparisons', 'Model comparisons'),
});

export function contextFamily(question) {
  const title = question.originalTitle ?? question.title;
  if (title === 'Condition on a group' || title === 'Allow for overlapping events') return 'overlap';
  if (question.skillId === 'probability') return 'groups';
  if (title === 'Posterior probability of a general law' || title === 'Evidence for a general law') return 'law';
  if (question.skillId === 'bayes') return 'sources';
  if (question.skillId === 'sequences') return 'sequences';
  if (question.skillId === 'beta') return 'beta';
  if (question.skillId === 'mixtures') return 'mixtures';
  if (title === 'Learn from several beta forecasters' || title === 'Compare beta forecasters') return 'forecasters';
  if (question.skillId === 'prediction') return 'prediction';
  if (question.skillId === 'bayes-factors') return 'evidence';
  throw new RangeError(`No story family for question: ${title}`);
}

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Simultaneous, whole-phrase replacements prevent cascades (and never replace
// "art" inside "part", for example). Longer phrases take precedence.
function substitute(text, replacements) {
  const phrases = Object.keys(replacements).sort((a, b) => b.length - a.length);
  if (!phrases.length) return text;
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])(${phrases.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`, 'gu');
  return text.replace(pattern, (_match, prefix, phrase) => prefix + replacements[phrase]);
}
function copyText(value, transform) {
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value)) return value.map(item => copyText(item, transform));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyText(item, transform)]));
  return value;
}
function withText(question, replacements) {
  const result = structuredClone(question);
  // Never traverse metadata or source records. These are not narrative text.
  for (const key of ['title', 'context', 'prompt', 'table', 'hints', 'steps', 'explanation', 'solution']) {
    if (key in result) result[key] = copyText(result[key], text => substitute(text, replacements));
  }
  return result;
}
const capitalized = word => word[0].toUpperCase() + word.slice(1);

function overlap(question, index) {
  const story = [null,
    { place: 'a summer festival', first: 'comedy', second: 'jazz' },
    { place: 'a library workshop day', first: 'writing', second: 'drawing' },
    { place: 'an outdoor camp', first: 'canoeing', second: 'orienteering' },
    { place: 'a science fair', first: 'robotics', second: 'astronomy' },
  ][index];
  const result = withText(question, {
    art: story.first, Art: capitalized(story.first), music: story.second, Music: capitalized(story.second),
  });
  result.context = `The visitors are at ${story.place}. ${result.context}`;
  return result;
}

function groups(question, index) {
  const story = [null,
    {
      singular: 'route', plural: 'routes', names: ['North', 'Central', 'South'],
      context: 'A parcel is assigned to exactly one of the listed delivery routes. These routes cover all possibilities. Success means arrival by the promised deadline.',
      prompt: 'What is the probability that a randomly selected parcel arrives by its promised deadline?',
      membership: 'Each parcel belongs to exactly one route',
    },
    {
      singular: 'station', plural: 'stations', names: ['Cedar', 'Birch', 'Willow'],
      context: 'A package is packed at exactly one of the listed stations. These stations cover all possibilities. Success means passing a seal check.',
      prompt: 'What is the probability that a randomly selected package passes its seal check?',
      membership: 'Each package belongs to exactly one station',
    },
    {
      singular: 'branch', plural: 'branches', names: ['Maple', 'Oak', 'Pine'],
      context: 'A visitor chooses exactly one of the listed library branches. These branches cover all possibilities. Success means finding the book they came for.',
      prompt: 'What is the probability that a randomly selected visitor finds the book they came for?',
      membership: 'Each visitor belongs to exactly one branch',
    },
    {
      singular: 'machine', plural: 'machines', names: ['Red', 'Blue', 'Green'],
      context: 'A player makes one attempt at exactly one of the listed arcade machines. These machines cover all possibilities. Success means winning a prize on that attempt.',
      prompt: 'What is the probability that a randomly selected player wins a prize on that attempt?',
      membership: 'Each player uses exactly one machine',
    },
  ][index];
  const result = withText(question, {
    'Each visitor belongs to exactly one session': story.membership,
    'afternoon and evening sessions': `${story.names[1]} and ${story.names[2]} ${story.plural}`,
    'Probability of attending in the morning and succeeding': `Probability of ${story.names[0]} and success`,
    Morning: story.names[0], Afternoon: story.names[1], Evening: story.names[2],
    sessions: story.plural, session: story.singular, Session: capitalized(story.singular),
  });
  result.context = story.context;
  if (question.title !== 'Recover a missing success rate') result.prompt = story.prompt;
  return result;
}

function sources(question, index) {
  const story = [null,
    { name: 'Nursery', noun: 'nursery', context: 'One nursery is selected using the prior probabilities below. Every seed in this question comes from that same nursery. A success means germination during a fixed test period; a failure means no germination. Outcomes are independent conditional on the nursery, whose success probability stays fixed.' },
    { name: 'Courier', noun: 'courier', context: 'One courier is selected using the prior probabilities below. That same courier handles every parcel in this question. A success means arrival by the promised deadline; a failure means missing it. Outcomes are independent conditional on the courier, whose success probability stays fixed.' },
    { name: 'Transmitter', noun: 'transmitter', context: 'One transmitter is selected using the prior probabilities below. It sends every message in this question. A success means receiving an intact message; a failure means no intact message is received. Outcomes are independent conditional on the transmitter, whose success probability stays fixed.' },
    { name: 'Printer', noun: 'printer', context: 'One printer is selected using the prior probabilities below. It prints every page in this question. A success means a page is free of smudges; a failure means it has a smudge. Outcomes are independent conditional on the printer, whose success probability stays fixed.' },
  ][index];
  const result = withText(question, {
    'a passed inspection followed by a failed inspection': 'a success followed by a failure',
    'two passed inspections in a row': 'two successes in a row',
    'a passed inspection': 'one success', 'a failed inspection': 'one failure',
    Machine: story.name, machine: story.noun,
  });
  result.context = story.context;
  return result;
}

function processes(question, family, index) {
  const story = processStories[index];
  if (family === 'sequences') {
    const result = withText(question, { detections: 'successes', detection: 'success' });
    const probability = question.context.match(/fixed probability ([\d.]+)/)?.[1];
    if (probability === undefined) throw new Error('Sequence story has no fixed probability.');
    result.context = `${story.fixedEvent} with fixed probability ${probability} on each independent trial. S denotes success and F denotes failure.`;
    return result;
  }
  const replacements = family === 'beta' ? {
    'A plant nursery models a shared germination rate as': 'The shared success rate has prior',
    'A plant nursery models the germination rate as': 'The shared success rate has prior',
    'before observing any seeds': 'before observing any trials',
    'Germination outcomes are independent conditional on θ': 'All trials are independent conditional on this same θ',
    'Seeds germinate independently conditional on the same θ': 'All trials are independent conditional on the same θ',
    'germination rate': 'success rate', 'failed seeds': 'failed trials', 'seeds that failed to germinate': 'trials that failed',
    'fail to germinate': 'fail', seeds: 'trials', germinate: 'succeed',
  } : family === 'mixtures' ? {
    'These are competing models of a seed variety’s germination rate': 'These are competing models of the shared success rate',
    seeds: 'trials', germinate: 'succeed',
  } : family === 'prediction' ? {
    'One model describes a testing device throughout all past and future trials': 'One model describes this process throughout all past and future trials',
  } : family === 'law' ? {
    'an automated process always succeeds': 'the process just described always succeeds',
  } : {};
  const result = withText(question, replacements);
  result.context = `${story.setting} ${result.context}`;
  return result;
}

/** Select a story without consuming RNG draws or modifying the input question. */
export function contextualizeQuestion(question, index) {
  if (!Number.isInteger(index) || index < 0 || index >= 5) throw new RangeError('Context index must be an integer from 0 to 4.');
  const family = contextFamily(question);
  let result = index === 0 ? structuredClone(question)
    : family === 'overlap' ? overlap(question, index)
      : family === 'groups' ? groups(question, index)
        : family === 'sources' ? sources(question, index)
          : processes(question, family, index);
  // These two original titles contain story-specific nouns. A shared title keeps
  // the calculation recognizable across all five settings.
  if (question.title === 'Across all workshop sessions') result.title = 'Across all groups';
  if (question.title === 'Which machine made the parts?') result.title = 'Which source generated the outcomes?';
  result.originalTitle = question.originalTitle ?? question.title;
  result.contextFamily = family;
  result.contextIndex = index;
  result.contextId = `${family}:${contextCatalog[family][index].id}`;
  return result;
}
