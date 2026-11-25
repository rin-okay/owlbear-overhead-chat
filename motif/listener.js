import OBR from "./obr.js";
import { createEngine, loadMix } from "./audio.js";
import { EMPTY, KEY, LOCAL } from "./model.js";

const status = document.getElementById("notice");
const listen = document.getElementById("listen");
const tell = data => OBR.broadcast.sendMessage(LOCAL, data, { destination: "LOCAL" });
let heartbeat;

const engine = createEngine({
  enabled: false,
  onBlocked() { status.textContent = "Click Enable audio again."; },
  onError(entry) { status.textContent = "Couldn’t play " + entry.name + "."; },
  onFinish({ id, since, start, end }) {
    if (heartbeat) void tell({ type: "finished", id, since, start, end }).catch(console.warn);
  },
});

listen.onclick = () => {
  const pulse = () => void tell({ type: "listener" }).catch(console.warn);
  pulse();
  heartbeat ??= setInterval(pulse, 1800);
  status.textContent = "Keep this panel open.";
  engine.retry();
};
document.getElementById("close").onclick = () => void OBR.popover.close(KEY + "/listener");

OBR.onReady(async () => {
  const self = await OBR.player.getConnectionId();
  const update = metadata => engine.render((metadata[KEY] ?? EMPTY).active);
  OBR.room.onMetadataChange(update);
  OBR.broadcast.onMessage(LOCAL, ({ data, connectionId }) => {
    if (connectionId === self && data?.type === "mix") engine.setMix(loadMix());
  });
  update(await OBR.room.getMetadata());
  listen.disabled = false;
});

window.addEventListener("pagehide", () => {
  if (heartbeat) {
    clearInterval(heartbeat);
    void tell({ type: "listener-closed" }).catch(console.warn);
  }
}, { once: true });
