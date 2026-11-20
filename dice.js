const MAX_ROLLS = 4;
const MAX_NOTATION = 80;

export function rollSpans(text) {
  const command = /^(?:(?:\.\/|\/)?r|\/roll)(?:\s+|$)(.*)$/is.exec(text);
  if (command) return [{ start: 0, end: text.length, notation: command[1].trim() }];
  return [...text.matchAll(/\br\[([^\[\]\n]*)\]/gi)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    notation: match[1].trim(),
  }));
}

export function validateRollSpans(spans) {
  if (spans.length > MAX_ROLLS) throw new Error("Use up to four rolls per message.");
  for (const { notation } of spans) {
    if (!notation || notation.length > MAX_NOTATION || !/d(?:\d|f|%)/i.test(notation.replace(/\s/g, ""))) {
      throw new Error("Enter dice notation like /r 1d20+7 or r[2d20kh1].");
    }
  }
}

export function chatParts(text, results) {
  if (!Array.isArray(results) || !results.length || results.length > MAX_ROLLS) return [text];
  const spans = rollSpans(text);
  if (results.length !== spans.length || !results.every((roll) =>
    Number.isFinite(roll?.total) && typeof roll.detail === "string" && roll.detail.length <= 1200)) return [text];

  const parts = [];
  let cursor = 0;
  for (const [index, { start, end, notation }] of spans.entries()) {
    if (!notation || notation.length > MAX_NOTATION) return [text];
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push({ ...results[index], notation });
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function randomFace(sides) {
  const draw = new Uint32Array(1);
  const limit = 2 ** 32 - (2 ** 32 % sides);
  do crypto.getRandomValues(draw); while (draw[0] >= limit);
  return draw[0] % sides + 1;
}

export function rollInChat(notation, face = randomFace) {
  const expression = notation.toLowerCase().replace(/\s/g, "");
  const term = /([+-]?)(?:(\d*)d(\d+|%)(?:(kh|kl|dh|dl)(\d+))?|(\d+))/y;
  let total = 0;
  let cursor = 0;
  let diceCount = 0;
  const details = [];
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
      total += factor * Number(constant);
      details.push(sign + constant);
      continue;
    }

    const countValue = Number(count || 1);
    const sidesValue = sides === "%" ? 100 : Number(sides);
    const filterCount = Number(amount || 0);
    diceCount += countValue;
    if (countValue < 1 || diceCount > 100 || sidesValue < 2 || sidesValue > 1000 || filterCount > countValue) {
      throw new Error("Use up to 100 dice with 2 to 1,000 sides and a valid keep or drop count.");
    }
    const values = Array.from({ length: countValue }, () => face(sidesValue));
    const sorted = values.map((value, index) => ({ value, index }))
      .sort((a, b) => filter?.endsWith("l") ? a.value - b.value : b.value - a.value);
    const chosen = new Set(sorted.slice(0, filterCount).map(({ index }) => index));
    const kept = (index) => !filter || (filter.startsWith("k") === chosen.has(index));
    values.forEach((value, index) => { if (kept(index)) total += factor * value; });
    details.push(`${match[0]} → [${values.map((value, index) => kept(index) ? value : `${value} dropped`).join(", ")}]`);
  }
  if (!diceCount) throw new Error("Enter a dice expression like 1d20+7.");
  return { total, detail: details.join("\n").slice(0, 1200) };
}
