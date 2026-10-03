import { skills, difficulties, generateQuestion, generateExam, GENERATOR_VERSION } from './questions.js';

export const STORAGE_KEY = 'bayesville.calculations.progress.v2';
export const SESSION_KEY = 'bayesville.calculations.session.v2';
const skillIds = new Set(skills.map(s => s.id));
const levels = new Set(difficulties.map(d => d.id));
const methods = new Set(['checked', 'self', 'revealed', 'skipped']);
const examCache = new Map();
function examFor(seed, difficulty) {
  const key = `${difficulty}:${seed}`;
  if (!examCache.has(key)) {
    if (examCache.size >= 100) examCache.delete(examCache.keys().next().value);
    examCache.set(key, generateExam(seed, difficulty));
  }
  return examCache.get(key);
}
export const roundTo = (n, places = 2) => Math.round((n + Number.EPSILON * Math.max(1, Math.abs(n))) * 10 ** places) / 10 ** places;

export function parseNumeric(raw, unit = 'probability') {
  let text = String(raw ?? '').trim();
  if (!text) return { error: 'Enter an answer first, or show the solution.' };
  if (text.includes(',') && !text.includes('.') && (text.match(/,/g) || []).length === 1) text = text.replace(',', '.');
  const percent = text.endsWith('%');
  if (percent && unit !== 'probability') return { error: 'Enter a number without a percent sign for this question.' };
  if (percent) text = text.slice(0, -1).trim();
  const pattern = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
  let value;
  if (new RegExp(`^${pattern}$`).test(text)) value = Number(text);
  else {
    const fraction = text.match(new RegExp(`^(${pattern})\\s*/\\s*(${pattern})$`));
    if (fraction && Number(fraction[2]) !== 0) value = Number(fraction[1]) / Number(fraction[2]);
  }
  if (!Number.isFinite(value)) return { error: 'Use a number such as 0.42, or a fraction such as 2/3.' };
  if (percent) value /= 100;
  if (value < 0) return { error: 'Enter a non-negative number.' };
  if (unit === 'probability' && value > 1) return { error: 'A probability must be between 0 and 1. Percentages such as 42% also work.' };
  return { value };
}

