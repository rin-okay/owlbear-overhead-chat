import { isChatRoom } from "./rules.js";

const REQUEST = "chat.overhead.recovery-request.v1";
const RESPONSE = "chat.overhead.recovery-response.v1";
const WINDOW = 120_000;
const MAX_ENTRIES = 1000;
const MAX_BYTES = 14_000;
const ID = /^[a-f0-9-]{36}$/i;
const encoder = new TextEncoder();

export function recoveryPackets(entries, address, now = Date.now()) {
  const packets = [];
  let batch = [];
  let size = 2;
  for (const entry of entries) {
    if (!entry.senderId || entry.rolling || entry.receivedAt < now - WINDOW || entry.receivedAt > now) continue;
    const { sequence, own, ...recent } = entry;
    let bytes = encoder.encode(JSON.stringify(recent)).length;
    if (bytes > MAX_BYTES - 3) {
      recent.parts = [recent.text];
      recent.standaloneRoll = false;
      bytes = encoder.encode(JSON.stringify(recent)).length;
      if (bytes > MAX_BYTES - 3) continue;
    }
    if (size + bytes + 1 > MAX_BYTES) {
      packets.push(batch);
      batch = [];
      size = 2;
    }
    batch.push(recent);
    size += bytes + 1;
  }
  packets.push(batch);
  return packets.map((entries, index) => ({
    ...address, sentAt: now, index, count: packets.length, entries,
  }));
}

export function setupChatRecovery(obr, getEntries, merge) {
  let connectionId;
  let pending;
  let finished = false;
  let retryTimer;
  let attempts = 0;
  const repliedAt = new Map();

  async function request(players) {
    if (!connectionId || pending || finished || attempts >= 3) return;
    const gms = players.filter((p) => p.role === "GM" && p.connectionId !== connectionId)
      .sort((a, b) => a.connectionId.localeCompare(b.connectionId));
    const gm = gms[attempts % gms.length];
    if (!gm) return;
    attempts++;
    const requestId = crypto.randomUUID();
    pending = { requestId, gm: gm.connectionId, chunks: new Map() };
    retryTimer = setTimeout(() => {
      pending = undefined;
      void obr.party.getPlayers().then(request).catch(console.error);
    }, 2500);
    await obr.broadcast.sendMessage(REQUEST, { requestId, gm: gm.connectionId }, { destination: "REMOTE" });
  }

  obr.broadcast.onMessage(REQUEST, async ({ connectionId: sender, data }) => {
    if (!connectionId || data?.gm !== connectionId || typeof data.requestId !== "string" || !ID.test(data.requestId)) return;
    try {
      const [role, players] = await Promise.all([obr.player.getRole(), obr.party.getPlayers()]);
      if (role !== "GM" || !players.some((p) => p.connectionId === sender)) return;
      const now = Date.now();
      if (now - (repliedAt.get(sender) ?? -Infinity) < 2000) return;
      repliedAt.set(sender, now);
      for (const packet of recoveryPackets(getEntries(), { target: sender, requestId: data.requestId })) {
        await obr.broadcast.sendMessage(RESPONSE, packet, { destination: "REMOTE" });
      }
    } catch (error) {
      console.error("Overhead Chat history response", error);
    }
  });

  obr.broadcast.onMessage(RESPONSE, ({ connectionId: sender, data }) => {
    if (!pending || sender !== pending.gm || data?.target !== connectionId || data.requestId !== pending.requestId ||
        !Number.isInteger(data.count) || data.count < 1 || data.count > MAX_ENTRIES ||
        !Number.isInteger(data.index) || data.index < 0 || data.index >= data.count ||
        !Number.isFinite(data.sentAt) || !Array.isArray(data.entries) || data.entries.length > MAX_ENTRIES) return;
    if (pending.count !== undefined && (pending.count !== data.count || pending.sentAt !== data.sentAt)) return;
    pending.count = data.count;
    pending.sentAt = data.sentAt;
    pending.chunks.set(data.index, data.entries);
    if (pending.chunks.size !== data.count) return;

    const now = Date.now();
    const entries = [...pending.chunks.values()].flat().slice(0, MAX_ENTRIES).flatMap((entry) => {
      const age = data.sentAt - entry?.receivedAt;
      if (!Number.isFinite(age) || age < 0 || age > WINDOW || !isChatRoom(entry.roomId) || entry.rolling ||
          typeof entry.id !== "string" || typeof entry.senderId !== "string" ||
          typeof entry.name !== "string" || typeof entry.text !== "string" || !Array.isArray(entry.parts)) return [];
      return [{ ...entry, receivedAt: now - age, own: entry.senderId === obr.player.id }];
    });
    clearTimeout(retryTimer);
    pending = undefined;
    finished = true;
    merge(entries);
  });

  obr.party.onChange((players) => {
    for (const sender of repliedAt.keys()) {
      if (!players.some((p) => p.connectionId === sender)) repliedAt.delete(sender);
    }
    void request(players).catch(console.error);
  });
  void obr.player.getConnectionId().then(async (value) => {
    connectionId = value;
    await request(await obr.party.getPlayers());
  }).catch(console.error);
}
