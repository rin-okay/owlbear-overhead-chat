export const BUBBLE_LINE_HEIGHT = 1.15;

export const fonts = {
  sans: { face: "Arial", fallback: "sans-serif" },
  inter: { face: "Inter", fallback: "Arial, sans-serif", file: "inter-latin.woff2", gmOnly: true },
  serif: { face: "Georgia", fallback: "serif" },
  garamond: { face: "EB Garamond", fallback: '"Garamond", Georgia, serif', nativeFace: "Garamond", file: "eb-garamond-latin.woff2" },
  mono: { face: "Courier New", fallback: "monospace" },
  comic: { face: "Comic Sans MS", fallback: '"Comic Sans", "Chalkboard SE", Chalkboard, cursive' },
  rounded: { face: "Trebuchet MS", fallback: '"Avenir Next", Verdana, sans-serif' },
};

const defaults = {
  name: "", border: "#8b75b5", fill: "#fbf6ff", color: "#241d31", font: "sans", size: 15,
};

export function normalizeAppearance(value, role) {
  const color = (key) => {
    const candidate = value?.[key];
    return typeof candidate === "string" && /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : defaults[key];
  };
  const size = value?.size;
  const font = typeof value?.font === "string" && Object.hasOwn(fonts, value.font) ? fonts[value.font] : undefined;
  return {
    name: typeof value?.name === "string" ? value.name.trim().replace(/\s+/gu, " ").slice(0, 32) : "",
    border: color("border"),
    fill: color("fill"),
    color: color("color"),
    font: font && (!font.gmOnly || role === undefined || role === "GM") ? value.font : defaults.font,
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

const bubbleFontsReady = new Map();

export function prepareBubbleFont(style) {
  const { face, file } = fonts[style.font];
  if (!file) return;
  if (!bubbleFontsReady.has(file)) {
    const ready = (async () => {
      const url = new URL("./fonts/" + file, import.meta.url);
      const font = new FontFace(face, `url("${url}") format("woff2")`, { weight: "400 800" });
      document.fonts.add(await font.load());
    })().catch((error) => console.warn("Overhead Chat could not load " + face, error));
    bubbleFontsReady.set(file, ready);
  }
  return bubbleFontsReady.get(file);
}

function bubbleFont(style) {
  const { face, fallback } = fonts[style.font];
  return `${style.size}px "${face}", ${fallback}`;
}

export function drawBubble(text, style) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = bubbleFont(style);
  ctx.font = font;
  const lines = text.split("\n").flatMap((paragraph) =>
    wrapParagraph(paragraph, (line) => ctx.measureText(line).width));

  const characterWidth = ctx.measureText("0").width;
  const contentWidth = Math.ceil(Math.max(characterWidth * 3, ...lines.map((part) => ctx.measureText(part).width)));
  const extraPadding = Math.ceil(characterWidth);
  const width = Math.max(32, contentWidth + 18 + extraPadding * 2);
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
  return { canvas, lines, width };
}

export function drawFloatingBubble(text, style) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = `bold ${bubbleFont(style)}`;
  ctx.font = font;
  const lines = text.split("\n").flatMap((paragraph) =>
    wrapParagraph(paragraph, (line) => ctx.measureText(line).width));
  const width = Math.max(32, Math.ceil(Math.max(...lines.map((line) => ctx.measureText(line).width))) + 23);
  const lineHeight = Math.ceil(style.size * BUBBLE_LINE_HEIGHT);
  const body = lines.length * lineHeight + 10;
  const height = body + 7;
  const tail = Math.floor(width / 2);
  canvas.width = width * 2;
  canvas.height = height * 2;
  ctx.scale(2, 2);

  const [outline, fill, accent, ink] = ["#2c222d", "#fef8e9", style.border, "#271f29"];
  ctx.fillStyle = outline;
  ctx.fillRect(3, 0, width - 6, body + 3);
  ctx.fillRect(0, 3, width, body - 3);
  ctx.fillRect(tail - 5, body, 10, 3);
  ctx.fillRect(tail - 3, body + 3, 6, 2);
  ctx.fillRect(tail - 1, body + 5, 2, 2);
  ctx.fillStyle = fill;
  ctx.fillRect(3, 2, width - 6, body - 2);
  ctx.fillRect(2, 4, width - 4, body - 6);
  ctx.fillRect(tail - 2, body, 4, 3);
  ctx.fillStyle = accent;
  ctx.fillRect(5, 5, 3, body - 10);
  ctx.fillStyle = ink;
  ctx.font = font;
  ctx.textBaseline = "middle";
  lines.forEach((line, index) => ctx.fillText(line, 13, 5 + (index + 0.5) * lineHeight));
  return { canvas, width, height, lines, colors: [outline, fill, accent, ink] };
}
