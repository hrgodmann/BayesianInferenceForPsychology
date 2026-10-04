// Story changes happen after generation. They never consume random numbers or
// change a likelihood, model weight, answer, or worked numerical expression.
export const examContexts = [
  {
    id: 'exam-toys', name: 'Toy inspections',
    sourceSingular: 'workshop', sourcePlural: 'workshops',
    models: ['Harbor workshop', 'Garden workshop', 'Meadow workshop'],
    shortNames: ['Harbor', 'Garden', 'Meadow'],
    unitSingular: 'toy', unitPlural: 'toys',
    successDescription: 'a toy passes inspection',
    failureDescription: 'a toy fails inspection',
  },
  {
    id: 'exam-seeds', name: 'Seed germination',
    sourceSingular: 'nursery', sourcePlural: 'nurseries',
    models: ['Cedar nursery', 'Willow nursery', 'Hazel nursery'],
    shortNames: ['Cedar', 'Willow', 'Hazel'],
    unitSingular: 'seed', unitPlural: 'seeds',
    opening: 'A packet of seeds comes from one of three nurseries. Every seed in this exercise comes from that same nursery and is grown under the same conditions for a fixed test period.',
    successDescription: 'a seed germinates',
    failureDescription: 'a seed does not germinate',
    rateDescription: 'germination probability under these conditions',
    successVerb: 'germinates', failureVerb: 'does not germinate',
    pluralSuccessVerb: 'germinate',
  },
  {
    id: 'exam-packets', name: 'Packet transmissions',
    sourceSingular: 'station', sourcePlural: 'stations',
    models: ['North relay station', 'Brook relay station', 'Summit relay station'],
    shortNames: ['North', 'Brook', 'Summit'],
    unitSingular: 'packet', unitPlural: 'packets',
    opening: 'A test sends packets through one of three relay stations. Every packet in this exercise uses that same station, with one transmission attempt per packet under constant test conditions.',
    successDescription: 'a packet reaches its destination',
    failureDescription: 'a packet does not reach its destination',
    rateDescription: 'delivery probability for one transmission attempt',
    successVerb: 'reaches its destination', failureVerb: 'does not reach its destination',
    pluralSuccessVerb: 'reach their destination',
  },
  {
    id: 'exam-parcels', name: 'Parcel deliveries',
    sourceSingular: 'depot', sourcePlural: 'depots',
    models: ['Eastgate depot', 'Riverside depot', 'Hilltop depot'],
    shortNames: ['Eastgate', 'Riverside', 'Hilltop'],
    unitSingular: 'parcel', unitPlural: 'parcels',
    opening: 'A delivery simulation assigns parcels to one of three depots. Every parcel in this exercise uses that same depot, with the same delivery deadline and fixed test conditions.',
    successDescription: 'a parcel arrives by its deadline',
    failureDescription: 'a parcel misses its deadline',
    rateDescription: 'probability of arriving by the deadline',
    successVerb: 'arrives by its deadline', failureVerb: 'misses its deadline',
    pluralSuccessVerb: 'arrive by their deadlines',
  },
  {
    id: 'exam-ceramics', name: 'Ceramic strength tests',
    sourceSingular: 'studio', sourcePlural: 'studios',
    models: ['Redwood studio', 'Pebble studio', 'Maple studio'],
    shortNames: ['Redwood', 'Pebble', 'Maple'],
    unitSingular: 'cup', unitPlural: 'cups',
    opening: 'A crate of ceramic cups comes from one of three pottery studios. Every cup in this exercise comes from that same studio and undergoes the same strength test.',
    successDescription: 'a cup passes the strength test',
    failureDescription: 'a cup fails the strength test',
    rateDescription: 'probability of passing the strength test',
    successVerb: 'passes the strength test', failureVerb: 'fails the strength test',
    pluralSuccessVerb: 'pass the strength test',
  },
];

function mapText(value, transform) {
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value)) return value.map(item => mapText(item, transform));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapText(item, transform)]));
  }
  return value;
}

