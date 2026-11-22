import { canSpeak } from "./rules.js";
import { isProjectileToken, isProjectileWall, openMeleeDoor, projectileImpact } from "./projectile-collision.js?v=2.6.13";
import { HIT_MARKERS, MELEE_ANIMATION_END } from "./hit-markers.js?v=2.6.14";
import {
  DEFAULT_WEAPON, EMBERS_EFFECTS, SKILLS, SKILL_REQUEST, SKILL_RESULT,
  availableSkills, availableWeapons, readSkills, skillConnections, skillEffect,
} from "./skills.js?v=2.6.14";

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
      const weapons = config.enabled === true ? availableWeapons(config.weaponsByToken?.[token.id]) : [];
      const result = { enabled: config.enabled === true, skills, weapons };
      if (data.type === "list") {
        await answer(result);
        return;
      }
      if (!skills.includes(data.skill)) {
        await answer({ ...result, error: config.enabled ? "This avatar hasn’t been granted that skill." : "The GM hasn’t enabled skill hotkeys." });
        return;
      }
      const weapon = data.weapon ?? DEFAULT_WEAPON;
      if (data.skill === "spear" && !weapons.includes(weapon)) {
        await answer({ ...result, error: "This avatar hasn’t been granted that weapon." });
        return;
      }
      const now = Date.now();
      if (now - (lastCast.get(sender.id) ?? -Infinity) < 650) {
        await answer({ ...result, error: "Wait a moment before casting again." });
        return;
      }
      lastCast.set(sender.id, now);
      const skill = SKILLS[data.skill];
      const projectile = Boolean(skill.range);
      const checksHit = projectile || Boolean(skill.meleeReach);
      const geometry = checksHit ? Promise.all([
        obr.scene.items.getItems((item) => isProjectileToken(item) || isProjectileWall(item)),
        obr.scene.local.getItems(isProjectileWall),
      ]).catch(() => null) : [];
      const [dpi, bounds, currentRole, obstacles] = await Promise.all([
        obr.scene.grid.getDpi(), obr.scene.items.getItemBounds([token.id]), obr.player.getRole(),
        geometry,
      ]);
      if (version !== sceneVersion || currentRole !== "GM") return;
      const latest = readSkills(obr, "gm");
      if (!availableSkills(latest, token.id).includes(data.skill)) {
        await answer({ error: "This avatar no longer has that skill." });
        return;
      }
      if (data.skill === "spear" && !availableWeapons(latest.weaponsByToken?.[token.id]).includes(weapon)) {
        await answer({ ...result, weapons: availableWeapons(latest.weaponsByToken?.[token.id]), error: "This avatar no longer has that weapon." });
        return;
      }
      const instruction = skillEffect(data.skill, token, bounds.center, dpi, data.facing, weapon);
      if (!instruction) {
        await answer({ ...result, error: "Couldn’t determine avatar facing. Check the scene grid and facing setting." });
        return;
      }
      const instructions = [instruction];
      let hitTokenIds = [];
      let doorId;
      if (checksHit) {
        if (!obstacles) {
          await answer({ ...result, error: "Couldn’t check the scene for walls and tokens. Try again." });
          return;
        }
        const { source, rotation, destination } = instruction.effectProperties;
        let end = destination;
        if (!projectile) {
          const angle = rotation * Math.PI / 180;
          const reach = skill.meleeReach * dpi;
          end = { x: source.x + reach * Math.cos(angle), y: source.y + reach * Math.sin(angle) };
        }
        const blastRadius = skill.impact ? skill.impact.size * dpi / 2 : 0;
        const impact = projectileImpact(source, end, obstacles.flat(), token.id, dpi, blastRadius);
        hitTokenIds = impact.hitTokenIds;
        if (projectile) instruction.effectProperties.destination = impact.destination;
        else doorId = impact.doorId;
        if (skill.impact) {
          const { effect, size, delay } = skill.impact;
          instructions.push({
            type: "effect", id: effect, delay, layer: instruction.layer,
            effectProperties: { source: impact.destination, size, disableHit: true },
          });
        }
      }
      const meleeHit = Boolean(skill.meleeReach && hitTokenIds.length);
      const sendMarkers = (delay, afterAnimation = false) => obr.broadcast.sendMessage(HIT_MARKERS, {
        requestId: data.requestId, tokenIds: hitTokenIds, delay, afterAnimation,
      }, { destination: "ALL" }).catch((error) => console.error("Overhead Chat hit markers", error));
      if (meleeHit) {
        // Embers runs nested actions after removing the finished effect on each client.
        instruction.instructions = [{
          type: "action", id: "message", arguments: [MELEE_ANIMATION_END, data.requestId, "LOCAL"],
        }];
        // Keep a fallback for clients without the Embers completion signal.
        await sendMarkers(4500, true);
        if (version !== sceneVersion) return;
      }
      await obr.broadcast.sendMessage(EMBERS_EFFECTS, {
        instructions, spellData: { name: skill.name, caster: sender.id },
      }, { destination: "ALL" });
      if (doorId && version === sceneVersion) {
        await openMeleeDoor(obr, doorId, sender.role, () => version === sceneVersion)
          .catch((error) => console.error("Overhead Chat could not open the door", error));
      }
      if (version === sceneVersion && hitTokenIds.length && !meleeHit) {
        await sendMarkers(skill.impact?.delay ?? skill.hitDelay);
      }
      await answer(result);
    } catch (error) {
      console.error("Overhead Chat skills", error);
    }
  });
}
