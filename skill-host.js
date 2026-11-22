import { canSpeak } from "./rules.js";
import {
  EMBERS_EFFECTS, SKILLS, SKILL_REQUEST, SKILL_RESULT, availableSkills, readSkills, skillConnections, skillEffect,
} from "./skills.js?v=2.6.0";

export function setupSkillHost(obr) {
  const lastCast = new Map();
  let sceneVersion = 0;
  obr.scene.onReadyChange(() => { sceneVersion++; lastCast.clear(); });
  obr.party.onChange((players) => {
    for (const id of lastCast.keys()) {
      if (id !== obr.player.id && !players.some((player) => player.id === id)) lastCast.delete(id);
    }
  });
  obr.broadcast.onMessage(SKILL_REQUEST, async ({ connectionId, data }) => {
    if (typeof data?.requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(data.requestId) ||
        typeof data.tokenId !== "string" || !data.tokenId || data.tokenId.length > 128 ||
        (data.type !== "list" && (data.type !== "cast" || !Object.hasOwn(SKILLS, data.skill)))) return;
    const version = sceneVersion;
    const answer = (result) => obr.broadcast.sendMessage(SKILL_RESULT, {
      ...result, connectionId, requestId: data.requestId, tokenId: data.tokenId,
    }, { destination: "ALL" });
    try {
      const { gm, self, players } = await skillConnections(obr);
      if (version !== sceneVersion || self.connectionId !== gm?.connectionId) return;
      const sender = players.find((p) => p.connectionId === connectionId);
      if (!sender || !await obr.scene.isReady()) return;
      const [[token], permissions] = await Promise.all([
        obr.scene.items.getItems([data.tokenId]), obr.room.getPermissions(),
      ]);
      if (version !== sceneVersion) return;
      if (!canSpeak(sender, token, permissions) || token.locked) {
        await answer({ enabled: false, skills: [], error: "You can’t use skills with that token." });
        return;
      }
      const config = readSkills(obr, "gm");
      const skills = availableSkills(config, token.id);
      const result = { enabled: config.enabled === true, skills };
      if (data.type === "list") {
        await answer(result);
        return;
      }
      if (!skills.includes(data.skill)) {
        await answer({ ...result, error: config.enabled ? "This avatar hasn’t been granted that skill." : "The GM hasn’t enabled skill hotkeys." });
        return;
      }
      const now = Date.now();
      if (now - (lastCast.get(sender.id) ?? -Infinity) < 650) {
        await answer({ ...result, error: "Wait a moment before casting again." });
        return;
      }
      lastCast.set(sender.id, now);
      const [dpi, bounds, currentRole] = await Promise.all([
        obr.scene.grid.getDpi(), obr.scene.items.getItemBounds([token.id]), obr.player.getRole(),
      ]);
      if (version !== sceneVersion || currentRole !== "GM") return;
      if (!availableSkills(readSkills(obr, "gm"), token.id).includes(data.skill)) {
        await answer({ error: "This avatar no longer has that skill." });
        return;
      }
      const instruction = skillEffect(data.skill, token, bounds.center, dpi, data.facing);
      if (!instruction) {
        await answer({ ...result, error: "Couldn’t determine avatar facing. Check the scene grid and facing setting." });
        return;
      }
      await obr.broadcast.sendMessage(EMBERS_EFFECTS, {
        instructions: [instruction], spellData: { name: SKILLS[data.skill].name, caster: sender.id },
      }, { destination: "ALL" });
      await answer(result);
    } catch (error) {
      console.error("Overhead Chat skills", error);
    }
  });
}
