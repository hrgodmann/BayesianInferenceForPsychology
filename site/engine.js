// Arithmetic can land a few machine-precision units below an exact half.
// Snap only that tiny neighborhood to the half before rounding; this does not
// provide a general tolerance for mathematically different student answers.
export function roundTo(n, places = 2) {
  const scale = 10 ** places;
  let scaled = n * scale;
  const half = Math.floor(scaled) + 0.5;
  const noise = 16 * Number.EPSILON * Math.max(1, Math.abs(scaled));
  if (Math.abs(scaled - half) <= noise) scaled = half;
  return Math.round(scaled) / scale;
}

function finiteNumericComponent(text) {
  const value = Number(text);
  // A nonzero mantissa can silently become signed zero below the numeric
  // range. Preserve genuine zeros such as 0e-999, but reject that underflow.
  const nonzeroMantissa = /[1-9]/.test(text.split(/[eE]/)[0]);
  return Number.isFinite(value) && !(value === 0 && nonzeroMantissa) ? value : undefined;
}

export function parseNumeric(raw, unit = 'probability') {
  let text = String(raw ?? '').trim();
  if (!text) return { error: 'Enter an answer first, or show the solution.' };
  if (text.includes(',') && !text.includes('.') && (text.match(/,/g) || []).length === 1) text = text.replace(',', '.');
  const percent = text.endsWith('%');
  if (percent && unit !== 'probability') return { error: 'Enter a number without a percent sign for this question.' };
  if (percent) text = text.slice(0, -1).trim();
  const pattern = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
  let value;
  if (new RegExp(`^${pattern}$`).test(text)) value = finiteNumericComponent(text);
  else {
    const fraction = text.match(new RegExp(`^(${pattern})\\s*/\\s*(${pattern})$`));
    if (fraction) {
      const numerator = finiteNumericComponent(fraction[1]);
      const denominator = finiteNumericComponent(fraction[2]);
      if (numerator !== undefined && denominator !== undefined && denominator !== 0) {
        value = numerator / denominator;
        if (numerator !== 0 && value === 0) value = undefined;
      }
    }
  }
  if (!Number.isFinite(value)) return { error: 'Use a number such as 0.42, or a fraction such as 2/3.' };
  if (value < 0) return { error: 'Enter a non-negative number.' };
  if (percent) {
    const converted = value / 100;
    if (value !== 0 && converted === 0) return { error: 'Use a number such as 0.42, or a fraction such as 2/3.' };
    value = converted;
  }
  if (unit === 'probability' && value > 1) return { error: 'A probability must be between 0 and 1. Percentages such as 42% also work.' };
  return { value };
}

export function gradeAnswer(question, raw) {
  const parsed = parseNumeric(raw, question.unit || 'probability');
  if (parsed.error) return parsed;
  return { value: parsed.value, correct: roundTo(parsed.value, question.decimals ?? 2) === roundTo(question.answer, question.decimals ?? 2) };
}
export const formatAnswer = q => roundTo(q.answer, q.decimals ?? 2).toFixed(q.decimals ?? 2);