export function contextualizeExam(items, index) {
  if (!Number.isInteger(index) || index < 0 || index >= examContexts.length) {
    throw new RangeError('Exam context index must be an integer from 0 to 4.');
  }
  if (!Array.isArray(items) || items.length !== 5) throw new RangeError('An exam must contain five linked questions.');
  const context = examContexts[index];
  const metadata = { contextId: context.id, contextIndex: index };
  if (index === 0) return items.map(item => ({ ...item, ...metadata }));

  // Read only visible story facts. Numeric solutions remain untouched below.
  const counts = items[0].context.match(/sequence contains (\d+) successes and (\d+) failures?/);
  const order = items[0].context.match(/In recorded order it is (\([^)]*\))/);
  const totals = items[2].context.match(/giving (\d+) successes and (\d+) failures? in total/);
  const corrected = items[3].context.match(/The corrected order is (\([^)]*\))/);
  const future = items[4].prompt.match(/all of the next (\d+)/);
  const targetIndex = examContexts[0].models.findIndex(name => items[0].prompt.includes(name));
  if (!counts || !order || !totals || !corrected || !future || targetIndex === -1) {
    throw new Error('The base exam is missing a required story fact.');
  }
  const [, successes, failures] = counts;
  const [, totalSuccesses, totalFailures] = totals;
  const extraSuccess = Number(totalSuccesses) > Number(successes);
  const target = context.models[targetIndex];
  const betaModel = context.models[1];
  const intro = `${context.opening} A success means ${context.successDescription}; a failure means ${context.failureDescription}. Outcomes are independent conditional on the ${context.sourceSingular}’s constant θ, its ${context.rateDescription}. At the ${betaModel}, one shared unknown θ has the beta prior listed below. The first specified sequence contains ${successes} successes and ${failures} failure${failures === '1' ? '' : 's'}. In recorded order it is ${order[1]}, where S means success and F means failure. The table gives the priors before any observations.`;
  const later = `${intro} One additional ${context.unitSingular} then ${extraSuccess ? context.successVerb : context.failureVerb}, giving ${totalSuccesses} successes and ${totalFailures} failure${totalFailures === '1' ? '' : 's'} in total.`;

  function translate(text) {
    let result = text;
    for (let i = 0; i < 3; i += 1) {
      result = result.replaceAll(examContexts[0].models[i], context.models[i]);
      result = result.replaceAll(examContexts[0].shortNames[i], context.shortNames[i]);
    }
    return result
      .replaceAll('workshops', context.sourcePlural)
      .replaceAll('workshop', context.sourceSingular)
      .replaceAll('next-pass', 'next-success')
      .replaceAll('Next-pass', 'Next-success')
      .replaceAll('next pass', 'next success')
      .replaceAll('future passes', 'future successes')
      .replaceAll('additional pass', 'additional success')
      .replaceAll('all pass', 'all succeed')
      .replace(/all (\d+) pass/g, 'all $1 succeed');
  }

  const result = items.map(item => ({ ...mapText(item, translate), ...metadata }));
  result[0].title = '1. Identify the source';
  result[0].context = intro;
  result[0].prompt = `After the first sequence, what is the probability that the shared source is the ${target}?`;
  result[1].title = '2. Predict the next outcome';
  result[1].context = intro;
  result[1].prompt = `Given the first sequence, what is the probability that the next ${context.unitSingular} ${context.successVerb}?`;
  result[2].context = later;
  result[2].prompt = `What is the updated probability that the shared source is the ${target}?`;
  result[3].context = `${later} You discover that these same outcomes were recorded in the wrong order. The corrected order is ${corrected[1]}. No additional outcomes have been observed.`;
  result[3].prompt = `With the corrected order, what is the probability that the shared source is the ${target}?`;
  result[4].title = '5. Predict several future outcomes';
  result[4].context = later;
  result[4].prompt = `Allowing for all ${context.models.length} possible ${context.sourcePlural}, what is the probability that all of the next ${future[1]} ${context.unitPlural} ${context.pluralSuccessVerb}?`;
  return result;
}
