import { setupBless } from "./bless.js?v=2.7.11";
import { combatDamage } from "./combat-log.js?v=2.9.2";
import { isShieldGraphic, readShieldGraphics, setupShield } from "./shield.js?v=2.8.6";
import { canSpeak, MELEE_HIT_TIMING, normalizeMeleeHitTiming } from "./rules.js?v=2.6.16";
import {
  areaHits, clearSpellPath, coneHits, isProjectileToken, isProjectileWall, openMeleeDoor, projectileImpact, teleportLandingClear,
} from "./projectile-collision.js?v=2.8.3";
import { HIT_MARKERS, MELEE_HIT_CUE } from "./hit-markers.js?v=2.9.2";
import { rollMeleeDamage } from "./melee-damage.js?v=2.8.8";
import { readTokenStats } from "./stats.js?v=2.8.5";
import { BLOCKED_MAGIC_MISSILE, eldritchBeamCount, MAGIC_MISSILE_INTERVAL, rollFireSpellDamage, rollMagicMissileDart, rollSpellDamage } from "./spell-damage.js?v=2.9.2";
import {
  DEFAULT_WEAPON, EMBERS_EFFECTS, MAX_CAST_LEVEL, MELEE_DURATION_MS, SKILLS, SKILL_REQUEST, SKILL_RESULT, WEAPONS,
  aimsAtLocation, availableSkills, availableWeapons, friendlyFireMode, readSkills, skillConnections, skillEffect, spellParameter, tokenTeams, turnToHeading,
} from "./skills.js?v=2.9.2";

function aimAtTarget(source, target, range = 0, passThrough = false, maxRange = Infinity) {
  if (![target?.center?.x, target?.center?.y].every(Number.isFinite)) return;
  const dx = target.center.x - source.x;
  const dy = target.center.y - source.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance <= 1e-7) return;
  const width = target.max?.x - target.min?.x;
  const height = target.max?.y - target.min?.y;
  const radius = passThrough && Number.isFinite(width) && Number.isFinite(height) ? Math.hypot(width, height) / 2 : 0;
  const reach = Math.min(maxRange, Math.max(distance + radius, range));
  return {
    heading: Math.atan2(dy, dx) * 180 / Math.PI,
    destination: { x: source.x + dx / distance * reach, y: source.y + dy / distance * reach },
  };
}

async function spellDestination(obr, data, items, canSelectToken) {
  if (data.targetLocation !== undefined) {
    const target = data.targetLocation;
    if ([target?.x, target?.y].every(Number.isFinite)) return { x: target.x, y: target.y };
    return;
  }
  if (!canSelectToken || typeof data.targetId !== "string" ||
      !items.some((item) => item.id === data.targetId && isProjectileToken(item))) return;
  const bounds = await obr.scene.items.getItemBounds([data.targetId]).catch(() => null);
  return bounds?.center;
}

async function teleportCaster(obr, token, source, destination, sender, permissions, current) {
  let moved = false;
  await obr.scene.items.updateItems([token.id], ([item]) => {
    if (!current() || !canSpeak(sender, item, permissions) || item.locked ||
        item.position.x !== token.position.x || item.position.y !== token.position.y) return;
    item.position = {
      x: item.position.x + destination.x - source.x,
      y: item.position.y + destination.y - source.y,
    };
    moved = true;
  });
  return moved;
}

