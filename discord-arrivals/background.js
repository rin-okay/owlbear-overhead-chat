import OBR, { buildImage, buildLight } from "./obr.js";
import { ARRIVAL, AVATAR, CLAIM, CONFIG, MODAL, RESULT, character, dismissKey, linkKey, workerOrigin } from "./model.mjs";
import { planToken } from "./provision.mjs";

let offered = false;
let sceneEpoch = 0;
let pending = Promise.resolve();
let lightQueue = Promise.resolve();
let light;
let nativeTokenId;

const report = (error) => console.warn("Discord Arrivals:", error);
const sameScene = (epoch) => epoch === sceneEpoch;

async function offer() {
  const epoch = sceneEpoch;
  if (offered || !await OBR.scene.isReady() || await OBR.player.getRole() !== "PLAYER") return;
  const [scene, room] = await Promise.all([OBR.scene.getMetadata(), OBR.room.getMetadata()]);
  if (!sameScene(epoch) || !scene[CONFIG]?.enabled || room[linkKey(OBR.player.id)]) return;
  try { if (localStorage.getItem(dismissKey(OBR.room.id, OBR.player.id))) return; } catch {}
  if (offered) return;
  offered = true;
  try {
    await OBR.modal.open({id:MODAL, url:new URL("./panel.html?welcome=1", import.meta.url).href, width:350, height:370});
  } catch (error) {
    offered = false;
    throw error;
  }
  try { localStorage.setItem(dismissKey(OBR.room.id, OBR.player.id), "shown"); } catch {}
}

async function answer(connection, request, response) {
  await OBR.broadcast.sendMessage(RESULT, {connection, request, ...response});
}

async function provision({connectionId, data}, epoch) {
  if (!sameScene(epoch) || await OBR.player.getRole() !== "GM") return;
  if (typeof data?.request !== "string" || !/^[a-f\d-]{36}$/i.test(data.request) ||
      typeof data.ticket !== "string" || data.ticket.length > 4096) return;
  const players = await OBR.party.getPlayers();
  const player = players.find((entry) => entry.connectionId === connectionId && entry.role === "PLAYER");
  if (!player) return;
  try {
    if (!await OBR.scene.isReady()) throw Error("Waiting for the GM to open a scene.");
    const configBefore = (await OBR.scene.getMetadata())[CONFIG];
    const worker = workerOrigin(configBefore, location.origin);
    if (!configBefore?.enabled || !worker || !sameScene(epoch)) return;
    const verification = await fetch(new URL("/oauth/verify", worker), {
      method:"POST", headers:{"Content-Type":"application/json"}, signal:AbortSignal.timeout(10000),
      body:JSON.stringify({ticket:data.ticket, room:OBR.room.id, player:player.id, connection:connectionId}),
    });
    if (!verification.ok) throw Error(verification.status === 403
      ? "This sign-in code expired or belongs to another connection. Connect Discord again."
      : "The Discord sign-in service is temporarily unavailable.");
    const profile = await verification.json();
    const [meta, items, room, party, role, permissions] = await Promise.all([
      OBR.scene.getMetadata(), OBR.scene.items.getItems(), OBR.room.getMetadata(), OBR.party.getPlayers(),
      OBR.player.getRole(), OBR.room.getPermissions(),
    ]);
    if (role !== "GM" || !sameScene(epoch) ||
        !party.some((entry) => entry.id === player.id && entry.connectionId === connectionId && entry.role === "PLAYER")) return;
    if (!permissions.includes("CHARACTER_UPDATE")) throw Error("The GM needs to enable Character Update in Owlbear’s player permissions.");
    const config = meta[CONFIG];
    if (workerOrigin(config, location.origin) !== worker) return;
    const previous = room[linkKey(player.id)];
    if (previous && previous.profile !== profile.profile) {
      throw Error("This Owlbear player is already linked to a different Discord profile.");
    }
    const plan = await planToken({room:OBR.room.id, player:player.id, profile, config, items, party});
    if (!sameScene(epoch)) return;
    if (!plan.existing) {
      if (profile.tokenImage) {
        const image = await fetch(profile.tokenImage,{signal:AbortSignal.timeout(10000)});
        if (!image.ok || image.headers.get("Content-Type") !== "image/png") {
          throw Error("The Discord portrait could not be framed. Try connecting again.");
        }
        await image.arrayBuffer();
      }
      if (!sameScene(epoch)) return;
      const item = buildImage({url:profile.tokenImage ?? profile.avatar, mime:"image/png", width:256, height:256},
        {dpi:256, offset:{x:128, y:128}})
        .id(plan.id).name(profile.name).layer("CHARACTER").position(config.spawn)
        .createdUserId(player.id).metadata(plan.metadata).build();
      await OBR.scene.items.addItems([item]);
    }
    if (!sameScene(epoch)) return;
    const [current] = await OBR.scene.items.getItems([plan.id]);
    if (!current || current.metadata?.[ARRIVAL]?.profile !== profile.profile) throw Error("Owlbear could not create the token.");
    if (current.createdUserId !== player.id) {
      await OBR.scene.items.updateItems([plan.id], ([item]) => {
        if (sameScene(epoch) && item?.metadata?.[ARRIVAL]?.profile === profile.profile) item.createdUserId = player.id;
      });
    }
    if (!sameScene(epoch)) return;
    const [saved] = await OBR.scene.items.getItems([plan.id]);
    if (saved?.createdUserId !== player.id) {
      throw Error("The token is placed. The GM needs to assign its owner in Owlbear, then retry.");
    }
    if (!sameScene(epoch)) return;
    await OBR.room.setMetadata({[linkKey(player.id)]:{profile:profile.profile, tokenId:plan.id}});
    await answer(connectionId, data.request, { tokenId:plan.id, needsVision:plan.needsVision });
    if (plan.needsVision && !plan.existing) {
      await OBR.notification.show("Discord Arrivals: use Enable Vision on " + profile.name + " to apply the Smoke & Spectre scene defaults.");
    }
  } catch (error) {
    if (sameScene(epoch)) await answer(connectionId, data.request, {error:String(error.message).slice(0,240)});
  }
}

