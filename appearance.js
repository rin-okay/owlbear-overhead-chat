export const BUBBLE_LINE_HEIGHT = 1.15;

export const fonts = {
  sans: { face: "Arial", fallback: "sans-serif" },
  serif: { face: "Georgia", fallback: "serif" },
  mono: { face: "Courier New", fallback: "monospace" },
  comic: { face: "Comic Sans MS", fallback: '"Comic Sans", cursive' },
  rounded: { face: "Trebuchet MS", fallback: "sans-serif" },
};

const defaults = {
  name: "", border: "#8b75b5", fill: "#fbf6ff", color: "#241d31", font: "sans", size: 15,
};

export function normalizeAppearance(value) {
  const color = (key) => {
    const candidate = value?.[key];
    return typeof candidate === "string" && /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : defaults[key];
  };
  const size = value?.size;
  return {
    name: typeof value?.name === "string" ? value.name.trim().replace(/\s+/gu, " ").slice(0, 32) : "",
    border: color("border"),
    fill: color("fill"),
    color: color("color"),
    font: typeof value?.font === "string" && Object.hasOwn(fonts, value.font) ? value.font : defaults.font,
    size: Number.isInteger(size) ? Math.max(10, Math.min(28, size)) : defaults.size,
  };
}

function wrapParagraph(paragraph, measure) {
  const limit = 192;
  const lines = [];
  let line = "";
  let continuedWord = false;
  for (const word of paragraph.split(" ")) {
    const joined = line ? `${line} ${word}` : word;
    if (measure(joined) <= limit) {
      line = joined;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    continuedWord = false;
    for (const char of word) {
      if (line && measure(line + char) > limit) {
        lines.push(line);
        line = "";
        continuedWord = true;
      }
      line += char;
    }
  }

  if (lines.length && Array.from(line).length === 1) {
    const previous = lines.at(-1);
    const split = previous.lastIndexOf(" ");
    if (split > 0 && measure(`${previous.slice(split + 1)} ${line}`) <= limit) {
      lines[lines.length - 1] = previous.slice(0, split);
      line = `${previous.slice(split + 1)} ${line}`;
    } else if (continuedWord) {
      const chars = Array.from(previous);
      if (chars.length > 2 && measure(chars.at(-1) + line) <= limit) {
        line = chars.pop() + line;
        lines[lines.length - 1] = chars.join("");
      }
    }
  }
  lines.push(line);
  return lines;
}

export function drawBubble(text, style) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const { face, fallback } = fonts[style.font];
  const font = `${style.size}px "${face}", ${fallback}`;
  ctx.font = font;
  const lines = text.split("\n").flatMap((paragraph) =>
    wrapParagraph(paragraph, (line) => ctx.measureText(line).width));

  const width = Math.max(32, Math.ceil(Math.max(...lines.map((part) => ctx.measureText(part).width))) + 18);
  const lineHeight = Math.ceil(style.size * BUBBLE_LINE_HEIGHT);
  const body = 16 + lineHeight * lines.length;
  const height = body + 9;
  canvas.width = width * 2;
  canvas.height = height * 2;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(2, 2);
  ctx.font = font;
  const middle = width / 2;
  ctx.beginPath();
  ctx.moveTo(10, 1);
  ctx.arcTo(width - 1, 1, width - 1, body, 9);
  ctx.arcTo(width - 1, body, middle + 6, body, 9);
  ctx.lineTo(middle + 6, body);
  ctx.lineTo(middle, height - 2);
  ctx.lineTo(middle - 6, body);
  ctx.arcTo(1, body, 1, 1, 9);
  ctx.arcTo(1, 1, 10, 1, 9);
  ctx.closePath();
  ctx.fillStyle = style.fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = style.border;
  ctx.stroke();
  ctx.fillStyle = style.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((part, index) => ctx.fillText(part, middle, 8 + (index + 0.5) * lineHeight));
  return { canvas, lines };
}
