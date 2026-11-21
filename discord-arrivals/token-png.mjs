export const TOKEN_SIZE = 256;
const signature = Uint8Array.of(137,80,78,71,13,10,26,10);
const ascii = new TextDecoder();
const encoder = new TextEncoder();
const channelsByType = {0:1, 2:3, 3:1, 4:2, 6:4};

async function readBytes(stream, limit) {
  const reader = stream.getReader();
  const output = new Uint8Array(limit);
  let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) return output.subarray(0, length);
      if (length + value.length > limit) throw Error("Avatar image exceeds its size limit.");
      output.set(value, length);
      length += value.length;
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function paeth(left, up, diagonal) {
  const estimate = left + up - diagonal;
  const a = Math.abs(estimate - left), b = Math.abs(estimate - up), c = Math.abs(estimate - diagonal);
  return a <= b && a <= c ? left : b <= c ? up : diagonal;
}

// Discord serves static PNGs. Reconstruct scanlines before applying the circular mask.
async function decodeAvatar(stream) {
  const bytes = await readBytes(stream, 512 * 1024);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 45 || !signature.every((byte,i) => bytes[i] === byte) ||
      view.getUint32(8) !== 13 || ascii.decode(bytes.subarray(12,16)) !== "IHDR") throw Error("Invalid avatar PNG.");
  const width = view.getUint32(16), height = view.getUint32(20), depth = bytes[24], type = bytes[25];
  const channels = channelsByType[type];
  if (!width || !height || width > TOKEN_SIZE || height > TOKEN_SIZE ||
      !channels || (depth !== 8 && !([0,3].includes(type) && [1,2,4].includes(depth))) ||
      bytes[26] || bytes[27] || bytes[28]) throw Error("Unsupported avatar PNG.");
  const compressed = new Uint8Array(bytes.length);
  let size = 0, palette, transparency;
  for (let offset = 33; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset);
    const end = offset + length + 12;
    if (end > bytes.length) throw Error("Truncated avatar PNG.");
    const name = ascii.decode(bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, end - 4);
    if (name === "IDAT") { compressed.set(data, size); size += length; }
    if (name === "PLTE") palette = data;
    if (name === "tRNS") transparency = data;
    if (name === "IEND") break;
    offset = end;
  }
  if (!size || (type === 3 && !palette?.length)) throw Error("Incomplete avatar PNG.");
  const rowSize = Math.ceil(width * channels * depth / 8);
  const bpp = Math.ceil(channels * depth / 8);
  const stride = rowSize + 1;
  const inflated = await readBytes(
    new Blob([compressed.subarray(0,size)]).stream().pipeThrough(new DecompressionStream("deflate")), stride * height,
  );
  if (inflated.length !== stride * height) throw Error("Invalid avatar pixel data.");
  for (let y = 0; y < height; y++) {
    const start = y * stride;
    const filter = inflated[start];
    if (filter > 4) throw Error("Invalid avatar PNG filter.");
    if (filter === 0) continue;
    for (let x = 0; x < rowSize; x++) {
      const i = start + 1 + x;
      const left = x >= bpp ? inflated[i-bpp] : 0;
      const up = y ? inflated[i-stride] : 0;
      const diagonal = y && x >= bpp ? inflated[i-stride-bpp] : 0;
      switch (filter) {
        case 1: inflated[i] += left; break;
        case 2: inflated[i] += up; break;
        case 3: inflated[i] += (left + up) >> 1; break;
        case 4: inflated[i] += paeth(left, up, diagonal); break;
      }
    }
  }
  const maxSample = (1 << depth) - 1;
  const transparent = (index) => transparency?.length > index + 1
    ? (transparency[index] << 8) | transparency[index + 1] : -1;
  return {width, height, sample(x,y,output,i) {
    const start = y * stride + 1;
    const bit = x * depth;
    const p = start + x * channels;
    if (type === 3 || type === 0) {
      const index = (inflated[start + (bit >> 3)] >> (8 - depth - bit % 8)) & maxSample;
      const gray = Math.round(index * 255 / maxSample);
      output[i] = type === 3 ? palette[index * 3] : gray;
      output[i + 1] = type === 3 ? palette[index * 3 + 1] : gray;
      output[i + 2] = type === 3 ? palette[index * 3 + 2] : gray;
      return type === 3 ? transparency?.[index] ?? 255 : Number(index !== transparent(0)) * 255;
    }
    const red = inflated[p], green = type === 4 ? red : inflated[p + 1], blue = type === 4 ? red : inflated[p + 2];
    output[i] = red; output[i + 1] = green; output[i + 2] = blue;
    if (type === 2) return red === transparent(0) && green === transparent(2) && blue === transparent(4) ? 0 : 255;
    return inflated[p + channels - 1];
  }};
}

const crcTable = Uint32Array.from({length:256}, (_, index) => {
  for (let bit = 0; bit < 8; bit++) index = (index >>> 1) ^ ((index & 1) ? 0xedb88320 : 0);
  return index;
});

function pngChunk(type, data) {
  const chunk = new Uint8Array(data.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0,data.length);
  chunk.set(encoder.encode(type),4);
  chunk.set(data,8);
  let crc = 0xffffffff;
  for (let i = 4; i < chunk.length - 4; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ chunk[i]) & 255];
  view.setUint32(chunk.length - 4,crc ^ 0xffffffff);
  return chunk;
}

export async function renderTokenPng(stream) {
  const avatar = await decodeAvatar(stream);
  const mid = TOKEN_SIZE / 2;
  const radius = mid - 2;
  const portrait = radius - 5;
  const square = Math.min(avatar.width, avatar.height);
  const stride = 1 + TOKEN_SIZE * 4;
  const rows = new Uint8Array(stride * TOKEN_SIZE);
  const crop = (axis, length) => Math.min(length - 1, Math.max(0, Math.floor((length - square) / 2 +
    (axis + 0.5 - mid + portrait) * square / (portrait * 2))));
  for (let y = 0; y < TOKEN_SIZE; y++) {
    const sy = crop(y, avatar.height);
    for (let x = 0; x < TOKEN_SIZE; x++) {
      const distance = Math.sqrt((x + 0.5 - mid) ** 2 + (y + 0.5 - mid) ** 2);
      if (distance >= radius + 0.5) continue;
      const i = y * stride + 1 + x * 4;
      const frame = Math.min(1, Math.max(0, distance - portrait + 0.5));
      const art = frame < 1 ? avatar.sample(crop(x,avatar.width), sy, rows, i) * (1 - frame) : 0;
      const alpha = art + 255 * frame;
      if (!alpha) continue;
      for (let color = 0; color < 3; color++) rows[i + color] = (rows[i + color] * art + 22 * 255 * frame) / alpha;
      rows[i + 3] = alpha * Math.min(1, radius + 0.5 - distance);
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0,TOKEN_SIZE); view.setUint32(4,TOKEN_SIZE);
  header.set([8,6],8);
  const packed = new Uint8Array(await new Response(
    new Blob([rows]).stream().pipeThrough(new CompressionStream("deflate")),
  ).arrayBuffer());
  return new Blob([signature, pngChunk("IHDR",header), pngChunk("IDAT",packed), pngChunk("IEND",new Uint8Array())],
    {type:"image/png"});
}