function updateLight(items) {
  if (items) {
    if (!nativeTokenId) return;
    const token = items.find((item) => item.id === nativeTokenId);
    const wanted = character(token) && token.visible && token.createdUserId === OBR.player.id;
    if (wanted === Boolean(light)) return;
  }
  const epoch = sceneEpoch;
  lightQueue = lightQueue.then(async () => {
    if (!sameScene(epoch) || !await OBR.scene.isReady()) return;
    const [role, room, metadata] = await Promise.all([OBR.player.getRole(), OBR.room.getMetadata(), OBR.scene.getMetadata()]);
    const config = metadata[CONFIG];
    if (!sameScene(epoch)) return;
    nativeTokenId = role === "PLAYER" && config?.vision === "native" ? room[linkKey(OBR.player.id)]?.tokenId : undefined;
    const [token] = nativeTokenId ? await OBR.scene.items.getItems([nativeTokenId]) : [];
    const wanted = character(token) && token.visible && token.createdUserId === OBR.player.id;
    const key = wanted ? token.id + ":" + config.radius : null;
    if (!sameScene(epoch) || key === light?.key) return;
    if (light) {
      await OBR.scene.local.deleteItems([light.id]);
      light = undefined;
    }
    if (!wanted || !sameScene(epoch)) return;
    const dpi = await OBR.scene.grid.getDpi();
    const radius = Number(config.radius);
    if (!sameScene(epoch) || !Number.isFinite(dpi) || dpi <= 0 || !Number.isInteger(radius) || radius < 1 || radius > 100) return;
    const item = buildLight().position(token.position).attachedTo(token.id).attenuationRadius(radius*dpi).build();
    await OBR.scene.local.addItems([item]);
    if (sameScene(epoch)) light = { id:item.id, key };
  }).catch(report);
}

OBR.onReady(() => {
  OBR.broadcast.onMessage(CLAIM, (event) => {
    const epoch = sceneEpoch;
    pending = pending.then(() => provision(event, epoch)).catch(report);
  });
  OBR.scene.onReadyChange((ready) => {
    ++sceneEpoch;
    light = undefined;
    nativeTokenId = undefined;
    if (ready) {
      void offer().catch(report);
      updateLight();
    }
  });
  OBR.scene.onMetadataChange(() => { void offer().catch(report); updateLight(); });
  OBR.room.onMetadataChange(() => updateLight());
  OBR.scene.items.onChange((items) => updateLight(items));
  void offer().catch(report);
  updateLight();
});
