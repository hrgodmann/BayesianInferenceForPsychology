export const STORAGE_KEY = 'bayesville.progress.v1';
export const SESSION_KEY = 'bayesville.session.v1';
export const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

export function parseNumeric(raw, unit = 'probability') {
  let text = String(raw ?? '').trim();
  if (!text) return { error: 'Enter an answer first, or reveal the solution below.' };
  if (text.includes(',') && !text.includes('.') && (text.match(/,/g) || []).length === 1) text = text.replace(',', '.');
  const percent = text.endsWith('%');
  if (percent && unit !== 'probability') return { error: 'Enter a number, without a percent sign, for this question.' };
  if (percent) text = text.slice(0, -1).trim();
  const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
  let value;
  if (new RegExp(`^${number}$`).test(text)) value = Number(text);
  else {
    const fraction = text.match(new RegExp(`^(${number})\\s*/\\s*(${number})$`));
    if (fraction && Number(fraction[2]) !== 0) value = Number(fraction[1]) / Number(fraction[2]);
  }
  if (!Number.isFinite(value)) return { error: 'Use a number such as 0.42. Fractions such as 2/3 also work.' };
  if (percent) value /= 100;
  if (unit === 'probability' && (value < 0 || value > 1)) return { error: 'A probability must be between 0 and 1. You can also enter a percentage, such as 42%.' };
  if (value < 0) return { error: 'This question needs a non-negative answer.' };
  return { value };
}

export function gradeAnswer(question, raw) {
  if (question.type === 'tf') {
    if (typeof raw !== 'boolean') return { error: 'Choose True or False first.' };
    return { correct: raw === question.answer, value: raw };
  }
  const parsed = parseNumeric(raw, question.unit || 'probability');
  if (parsed.error) return parsed;
  return { correct: round2(parsed.value) === round2(question.answer), value: parsed.value };
}

export function formatAnswer(question) {
  if (question.type === 'tf') return question.answer ? 'True' : 'False';
  const unit = question.unit && !['probability', 'odds', 'ratio', 'number'].includes(question.unit) ? ` ${question.unit}` : '';
  return `${round2(question.answer).toFixed(2)}${unit}`;
}

export function emptyProgress() { return { version: 1, attempts: [], bookmarks: [] }; }

export function normalizeProgress(raw, validIds) {
  if (!raw || raw.version !== 1) return emptyProgress();
  const valid = new Set(validIds);
  const attempts = Array.isArray(raw.attempts) ? raw.attempts.filter(a =>
    a && typeof a.id === 'string' && valid.has(a.questionId) &&
    [true, false, null].includes(a.correct) && typeof a.at === 'string' && Number.isFinite(Date.parse(a.at))
  ).slice(-5000).map(a => ({
    id: a.id, questionId: a.questionId, correct: a.correct,
    method: ['checked', 'self', 'skipped'].includes(a.method) ? a.method : 'checked',
    hinted: Boolean(a.hinted), at: a.at
  })) : [];
  return { version: 1, attempts, bookmarks: Array.isArray(raw.bookmarks) ? [...new Set(raw.bookmarks.filter(id => valid.has(id)))] : [] };
}

export function latestAttempts(progress) {
  const latest = new Map();
  for (const attempt of progress.attempts) {
    latest.delete(attempt.questionId);
    latest.set(attempt.questionId, attempt);
  }
  return latest;
}

export function recordAttempt(progress, attempt) {
  const attempts = progress.attempts.filter(a => a.id !== attempt.id);
  return { ...progress, attempts: [...attempts, attempt].slice(-5000) };
}

export function selectQuestions(bank, options = {}, progress = emptyProgress()) {
  const latest = latestAttempts(progress);
  return bank.filter(q =>
    (!options.chapterId || options.chapterId === 'all' || q.chapterId === options.chapterId) &&
    (!options.type || options.type === 'mixed' || q.type === options.type) &&
    (options.pool !== 'review' || (latest.has(q.id) && latest.get(q.id).correct !== true)) &&
    (options.pool !== 'bookmarks' || progress.bookmarks.includes(q.id))
  );
}

export function shuffle(items, random = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function summarize(progress, ids) {
  const valid = new Set(ids);
  const latest = [...latestAttempts(progress).values()].filter(a => valid.has(a.questionId));
  return {
    practiced: latest.length,
    understood: latest.filter(a => a.correct === true).length,
    review: latest.filter(a => a.correct !== true).length,
    checked: progress.attempts.filter(a => valid.has(a.questionId) && a.method === 'checked').length,
    checkedCorrect: progress.attempts.filter(a => valid.has(a.questionId) && a.method === 'checked' && a.correct === true).length
  };
}

export function restoreSession(raw, bank) {
  const valid = new Set(bank.map(q => q.id));
  if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.ids) || !raw.ids.length ||
    raw.ids.some(id => !valid.has(id)) || new Set(raw.ids).size !== raw.ids.length ||
    !Number.isInteger(raw.index) || raw.index < 0 || raw.index >= raw.ids.length) return null;
  const sessionIds = new Set(raw.ids.slice(0, raw.index + 1));
  const answerMap = new Map();
  if (Array.isArray(raw.answers)) raw.answers.forEach(a => {
    if (!a || !sessionIds.has(a.questionId) || ![true, false, null].includes(a.correct)) return;
    answerMap.set(a.questionId, { questionId: a.questionId, correct: a.correct, method: ['checked', 'self', 'skipped'].includes(a.method) ? a.method : 'skipped',
      hinted: Boolean(a.hinted), raw: typeof a.raw === 'boolean' || typeof a.raw === 'string' ? a.raw : '' });
  });
  const answers = [...answerMap.values()];
  return {
    id: raw.id, ids: raw.ids, index: raw.index, answers,
    chapterId: typeof raw.chapterId === 'string' ? raw.chapterId : 'all',
    type: ['tf', 'calculation', 'mixed'].includes(raw.type) ? raw.type : 'mixed',
    pool: ['all', 'review', 'bookmarks'].includes(raw.pool) ? raw.pool : 'all',
    hint: [0, 1, 2].includes(raw.hint) ? raw.hint : 0,
    revealed: Boolean(raw.revealed), selection: typeof raw.selection === 'boolean' ? raw.selection : null,
    input: typeof raw.input === 'string' ? raw.input.slice(0, 100) : '',
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 5000) : '',
    complete: Boolean(raw.complete)
  };
}
