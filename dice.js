import { percentileTerms } from "./percentile.js";

const MAX_NOTATION = 80;

const ROLL_COMMAND = /^\/r(?:\s+|$)(.*)$/is;
export const isRollCommand = (text) => ROLL_COMMAND.test(text);

export function rollSpans(text) {
  const command = ROLL_COMMAND.exec(text);
  if (command) return [{ start: 0, end: text.length, notation: command[1].trim() }];
  return [];
}

export function validateRollSpans(spans) {
  for (const { notation } of spans) {
    if (!notation || notation.length > MAX_NOTATION || !/d(?:\d|f|%)/i.test(notation.replace(/\s/g, ""))) {
      throw new Error("Enter dice notation like /r 1d20+7 or /r 2d20kh1.");
    }
  }
}

export function chatParts(text, results) {
  if (!Array.isArray(results) || results.length !== 1) return [text];
  const spans = rollSpans(text);
  if (results.length !== spans.length || !results.every((roll) =>
    Number.isFinite(roll?.total) && typeof roll.detail === "string" && roll.detail.length <= 1200)) return [text];

  const parts = [];
  let cursor = 0;
  for (const [index, { start, end, notation }] of spans.entries()) {
    if (!notation || notation.length > MAX_NOTATION) return [text];
    if (start > cursor) parts.push(text.slice(cursor, start));
    const { total, detail, breakdown } = results[index];
    parts.push({ total, detail, notation, breakdown: validBreakdown(breakdown, total) ? breakdown : undefined });
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function validBreakdown(breakdown, total) {
  return Array.isArray(breakdown) && breakdown.length > 0 && breakdown.length <= 140 &&
    breakdown.every((value) => Number.isSafeInteger(value) ? Math.abs(value) <= 99999999 :
      typeof value === "string" && /^(?:~-?[1-9]\d{0,3}|~?p-?(?:[1-9]\d?|100))$/.test(value)) &&
    breakdown.reduce((sum, value) => {
      if (typeof value === "number") return sum + value;
      return value.startsWith("p") ? sum + Number(value.slice(1)) : sum;
    }, 0) === total;
}

export function randomFace(sides) {
  const draw = new Uint32Array(1);
  const limit = 2 ** 32 - (2 ** 32 % sides);
  do crypto.getRandomValues(draw); while (draw[0] >= limit);
  return draw[0] % sides + 1;
}

export function parseDice(notation) {
  const expression = notation.toLowerCase().replace(/\s/g, "");
  const term = /([+-]?)(?:(\d*)d(\d+|%)(?:(kh|kl|dh|dl)(\d+))?|(\d+))/y;
  let cursor = 0;
  let diceCount = 0;
  const terms = [];
  while (cursor < expression.length) {
    term.lastIndex = cursor;
    const match = term.exec(expression);
    if (!match || (cursor && !match[1])) {
      throw new Error("Use standard dice notation or enable Rumble! for more roll types.");
    }
    cursor = term.lastIndex;
    const [, sign, count, sides, filter, amount, constant] = match;
    const factor = sign === "-" ? -1 : 1;
    if (constant !== undefined) {
      if (constant.length > 8) throw new Error("Dice modifiers must have at most eight digits.");
      terms.push({ text: match[0], constant: factor * Number(constant) });
      continue;
    }

    const countValue = Number(count || 1);
    const sidesValue = sides === "%" ? 100 : Number(sides);
    const filterCount = Number(amount || 0);
    diceCount += countValue;
    if (countValue < 1 || diceCount > 100 || sidesValue < 2 || sidesValue > 1000 || filterCount > countValue) {
      throw new Error("Use up to 100 dice with 2 to 1,000 sides and a valid keep or drop count.");
    }
    terms.push({ text: match[0], factor, count: countValue, sides: sidesValue, filter, filterCount });
  }
  if (!diceCount) throw new Error("Enter a dice expression like 1d20+7.");
  return terms;
}

export function scoreDice(terms, face = randomFace) {
  let total = 0;
  const details = [];
  const breakdown = [];
  for (const { text, constant, factor, count, sides, filter, filterCount } of terms) {
    if (constant !== undefined) {
      total += constant;
      breakdown.push(constant);
      details.push(text);
      continue;
    }
    const dice = Array.from({ length: count }, () => face(sides));
    const values = dice.map((die) => typeof die === "number" ? die : die.value);
    const sorted = values.map((value, index) => ({ value, index }))
      .sort((a, b) => filter?.endsWith("l") ? a.value - b.value : b.value - a.value);
    const chosen = new Set(sorted.slice(0, filterCount).map(({ index }) => index));
    const kept = (index) => !filter || (filter.startsWith("k") === chosen.has(index));
    values.forEach((value, index) => {
      const keep = kept(index);
      const signedValue = factor * value;
      if (keep) total += signedValue;
      if (sides === 100) breakdown.push(`${keep ? "" : "~"}p${signedValue}`);
      else breakdown.push(keep ? signedValue : `~${signedValue}`);
      if (typeof dice[index] === "object") dice[index].kept = keep;
    });
    const faces = values.map((value, index) => {
      const label = sides === 100 ? `${percentileTerms(value)}${value === 100 ? " → 100" : ""}` : value;
      return kept(index) ? label : `${label} dropped`;
    });
    details.push(`${text} → [${faces.join(", ")}]`);
  }
  return { total, detail: details.join("\n").slice(0, 1200), breakdown };
}