export function gradeAnswer(question, raw) {
  const parsed = parseNumeric(raw, question.unit || 'probability');
  if (parsed.error) return parsed;
  return { value: parsed.value, correct: roundTo(parsed.value, question.decimals ?? 2) === roundTo(question.answer, question.decimals ?? 2) };
}
export const formatAnswer = q => roundTo(q.answer, q.decimals ?? 2).toFixed(q.decimals ?? 2);
export function normalizeRef(raw) {
  if (!raw || raw.version !== GENERATOR_VERSION || !Number.isInteger(raw.seed) || raw.seed < 0 || raw.seed > 0xffffffff || !levels.has(raw.difficulty)) return null;
  if (raw.skillId === 'exam') {
    if (!Number.isInteger(raw.part) || raw.part < 0 || raw.part >= examFor(raw.seed, raw.difficulty).length) return null;
  } else if (!skillIds.has(raw.skillId)) return null;
  return { version: GENERATOR_VERSION, skillId: raw.skillId, difficulty: raw.difficulty, seed: raw.seed, ...(raw.skillId === 'exam' ? { part: raw.part } : {}) };
}
export const refKey = ref => `${ref.version}:${ref.skillId}:${ref.difficulty}:${ref.seed}${ref.skillId === 'exam' ? `:${ref.part}` : ''}`;
export const questionFor = ref => ref.skillId === 'exam' ? examFor(ref.seed, ref.difficulty)[ref.part] : generateQuestion(ref.skillId, ref.seed, ref.difficulty);
export const makeRef = (skillId, seed, difficulty = 'practice', part) => ({ version: GENERATOR_VERSION, skillId, seed: seed >>> 0, difficulty, ...(part !== undefined ? { part } : {}) });
export function appendEndlessRef(session, ref) {
  if (session.mode !== 'skill' || session.length !== 0) throw new Error('Only endless skill sessions can grow.');
  const refs = [...session.refs, ref];
  const overflow = Math.max(0, refs.length - 5000);
  if (!overflow) return { ...session, refs };
  const kept = refs.slice(overflow);
  const keys = new Set(kept.map(refKey));
  return { ...session, refs: kept, index: session.index - overflow, offset: (session.offset || 0) + overflow,
    answers: session.answers.filter(a => keys.has(a.key)) };
}
export function emptyProgress() { return { version: GENERATOR_VERSION, attempts: [], bookmarks: [] }; }
export function normalizeProgress(raw) {
  if (!raw || raw.version !== GENERATOR_VERSION) return emptyProgress();
  const attempts = [];
  if (Array.isArray(raw.attempts)) for (const a of raw.attempts.slice(-5000)) {
    const ref = normalizeRef(a?.ref);
    if (!ref || typeof a.id !== 'string' || a.id.length > 150 || ![true, false, null].includes(a.correct) || !methods.has(a.method) || typeof a.at !== 'string' || !Number.isFinite(Date.parse(a.at))) continue;
    attempts.push({ id: a.id, ref, correct: a.correct, method: a.method, hinted: Boolean(a.hinted), at: a.at });
  }
  const refs = new Map();
  if (Array.isArray(raw.bookmarks)) for (const b of raw.bookmarks.slice(-500)) { const ref = normalizeRef(b); if (ref) refs.set(refKey(ref), ref); }
  return { version: GENERATOR_VERSION, attempts: [...new Map(attempts.map(a => [a.id, a])).values()], bookmarks: [...refs.values()] };
}
export function recordAttempt(progress, attempt) {
  return { ...progress, attempts: [...progress.attempts.filter(a => a.id !== attempt.id), attempt].slice(-5000) };
}
export function latestAttempts(progress) {
  const latest = new Map();
  for (const attempt of progress.attempts) { latest.delete(refKey(attempt.ref)); latest.set(refKey(attempt.ref), attempt); }
  return latest;
}
export function reviewRefs(progress) { return [...latestAttempts(progress).values()].filter(a => a.correct !== true).reverse().map(a => a.ref); }
export function summarize(progress, skillId) {
  const attempts = progress.attempts.filter(a => !skillId || a.ref.skillId === skillId);
  const checked = attempts.filter(a => a.method === 'checked');
  return { attempts: attempts.length, checked: checked.length, correct: checked.filter(a => a.correct).length,
    self: attempts.filter(a => a.method === 'self').length, review: reviewRefs(progress).filter(r => !skillId || r.skillId === skillId).length };
}
export function restoreSession(raw) {
  if (!raw || raw.version !== GENERATOR_VERSION || typeof raw.id !== 'string' || raw.id.length > 100 || !['skill', 'exam', 'review'].includes(raw.mode) || !Array.isArray(raw.refs) || !raw.refs.length || raw.refs.length > 5000) return null;
  const refs = raw.refs.map(normalizeRef);
  if (refs.some(r => !r) || new Set(refs.map(refKey)).size !== refs.length || !Number.isInteger(raw.index) || raw.index < 0 || raw.index >= refs.length || ![0, 5, 10].includes(raw.length) && raw.length !== refs.length) return null;
  if (!levels.has(raw.difficulty) || (raw.mode === 'skill' && !skillIds.has(raw.skillId))) return null;
  if (raw.mode === 'skill' && refs.some(r => r.skillId !== raw.skillId || r.difficulty !== raw.difficulty)) return null;
  if (raw.mode === 'skill' && (raw.length !== 0 && (raw.length !== refs.length || ![5, 10].includes(raw.length)))) return null;
  if (raw.mode === 'exam' && (raw.skillId !== 'exam' || raw.length !== refs.length || refs.length !== examFor(refs[0].seed, raw.difficulty).length || refs.some((r,i) => r.skillId !== 'exam' || r.seed !== refs[0].seed || r.difficulty !== raw.difficulty || r.part !== i))) return null;
  if (raw.mode === 'review' && (raw.skillId !== 'review' || raw.length !== refs.length)) return null;
  const allowed = new Set(refs.slice(0, raw.index + 1).map(refKey));
  const answers = new Map();
  if (Array.isArray(raw.answers)) for (const a of raw.answers) {
    if (a && allowed.has(a.key) && [true, false, null].includes(a.correct) && methods.has(a.method)) answers.set(a.key, { key: a.key, correct: a.correct, method: a.method, raw: typeof a.raw === 'string' ? a.raw.slice(0, 100) : '', hinted: Boolean(a.hinted) });
  }
  const q = questionFor(refs[raw.index]);
  const steps = q.steps.map((step, i) => {
    const saved = raw.steps?.[i];
    const input = typeof saved?.input === 'string' ? saved.input.slice(0, 100) : '';
    return { input, ...(saved?.checked ? { checked: true, ...gradeAnswer(step, input) } : {}) };
  });
  return { version: GENERATOR_VERSION, id: raw.id, mode: raw.mode, skillId: raw.skillId, difficulty: raw.difficulty,
    length: raw.length, refs, index: raw.index, answers: [...answers.values()], hint: Number.isInteger(raw.hint) ? Math.max(0, Math.min(raw.hint, q.hints.length)) : 0,
    offset: Number.isSafeInteger(raw.offset) && raw.offset >= 0 ? raw.offset : 0,
    input: typeof raw.input === 'string' ? raw.input.slice(0, 100) : '', notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 5000) : '',
    guided: Boolean(raw.guided), steps, complete: Boolean(raw.complete) };
}