export function setupSkillHost(obr, buildImage, recordCombat) {
  const castBless = setupBless(obr, buildImage);
  const toggleShield = setupShield(obr, buildImage);
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
      const skill = SKILLS[data.skill];
      const granted = skills.includes(data.skill);
      const maxSpellLevel = readTokenStats(token).details.spellLevel;
      const canActivateShield = granted && maxSpellLevel >= skill.spellLevel;
      // A shield can still be removed after the grant is revoked or the cap is lowered.
      const removingShield = data.skill === "shield" && !canActivateShield &&
        (await readShieldGraphics(obr, token.id)).length > 0;
      if (version !== sceneVersion) return;
      if (!granted && !removingShield) {
        await answer({ ...result, error: config.enabled ? "This avatar hasn’t been granted that skill." : "The GM hasn’t enabled skill hotkeys." });
        return;
      }
      const weapon = data.weapon ?? DEFAULT_WEAPON;
      if (data.skill === "spear" && !weapons.includes(weapon)) {
        await answer({ ...result, error: "This avatar hasn’t been granted that weapon." });
        return;
      }
      const missile = data.skill === "missile";
      const spellLevel = skill.upcast && data.spellLevel !== undefined ? data.spellLevel : skill.spellLevel;
      if (skill.upcast && (!Number.isInteger(spellLevel) || spellLevel < skill.spellLevel || spellLevel > MAX_CAST_LEVEL)) {
        await answer({ ...result, error: `Choose a ${skill.name} spell level from ${skill.spellLevel} to ${MAX_CAST_LEVEL}.` });
        return;
      }
      if (spellLevel > maxSpellLevel && !removingShield) {
        await answer({
          ...result,
          errorCode: "spell-level",
          error: `You can’t cast ${skill.name} at level ${spellLevel}. This token’s spell level is ${maxSpellLevel}.`,
        });
        return;
      }
      const logCast = (details) => version === sceneVersion && recordCombat?.({
        requestId: data.requestId, caster: token, skill: data.skill, level: spellLevel, ...details,
      });
      const now = Date.now();
      if (now - (lastCast.get(sender.id) ?? -Infinity) < 650) {
        await answer({ ...result, error: "Wait a moment before casting again." });
        return;
      }
      lastCast.set(sender.id, now);
      if (data.skill === "shield") {
        const current = () => version === sceneVersion;
        const error = await toggleShield(token, canActivateShield, current).catch((cause) => {
          console.error("Overhead Chat could not update Shield", cause);
          return "Couldn’t update Shield.";
        });
        if (!error) await logCast();
        if (current()) await answer({ ...result, error });
        return;
      }
      if (data.skill === "bless") {
        const targets = data.targetIds ?? [];
        if (!Array.isArray(targets) || targets.length > 100 ||
            !targets.every((id) => typeof id === "string" && id.length > 0 && id.length <= 128)) {
          await answer({ ...result, error: "Couldn’t read the selection for Bless." });
          return;
        }
        const current = () => version === sceneVersion;
        const error = await castBless(token, targets, config, current).catch((cause) => {
          console.error("Overhead Chat could not update Bless", cause);
          return "Couldn’t update Bless.";
        });
        if (!error) await logCast();
        if (current()) await answer({ ...result, error });
        return;
      }
      const projectile = Boolean(skill.range);
      const checksHit = aimsAtLocation(data.skill);
      const geometry = checksHit ? Promise.all([
        obr.scene.items.getItems((item) => isProjectileToken(item) || isProjectileWall(item) ||
          (missile && isShieldGraphic(item)) ||
          (skill.location === "teleport" && item.type === "IMAGE" && item.layer === "CHARACTER")),
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
      const instruction = skillEffect(data.skill, token, bounds?.center, dpi, data.facing, weapon, parameter);
      if (!instruction) {
        await answer({ ...result, error: "Couldn’t determine avatar facing. Check the scene grid and facing setting." });
        return;
      }
      const instructions = [instruction];
      let hitTokenIds = [];
      let hitTokens = [];
      let logSelected;
      let missileBlocked = false;
      let doorId;
      if (checksHit) {
        if (!obstacles) {
          await answer({ ...result, error: "Couldn’t check the scene for walls and tokens. Try again." });
          return;
        }
        const mode = friendlyFireMode(latest);
        const casterTeams = tokenTeams(latest, token.id);
        const isAlly = (item) => casterTeams.length > 0 && isProjectileToken(item) &&
          tokenTeams(latest, item.id).some((team) => casterTeams.includes(team));
        const items = obstacles.flat();
        const hitsAllies = mode === "enabled" || (mode === "aoe" && (skill.impact || skill.cone || skill.location === "area"));
        const targets = hitsAllies ? items : items.filter((item) => !isAlly(item));
        const { source, size } = instruction.effectProperties;
        let { destination, rotation } = instruction.effectProperties;
        if (skill.location) {
          const isArea = skill.location === "area";
          if (isArea && data.targetLocation === undefined) {
            logSelected = items.find((item) => item.id === data.targetId && isProjectileToken(item));
          }
          const target = await spellDestination(obr, data, items, isArea);
          if (version !== sceneVersion) return;
          if (![target?.x, target?.y].every(Number.isFinite)) {
            await answer({ ...result, error: "Set a map target with Z, WASD, and Space first." });
            return;
          }
          const distance = Math.hypot(target.x - source.x, target.y - source.y);
          if (distance > skill.range * dpi + 1e-7) {
            await answer({ ...result, error: `That target is beyond ${skill.range} cells.` });
            return;
          }
          if (isArea) {
            if (!clearSpellPath(source, target, items)) {
              await answer({ ...result, error: "A wall blocks the target point." });
              return;
            }
            instruction.effectProperties.source = target;
            const areaTargets = hitsAllies ? targets : targets.filter((item) => item.id !== token.id);
            hitTokenIds = areaHits(target, parameter * dpi, areaTargets, dpi);
          } else {
            if (distance <= 1e-7 || !teleportLandingClear(source, target, token, items, dpi)) {
              await answer({ ...result, error: "Choose a different, clear space for Misty Step." });
              return;
            }
            const current = () => version === sceneVersion;
            const moved = await teleportCaster(obr, token, source, target, sender, permissions, current);
            if (!current()) return;
            if (!moved) {
              await answer({ ...result, error: "The avatar moved or became unavailable. Try again." });
              return;
            }
            instruction.loops = 1;
            instructions.push({
              ...instruction, id: "misty_step.in",
              effectProperties: { ...instruction.effectProperties, source: target },
            });
          }
        } else {
          const eldritch = data.skill === "eldritch-blast";
          const maxRange = eldritch ? skill.range * dpi : Infinity;
          let aimed = aimAtTarget(source, { center: data.targetLocation }, 0, false, maxRange);
          if (!aimed && typeof data.targetId === "string" && data.targetId !== token.id) {
            const selected = items.find((item) => item.id === data.targetId && isProjectileToken(item));
            if (selected) {
              logSelected = selected;
              const target = await obr.scene.items.getItemBounds([selected.id]).catch(() => null);
              if (version !== sceneVersion) return;
              aimed = aimAtTarget(source, target, (skill.range ?? 0) * dpi, mode !== "enabled" && isAlly(selected), maxRange);
            }
          }
          if (aimed) {
            let applied = false;
            await obr.scene.items.updateItems([token.id], ([item]) => {
              if (version !== sceneVersion || !canSpeak(sender, item, permissions) || item.locked) return;
              turnToHeading(item, data.facing, aimed.heading);
              applied = true;
            });
            if (version !== sceneVersion || !applied) {
              if (version === sceneVersion) await answer({ ...result, error: "Couldn’t turn the avatar toward the target." });
              return;
            }
            if (projectile) destination = aimed.destination;
            else {
              rotation = aimed.heading;
              instruction.effectProperties.rotation = rotation;
            }
          }
          if (skill.cone) {
            hitTokenIds = coneHits(source, rotation, size * dpi, targets, token.id, dpi);
          } else if (projectile) {
            const blastRadius = skill.impact ? parameter * dpi : 0;
            // In AoE mode an ally can be caught in the blast without stopping its projectile.
            const canIntercept = mode === "aoe" && skill.impact ? (item) => !isAlly(item) : undefined;
            const impact = projectileImpact(source, destination, targets, token.id, dpi, blastRadius, canIntercept);
            instruction.effectProperties.destination = impact.destination;
            if (eldritch) instruction.effectProperties.copies = eldritchBeamCount(token);
            hitTokenIds = impact.hitTokenIds;
            missileBlocked = missile && Boolean(hitTokenIds.length) &&
              items.some((item) => item.attachedTo === hitTokenIds[0] && isShieldGraphic(item));
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
            const impact = projectileImpact(source, end, targets, token.id, dpi);
            hitTokenIds = impact.hitTokenIds;
            doorId = impact.doorId;
          }
        }
        hitTokens = items.filter((item) => hitTokenIds.includes(item.id) && isProjectileToken(item));
      }
      if (missile) {
        const dartCount = spellLevel + 2;
        for (let index = 1; index < dartCount; index++) {
          instructions.push({ ...instruction, delay: index * MAGIC_MISSILE_INTERVAL });
        }
      }
      let damageRolls;
      const meleeHit = Boolean(skill.meleeReach && hitTokenIds.length);
      const sendMarkers = (delay, damage, { useAnimationCue = false, missileFollowUps } = {}) => obr.broadcast.sendMessage(HIT_MARKERS, {
        requestId: data.requestId, tokenIds: hitTokenIds, delay, useAnimationCue,
        ...(damage ? { damage } : {}),
        ...(missileFollowUps ? { missileFollowUps } : {}),
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
        damageRolls = [rollMeleeDamage(weapon, token)];
        await sendMarkers(cueDelay + 750, damageRolls[0], { useAnimationCue: true });
        if (version !== sceneVersion) return;
      }
      await obr.broadcast.sendMessage(EMBERS_EFFECTS, {
        instructions, spellData: { name: skill.name, caster: sender.id },
      }, { destination: "ALL" });
      if (doorId && version === sceneVersion) {
        await openMeleeDoor(obr, doorId, sender.role, () => version === sceneVersion)
          .catch((error) => console.error("Overhead Chat could not open the door", error));
      }
      if (version === sceneVersion && hitTokenIds.length && missile) {
        damageRolls = instructions.map(() => missileBlocked ? BLOCKED_MAGIC_MISSILE : rollMagicMissileDart());
        const [damage, ...missileFollowUps] = damageRolls;
        await sendMarkers(skill.hitDelay, damage, { missileFollowUps });
      } else if (version === sceneVersion && hitTokenIds.length && !meleeHit) {
        const damage = skill.damageDice ? rollFireSpellDamage(skill, spellLevel)
          : data.skill === "eldritch-blast" || data.skill === "shatter" ? rollSpellDamage(data.skill, token) : undefined;
        if (damage) damageRolls = [damage];
        await sendMarkers(skill.impact?.delay ?? skill.hitDelay, damage);
      }
      await logCast({
        action: skill.meleeReach && weapon !== DEFAULT_WEAPON ? WEAPONS[weapon] : skill.name,
        attack: checksHit && skill.location !== "teleport",
        selected: logSelected, hits: hitTokens, damage: combatDamage(damageRolls),
      });
      if (version === sceneVersion) await answer(result);
    } catch (error) {
      console.error("Overhead Chat skills", error);
    }
  });
}
