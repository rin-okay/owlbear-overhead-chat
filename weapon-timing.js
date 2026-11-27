import { MELEE_DURATION_MS } from "./skills.js?v=3.1.0";

export const DEFAULT_WEAPON_DELAY = 45;

// Embers' first clip duration for each ranged resolution, in milliseconds.
// All listed projectile effects use 200 pixels per grid cell in the source art.
const arrow = [[200, 1730], [600, 1870], [1200, 1870], [2400, 2070], [3600, 2400]];
const boulderToss = [[200, 930], [600, 1200], [1200, 1600], [2400, 2430], [3600, 3270]];
const laserShot = [[200, 500], [600, 630], [1200, 670], [2400, 900], [3600, 1030]];
const missile = [[600, 670], [1200, 930], [2400, 1370], [3600, 1830]];
const thrown = [[200, 1470], [600, 1800], [1200, 2200], [2400, 3070], [3600, 3530]];
const ranged = {
  "arrow.green": arrow,
  "arrow.white": arrow,
  "arrow.blue": arrow,
  "bolt": [[200, 1400], [600, 1400], [1200, 1500], [2400, 1670], [3600, 1830]],
  "boulder_toss": boulderToss,
  "bullet.orange": [[200, 530], [600, 530], [1200, 630], [2400, 830], [3600, 970]],
  "bullet.large_orange": [[200, 930], [600, 930], [1200, 930], [2400, 930], [3600, 930]],
  "bullet.blue": [[200, 1030], [600, 1300], [1200, 1300], [2400, 1230], [3600, 1370]],
  "dagger.throw": [[600, 1500], [1200, 1600], [1800, 1630], [2400, 1770], [3600, 1930]],
  "laser_shot.blue": laserShot,
  "laser_shot.green": laserShot,
  "laser_shot.orange": laserShot,
  "laser_shot.red": laserShot,
  "laser_sword.blue": [[600, 2370], [1200, 2770], [2400, 3270], [3600, 3370]],
  "laser_sword.red": [[600, 2430], [1200, 2770], [2400, 3170], [3600, 3730]],
  "cannon_ball": [[200, 470], [600, 770], [1200, 1170], [2400, 2070], [3600, 2430]],
  "barrel_toss.metal": boulderToss,
  "barrel_toss.wooden": boulderToss,
  "missile.blue": missile,
  "missile.white": missile,
  "missile.wide_white": missile,
  "missile.purple_pink": missile,
  "shield.throw": [[600, 1470], [1200, 1600], [2400, 1770], [3600, 1930]],
  "shield.complete": [[600, 2530], [1200, 2630], [2400, 2900], [3600, 3170]],
  "snipe": [[200, 1100], [600, 1370], [1200, 1170], [2400, 1200], [3600, 2570]],
  "snowball": [[200, 2870], [600, 2870], [1200, 2870], [2400, 3370], [3600, 3570]],
  "throw.bomb": thrown,
  "throw.flask": thrown,
};

export const validWeaponDelay = (value) => Number.isInteger(value) && value >= 0 && value <= 100;

export function weaponDelay(duration, percent) {
  return Math.round(duration * (validWeaponDelay(percent) ? percent : DEFAULT_WEAPON_DELAY) / 100);
}

export function weaponAnimationDuration(weapon, { source, destination }, dpi) {
  if (weapon.kind === "weapon") return MELEE_DURATION_MS[weapon.animation];
  // Embers selects the resolution closest to the projectile's rendered distance.
  const size = Math.hypot(destination.x - source.x, destination.y - source.y) / dpi * 200;
  const resolutions = ranged[weapon.animation];
  const [, duration] = resolutions.reduce((best, candidate) =>
    Math.abs(candidate[0] - size) < Math.abs(best[0] - size) ? candidate : best);
  return duration;
}
