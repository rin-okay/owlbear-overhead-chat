export const fonts = {
  sans: "Arial, sans-serif",
  serif: "Georgia, serif",
  mono: '"Courier New", monospace',
  rounded: '"Trebuchet MS", sans-serif',
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

export function drawBubble(text, style) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = `${style.size}px ${fonts[style.font]}`;
  ctx.font = font;
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    const joined = line ? `${line} ${word}` : word;
    if (ctx.measureText(joined).width <= 224) {
      line = joined;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    for (const char of word) {
      if (line && ctx.measureText(line + char).width > 224) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
  }
  lines.push(line);

  const width = Math.max(54, Math.ceil(Math.max(...lines.map((part) => ctx.measureText(part).width))) + 24);
  const lineHeight = Math.ceil(style.size * 1.3);
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
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = style.border;
  ctx.stroke();
  ctx.fillStyle = style.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((part, index) => ctx.fillText(part, middle, 8 + (index + 0.5) * lineHeight));
  return canvas;
}
