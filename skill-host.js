import { canSpeak, MELEE_HIT_TIMING, normalizeMeleeHitTiming } from "./rules.js?v=2.6.16";
import { coneHits, isProjectileToken, isProjectileWall, openMeleeDoor, projectileImpact } from "./projectile-collision.js?v=2.7.1";
import { HIT_MARKERS, MELEE_HIT_CUE } from "./hit-markers.js?v=2.6.16";
import {
  DEFAULT_WEAPON, EMBERS_EFFECTS, MELEE_DURATION_MS, SKILLS, SKILL_REQUEST, SKILL_RESULT,
  availableSkills, availableWeapons, readSkills, skillConnections, skillEffect, spellParameter,
} from "./skills.js?v=2.7.2";

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
      const checksHit = projectile || Boolean(skill.meleeReach || skill.cone);
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
      const parameter = spellParameter(latest, token.id, data.skill);
      const instruction = skillEffect(data.skill, token, bounds.center, dpi, data.facing, weapon, parameter);
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
        const items = obstacles.flat();
        const { source, rotation, destination, size } = instruction.effectProperties;
        if (skill.cone) {
          hitTokenIds = coneHits(source, rotation, size * dpi, items, token.id, dpi);
        } else if (projectile) {
          const blastRadius = skill.impact ? parameter * dpi : 0;
          const impact = projectileImpact(source, destination, items, token.id, dpi, blastRadius);
          instruction.effectProperties.destination = impact.destination;
          hitTokenIds = impact.hitTokenIds;
          if (skill.impact) {
            const { effect, delay } = skill.impact;
            instructions.push({
              type: "effect", id: effect, delay, layer: instruction.layer,
              // Embers takes the explosion width, while the GM assigns its radius.
              effectProperties: { source: impact.destination, size: parameter * 2, disableHit: true },
            });
          }
        } else {
          const angle = rotation * Math.PI / 180;
          const reach = skill.meleeReach * dpi;
          const end = { x: source.x + reach * Math.cos(angle), y: source.y + reach * Math.sin(angle) };
          const impact = projectileImpact(source, end, items, token.id, dpi);
          hitTokenIds = impact.hitTokenIds;
          doorId = impact.doorId;
        }
      }
      const meleeHit = Boolean(skill.meleeReach && hitTokenIds.length);
      const sendMarkers = (delay, useAnimationCue = false) => obr.broadcast.sendMessage(HIT_MARKERS, {
        requestId: data.requestId, tokenIds: hitTokenIds, delay, useAnimationCue,
      }, { destination: "ALL" }).catch((error) => console.error("Overhead Chat hit markers", error));
      if (meleeHit) {
        const metadata = await obr.room.getMetadata().catch(() => ({}));
        if (version !== sceneVersion) return;
        const timing = normalizeMeleeHitTiming(metadata[MELEE_HIT_TIMING]);
        const cueDelay = Math.round(MELEE_DURATION_MS[weapon] * timing / 100);
        const cue = { type: "action", id: "message", arguments: [MELEE_HIT_CUE, data.requestId, "LOCAL"] };
        if (timing === 100) {
          // Embers runs nested actions after it removes the finished effect.
          instruction.instructions = [cue];
        } else {
          instructions.push({ ...cue, delay: cueDelay });
        }
        await sendMarkers(cueDelay + 750, true);
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
