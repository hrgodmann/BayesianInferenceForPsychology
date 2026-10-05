import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { skills, generateQuestion, generateExam } from '../site/questions.js';
import { contextCatalog, contextualizeQuestion } from '../site/contexts.js';
import { examContexts, contextualizeExam } from '../site/exam-contexts.js';

const visibleText = q => JSON.stringify([q.title, q.context, q.prompt, q.table, q.hints, q.steps, q.explanation, q.solution]);
const numericalSolution = q => ({
  answer: q.answer, unit: q.unit, decimals: q.decimals, source: q.source,
  steps: q.steps.map(({ answer, unit, decimals, working }) => ({ answer, unit, decimals, working })),
});

test('every standalone title appears in all five contexts with complete student-facing prose', () => {
  const titles = new Map(), families = new Set();
  for (const entries of Object.values(contextCatalog)) {
    assert.equal(entries.length, 5);
    assert.equal(new Set(entries.map(entry => entry.id)).size, 5);
  }
  for (let seed = 0; seed < 1000; seed++) for (const skill of skills) {
    const q = generateQuestion(skill.id, seed);
    const contexts = titles.get(q.title) ?? new Set();
    contexts.add(q.contextIndex); titles.set(q.title, contexts);
    families.add(q.contextFamily);
    assert.equal(q.contextIndex, seed % 5);
    assert.equal(q.contextId, `${q.contextFamily}:${contextCatalog[q.contextFamily][q.contextIndex].id}`);
    const text = visibleText(q);
    assert.doesNotMatch(text, /\b(?:undefined|NaN|Infinity)\b/);
    assert.doesNotMatch(text, /\b1 (?:successes|failures)\b/);
    if (!q.contextIndex) continue;
    if (q.contextFamily === 'overlap') assert.doesNotMatch(text, /\b(?:art|music)\b/i);
    if (q.contextFamily === 'groups') assert.doesNotMatch(text, /\b(?:Morning|Afternoon|Evening|sessions?|puzzle)\b/);
    if (q.contextFamily === 'sources') assert.doesNotMatch(text, /\b(?:machines?|inspections?|parts)\b/i);
    if (['beta', 'mixtures'].includes(q.contextFamily)) assert.doesNotMatch(text, /\b(?:seeds?|nursery|germination|germinate)\b/i);
    if (q.contextFamily === 'prediction') assert.doesNotMatch(text, /\bdevice\b/i);
    if (q.contextFamily === 'sequences') assert.doesNotMatch(text, /\b(?:sensor|signal|detections?)\b/i);
  }
  assert.equal(titles.size, 27);
  for (const [title, contexts] of titles) assert.deepEqual([...contexts].sort(), [0, 1, 2, 3, 4], title);
  assert.deepEqual([...families].sort(), Object.keys(contextCatalog).sort());
});

test('story adapters preserve each numerical solution, precision, source, and original object', () => {
  const seen = new Set();
  for (let seed = 0; seed < 2500; seed += 5) for (const skill of skills) {
    const baseline = generateQuestion(skill.id, seed);
    if (seen.has(baseline.title)) continue;
    seen.add(baseline.title);
    const original = structuredClone(baseline), contexts = new Set();
    for (let index = 0; index < 5; index++) {
      const q = contextualizeQuestion(baseline, index);
      assert.deepEqual(numericalSolution(q), numericalSolution(baseline));
      assert.deepEqual(baseline, original);
      contexts.add(q.context);
    }
    assert.equal(contexts.size, 5, baseline.title);
  }
  assert.equal(seen.size, 27);
  for (const seed of [0, 5, 10]) {
    const baseline = generateExam(seed), original = structuredClone(baseline);
    for (let index = 0; index < 5; index++) {
      const exam = contextualizeExam(baseline, index);
      assert.deepEqual(exam.map(numericalSolution), baseline.map(numericalSolution));
      assert.deepEqual(baseline, original);
    }
  }
  const baseline = generateQuestion('bayes', 0), exam = generateExam(0);
  for (const invalid of [-1, 5, 1.5, NaN, Infinity, '2']) {
    assert.throws(() => contextualizeQuestion(baseline, invalid), RangeError);
    assert.throws(() => contextualizeExam(exam, invalid), RangeError);
  }
});

test('each linked exam keeps one coherent story and practices all source targets', () => {
  assert.equal(examContexts.length, 5);
  const targets = new Map(examContexts.map((context, index) => [index, new Set()]));
  for (let seed = 0; seed < 300; seed++) {
    const exam = generateExam(seed), index = seed % 5, context = examContexts[index];
    assert.equal(new Set(exam.map(q => q.contextId)).size, 1);
    assert.equal(new Set(exam.map(q => q.contextIndex)).size, 1);
    assert.equal(exam[0].contextId, context.id);
    assert.equal(exam[0].context, exam[1].context);
    assert.equal(exam[2].context, exam[4].context);
    assert.ok(exam[3].context.startsWith(exam[2].context));
    const target = context.models.findIndex(name => exam[0].prompt.includes(name));
    assert.ok(target >= 0);
    targets.get(index).add(target);
    for (const part of [0, 2, 3]) assert.ok(exam[part].prompt.includes(context.models[target]));
    for (const q of exam) {
      assert.deepEqual(q.table.rows.map(row => row[0]), context.models);
      const text = visibleText(q);
      assert.doesNotMatch(text, /\b(?:undefined|NaN|Infinity)\b/);
      for (const other of examContexts.filter(c => c !== context)) {
        for (const name of other.models) assert.ok(!text.includes(name), `${q.id}: leaked source ${name}`);
      }
      if (index) assert.doesNotMatch(text, /\b(?:toys?|workshops?|Harbor|Garden|Meadow)\b/);
    }
  }
  for (const [index, sourceTargets] of targets) assert.deepEqual([...sourceTargets].sort(), [0, 1, 2], examContexts[index].name);
});

test('the practice seed stride changes context even when uint32 seeds wrap', () => {
  // Keep this assertion tied to the actual UI implementation rather than a
  // second, silently diverging definition of how Another question advances.
  const app = readFileSync(new URL('../site/app.js', import.meta.url), 'utf8');
  assert.match(app, /const nextSeed = seed => \(seed \+ 0x9e3779b9\) >>> 0;/);
  const stride = 0x9e3779b9, wrapAt = 0x100000000 - stride;
  const seeds = new Set([0, 1, 0xffffffff, 0xfffffffe, wrapAt - 1, wrapAt, wrapAt + 1]);
  for (let i = 0; i < 200; i++) seeds.add(Math.imul(i, 0x9e3779b1) >>> 0);
  for (const seed of seeds) {
    const next = (seed + stride) >>> 0;
    assert.notEqual(generateExam(seed)[0].contextIndex, generateExam(next)[0].contextIndex);
    for (const skill of skills) assert.notEqual(generateQuestion(skill.id, seed).contextIndex, generateQuestion(skill.id, next).contextIndex);
  }
});
