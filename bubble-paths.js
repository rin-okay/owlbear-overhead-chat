// Turn the bubble canvas into solid-color shapes for Owlbear's local scene.
// Adjacent runs with the same width are merged before creating path commands.
export function canvasPaths(canvas, colors, command) {
  const { width, height } = canvas;
  const { data } = canvas.getContext("2d").getImageData(0, 0, width, height);
  const palette = [...new Set(colors)].map((color) => ({
    color,
    rgb: color.slice(1).match(/../g).map((byte) => Number.parseInt(byte, 16)),
    commands: [],
  }));
  const mappedColors = new Map();
  const row = new Int8Array(width);
  const xAt = (x) => (x - width / 2) / 2;
  const yAt = (y) => (y - height) / 2;
  let previous = new Map();

  function drawRun({ color, left, right, top }, bottom) {
    palette[color].commands.push(
      [command.MOVE, xAt(left), yAt(top)], [command.LINE, xAt(right), yAt(top)],
      [command.LINE, xAt(right), yAt(bottom)], [command.LINE, xAt(left), yAt(bottom)],
      [command.CLOSE],
    );
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (x + y * width) * 4;
      if (data[i + 3] < 128) {
        row[x] = -1;
        continue;
      }
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      const key = r * 65536 + g * 256 + b;
      let best = mappedColors.get(key);
      if (best === undefined) {
        let nearest = Infinity;
        for (const [index, { rgb }] of palette.entries()) {
          const distance = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2;
          if (distance >= nearest) continue;
          best = index;
          nearest = distance;
        }
        mappedColors.set(key, best);
      }
      row[x] = best;
    }

    const current = new Map();
    for (let left = 0; left < width;) {
      const color = row[left];
      let right = left + 1;
      while (right < width && row[right] === color) right++;
      if (color >= 0) {
        const key = (color * width + left) * (width + 1) + right;
        current.set(key, previous.get(key) ?? { color, left, right, top: y });
        previous.delete(key);
      }
      left = right;
    }
    for (const run of previous.values()) drawRun(run, y);
    previous = current;
  }
  for (const run of previous.values()) drawRun(run, height);
  return palette.filter(({ commands }) => commands.length);
}
