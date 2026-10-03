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
