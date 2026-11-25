import { setupBless } from "./bless.js?v=2.9.14";
import { combatDamage } from "./combat-log.js?v=2.9.4";
import { isShieldGraphic, readShieldGraphics, setupShield } from "./shield.js?v=2.9.15";
import { setupSleep } from "./sleep.js?v=2.9.15";
import { canSpeak, MELEE_HIT_TIMING, normalizeMeleeHitTiming, ROLL_DAMAGE_FROM_COMBAT_LOG } from "./rules.js?v=2.9.4";
import {
  areaHits, clearSpellPath, coneHits, isProjectileToken, isProjectileWall, openMeleeDoor, projectileImpact, projectileTokenContainsPoint, teleportLandingClear,
} from "./projectile-collision.js?v=2.10.1";
import { HIT_MARKERS, MELEE_HIT_CUE } from "./hit-markers.js?v=2.9.4";
import { meleeDamageFormula, rangedDamageFormula, rollMeleeDamage, rollRangedDamage } from "./melee-damage.js?v=2.9.11";
import { readTokenStats } from "./stats.js?v=2.8.5";
import {
  BLOCKED_MAGIC_MISSILE, MAGIC_MISSILE_INTERVAL, rollMagicMissileDart, rollSpellDamage, spellDamageFormula,
} from "./spell-damage.js?v=2.9.13";
import {
  DEFAULT_WEAPON, EMBERS_EFFECTS, MAX_CAST_LEVEL, MELEE_DURATION_MS, RANGED_WEAPONS, SKILLS, SKILL_REQUEST, SKILL_RESULT, WEAPONS,
  aimsAtLocation, availableRangedWeapons, availableSkills, availableWeapons, friendlyFireMode, readSkills, skillConnections, skillEffect, spellParameter, tokenTeams, turnToHeading,
} from "./skills.js?v=2.9.15";

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
  const toggleSleep = setupSleep(obr, buildImage);
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
      const getLoadout = (config) => {
        const enabled = config.enabled === true;
        return {
          enabled, skills: availableSkills(config, token.id),
          weapons: enabled ? availableWeapons(config.weaponsByToken?.[token.id]) : [],
          rangedWeapons: enabled ? availableRangedWeapons(config.rangedWeaponsByToken?.[token.id]) : [],
        };
      };
      const config = readSkills(obr, "gm");
      const result = getLoadout(config);
      if (data.type === "list") {
        await answer(result);
        return;
      }
      const skill = SKILLS[data.skill];
      const granted = result.skills.includes(data.skill);
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
      const ranged = data.skill === "ranged";
      const weapon = data.weapon ?? (ranged ? undefined : DEFAULT_WEAPON);
      const weaponGranted = (loadout) => ranged ? loadout.rangedWeapons.includes(weapon)
        : data.skill !== "spear" || loadout.weapons.includes(weapon);
      if (!weaponGranted(result)) {
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
      if (data.skill === "sleep") {
        const current = () => version === sceneVersion;
        const error = await toggleSleep(token, current).catch((cause) => {
          console.error("Overhead Chat could not update Sleep (AFK)", cause);
          return "Couldn’t update Sleep (AFK).";
        });
        if (!error) await logCast();
        if (current()) await answer({ ...result, error });
        return;
      }
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
        const error = await castBless(token, targets, config, spellLevel - skill.spellLevel, current).catch((cause) => {
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
        obr.scene.items.getItems((item) => isProjectileWall(item) ||
          (skill.location !== "teleport" && isProjectileToken(item)) ||
          (missile && isShieldGraphic(item))),
        obr.scene.local.getItems(isProjectileWall),
      ]).catch(() => null) : [];
      const [dpi, bounds, currentRole, obstacles] = await Promise.all([
        obr.scene.grid.getDpi(), obr.scene.items.getItemBounds([token.id]), obr.player.getRole(),
        geometry,
      ]);
      if (version !== sceneVersion || currentRole !== "GM") return;
      const latest = readSkills(obr, "gm");
      const latestLoadout = getLoadout(latest);
      if (!latestLoadout.skills.includes(data.skill)) {
        await answer({ ...latestLoadout, error: "This avatar no longer has that skill." });
        return;
      }
      if (!weaponGranted(latestLoadout)) {
        await answer({ ...latestLoadout, error: "This avatar no longer has that weapon." });
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
      let beamOutcomes;
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
        const eldritch = data.skill === "eldritch-blast";
        const beamFormula = missile ? { count: spellLevel + 2, sides: 4, type: "force", modifier: spellLevel + 2 }
          : eldritch ? spellDamageFormula(skill, token) : undefined;
        const selectedBeams = [];
        if (beamFormula && data.targetLocation === undefined && data.targetIds !== undefined) {
          if (!Array.isArray(data.targetIds) || data.targetIds.length > 100 ||
              !data.targetIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 128)) {
            await answer({ ...result, error: "Couldn’t read the selected targets." });
            return;
          }
          const candidates = new Map(items.filter(isProjectileToken).map((item) => [item.id, item]));
          for (const id of new Set(data.targetIds)) {
            if (id !== token.id && candidates.has(id)) selectedBeams.push(candidates.get(id));
          }
          if (selectedBeams.length > beamFormula.count) {
            const unit = missile ? "missiles" : beamFormula.count === 1 ? "beam" : "beams";
            await answer({ ...result, errorCode: "too-many-targets",
              error: `Too many targets for ${skill.name}. You have ${beamFormula.count} ${unit}.` });
            return;
          }
        }
        const face = async (aimed) => {
          let applied = false;
          await obr.scene.items.updateItems([token.id], ([item]) => {
            if (version !== sceneVersion || !canSpeak(sender, item, permissions) || item.locked) return;
            turnToHeading(item, data.facing, aimed.heading);
            applied = true;
          });
          if (version === sceneVersion && !applied) {
            await answer({ ...result, error: "Couldn’t turn the avatar toward the target." });
          }
          return version === sceneVersion && applied;
        };

        const counts = data.projectileCounts;
        if (counts !== undefined && beamFormula && data.targetLocation === undefined &&
            (!Array.isArray(counts) || counts.length !== selectedBeams.length || counts.length < 2 ||
              !counts.every((count) => Number.isInteger(count) && count >= 1 && count <= beamFormula.count) ||
              counts.reduce((sum, count) => sum + count, 0) !== beamFormula.count ||
              selectedBeams.some((target, index) => target.id !== data.targetIds[index]))) {
          await answer({ ...result, error: "The projectile allocation or selected targets changed. Choose the targets again." });
          return;
        }
        if (selectedBeams.length > 1) {
          if (!counts && selectedBeams.length !== beamFormula.count) {
            await answer({ ...result, error: "Choose how many projectiles to send to each target before casting." });
            return;
          }
          const aims = await Promise.all(selectedBeams.map(async (selected) => {
            const bounds = await obr.scene.items.getItemBounds([selected.id]).catch(() => null);
            return aimAtTarget(source, bounds, 0, false, skill.range * dpi);
          }));
          if (version !== sceneVersion) return;
          if (aims.some((aimed) => !aimed)) {
            await answer({ ...result, error: "Couldn’t aim at one of the selected targets." });
            return;
          }
          if (!await face(aims[0])) return;
          const outcomes = new Map();
          instructions.length = 0;
          for (const [index, aimed] of aims.entries()) {
            const selected = selectedBeams[index];
            const count = counts?.[index] ?? 1;
            const impact = projectileImpact(source, aimed.destination, targets, token.id, dpi, 0,
              (item) => item.id === selected.id);
            const firstDart = missile ? instructions.length : 0;
            const effectProperties = { ...instruction.effectProperties, destination: impact.destination, copies: missile ? 1 : count };
            if (missile) {
              for (let i = 0; i < count; i++) {
                instructions.push({ ...instruction, effectProperties, delay: instructions.length * MAGIC_MISSILE_INTERVAL });
              }
            } else instructions.push({ ...instruction, effectProperties });
            const hitId = impact.hitTokenIds[0];
            const key = hitId ? `hit:${hitId}` : `miss:${selected.id}`;
            const previous = outcomes.get(key);
            if (previous) {
              previous.formula.count += count;
              if (missile) previous.formula.modifier += count;
              previous.selected = undefined;
            } else {
              outcomes.set(key, {
                requestId: index === 0 ? data.requestId : crypto.randomUUID(),
                selected, hitId, firstDart, formula: { ...beamFormula, count, modifier: missile ? count : 0 },
                blocked: missile && Boolean(hitId) &&
                  items.some((item) => item.attachedTo === hitId && isShieldGraphic(item)),
              });
            }
          }
          beamOutcomes = [...outcomes.values()];
          hitTokenIds = beamOutcomes.map(({ hitId }) => hitId).filter(Boolean);
        } else if (skill.location) {
          const isArea = skill.location === "area";
          if (isArea && data.targetLocation === undefined) {
            logSelected = items.find((item) => item.id === data.targetId && isProjectileToken(item));
          }
          const target = await spellDestination(obr, data, items, isArea);
          if (version !== sceneVersion) return;
          if (![target?.x, target?.y].every(Number.isFinite)) {
            if (lastCast.get(sender.id) === now) lastCast.delete(sender.id);
            await answer({ ...result, errorCode: "target-required", error: "Set a map target with Z, WASD, and Space first." });
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
          const maxRange = eldritch || ranged ? skill.range * dpi : Infinity;
          const projectileSpell = projectile && Number.isInteger(skill.spellLevel);
          const targetId = selectedBeams[0]?.id ?? data.targetId;
          const pointAim = aimAtTarget(source, { center: data.targetLocation }, 0, false, maxRange);
          let aimed = pointAim;
          if (!aimed && typeof targetId === "string" && targetId !== token.id) {
            const selected = items.find((item) => item.id === targetId && isProjectileToken(item));
            if (selected) {
              logSelected = selected;
              const target = await obr.scene.items.getItemBounds([selected.id]).catch(() => null);
              if (version !== sceneVersion) return;
              const minimumReach = projectileSpell ? 0 : (skill.range ?? 0) * dpi;
              aimed = aimAtTarget(source, target, minimumReach, !projectileSpell && mode !== "enabled" && isAlly(selected), maxRange);
            }
          }
          if (aimed) {
            if (!await face(aimed)) return;
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
            let canIntercept;
            if (projectileSpell && aimed) {
              if (skill.impact) canIntercept = () => false;
              else if (pointAim) canIntercept = (item) => projectileTokenContainsPoint(item, data.targetLocation, dpi);
              else canIntercept = (item) => item.id === logSelected?.id;
            } else if (mode === "aoe" && skill.impact) {
              // In AoE mode an ally can be caught in the blast without stopping its projectile.
              canIntercept = (item) => !isAlly(item);
            }
            const impact = projectileImpact(source, destination, targets, token.id, dpi, blastRadius, canIntercept);
            instruction.effectProperties.destination = impact.destination;
            if (eldritch) instruction.effectProperties.copies = beamFormula.count;
            hitTokenIds = impact.hitTokenIds;
            missileBlocked = missile && Boolean(hitTokenIds.length) &&
              items.some((item) => item.attachedTo === hitTokenIds[0] && isShieldGraphic(item));
            if (skill.impact) {
              const { effect, delay, visibleRadiusFraction } = skill.impact;
              instructions.push({
                type: "effect", id: effect, delay, layer: instruction.layer,
                effectProperties: { source: impact.destination, size: parameter / visibleRadiusFraction, disableHit: true },
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
      if (missile && !beamOutcomes) {
        const dartCount = spellLevel + 2;
        for (let index = 1; index < dartCount; index++) {
          instructions.push({ ...instruction, delay: index * MAGIC_MISSILE_INTERVAL });
        }
      }
      let damageRolls;
      let damageFormula;
      const meleeHit = Boolean(skill.meleeReach && hitTokenIds.length);
      const metadata = hitTokenIds.length ? await obr.room.getMetadata().catch(() => ({})) : {};
      if (version !== sceneVersion) return;
      const manual = metadata[ROLL_DAMAGE_FROM_COMBAT_LOG] === true;
      const sendMarkers = (delay, damage, {
        useAnimationCue = false, missileFollowUps, dartCount, tokenIds = hitTokenIds, requestId = data.requestId,
      } = {}) => obr.broadcast.sendMessage(HIT_MARKERS, {
        requestId, tokenIds, delay, useAnimationCue,
        splat: manual && !missileBlocked && !damage?.blocked,
        ...(damage ? { damage } : {}),
        ...(missileFollowUps ? { missileFollowUps } : {}),
        ...(dartCount ? { dartCount } : {}),
      }, { destination: "ALL" }).catch((error) => console.error("Overhead Chat hit markers", error));
      if (meleeHit) {
        const timing = normalizeMeleeHitTiming(metadata[MELEE_HIT_TIMING]);
        const cueDelay = Math.round(MELEE_DURATION_MS[weapon] * timing / 100);
        const cue = { type: "action", id: "message", arguments: [MELEE_HIT_CUE, data.requestId, "LOCAL"] };
        if (timing === 100) {
          // Embers runs nested actions after it removes the finished effect.
          instruction.instructions = [cue];
        } else {
          instructions.push({ ...cue, delay: cueDelay });
        }
        if (manual) damageFormula = meleeDamageFormula(weapon, token);
        else damageRolls = [rollMeleeDamage(weapon, token)];
        await sendMarkers(cueDelay + 750, damageRolls?.[0], { useAnimationCue: true });
        if (version !== sceneVersion) return;
      }
      await obr.broadcast.sendMessage(EMBERS_EFFECTS, {
        instructions, spellData: { name: skill.name, caster: sender.id },
      }, { destination: "ALL" });
      if (doorId && version === sceneVersion) {
        await openMeleeDoor(obr, doorId, sender.role, () => version === sceneVersion)
          .catch((error) => console.error("Overhead Chat could not open the door", error));
      }
      if (beamOutcomes) {
        const hitsById = new Map(hitTokens.map((item) => [item.id, item]));
        for (const { requestId, hitId, selected, formula, blocked, firstDart } of beamOutcomes) {
          if (version !== sceneVersion) return;
          const hit = hitsById.get(hitId);
          const marker = { requestId, tokenIds: hit ? [hit.id] : [] };
          let rolls;
          if (hit && missile) {
            const delay = skill.hitDelay + firstDart * MAGIC_MISSILE_INTERVAL;
            if (manual && !blocked) await sendMarkers(delay, undefined, { ...marker, dartCount: formula.count });
            else {
              rolls = Array.from({ length: formula.count }, () => blocked ? BLOCKED_MAGIC_MISSILE : rollMagicMissileDart());
              const [damage, ...followUps] = rolls;
              await sendMarkers(delay, damage, { ...marker, missileFollowUps: followUps.length ? followUps : undefined });
            }
          } else if (hit) {
            rolls = manual ? undefined : [rollSpellDamage(formula)];
            await sendMarkers(skill.hitDelay, rolls?.[0], marker);
          }
          await logCast({
            requestId, selected, attack: true, hits: hit ? [hit] : [],
            damage: combatDamage(rolls),
            damageFormula: hit && manual && !blocked ? formula : undefined,
          });
        }
        if (version === sceneVersion) await answer(latestLoadout);
        return;
      }
      if (version === sceneVersion && hitTokenIds.length && missile) {
        if (manual && !missileBlocked) {
          const count = instructions.length;
          damageFormula = { count, sides: 4, type: "force", modifier: count };
          await sendMarkers(skill.hitDelay, undefined, { dartCount: count });
        } else {
          damageRolls = instructions.map(() => missileBlocked ? BLOCKED_MAGIC_MISSILE : rollMagicMissileDart());
          const [damage, ...missileFollowUps] = damageRolls;
          await sendMarkers(skill.hitDelay, damage, { missileFollowUps });
        }
      } else if (version === sceneVersion && hitTokenIds.length && !meleeHit) {
        const formula = ranged ? rangedDamageFormula(token) : spellDamageFormula(skill, token, spellLevel);
        if (manual) damageFormula = formula;
        else if (formula) damageRolls = [ranged ? rollRangedDamage(token) : rollSpellDamage(formula)];
        await sendMarkers(skill.impact?.delay ?? skill.hitDelay, damageRolls?.[0]);
      }
      await logCast({
        action: ranged ? RANGED_WEAPONS[weapon] : skill.meleeReach && weapon !== DEFAULT_WEAPON ? WEAPONS[weapon] : skill.name,
        attack: checksHit && skill.location !== "teleport",
        selected: logSelected, hits: hitTokens, damage: combatDamage(damageRolls), damageFormula,
      });
      if (version === sceneVersion) await answer(latestLoadout);
    } catch (error) {
      console.error("Overhead Chat skills", error);
    }
  });
}
