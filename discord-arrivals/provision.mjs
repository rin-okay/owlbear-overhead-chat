import { ARRIVAL, avatarTokenId, character, point, smokeFields } from "./model.mjs";

export async function planToken({ room, player, profile, config, items, party }) {
  if (!config?.enabled || !point(config.spawn)) throw Error("The GM needs to enable arrivals and set a spawn point.");
  const id = await avatarTokenId(room, profile.profile);
  const existing = items.find((item) => item.id === id);
  if (existing) {
    if (!character(existing) || existing.metadata?.[ARRIVAL]?.profile !== profile.profile) {
      throw Error("The GM needs to resolve a token ID conflict.");
    }
    if (existing.createdUserId !== player && party.some((other) => other.id === existing.createdUserId)) {
      throw Error("This Discord account already has a token controlled by a connected player.");
    }
    return { id, existing, needsVision: existing.metadata[ARRIVAL].needsVision === true };
  }
  let vision = {};
  if (config.vision === "smoke-template") {
    const template = items.find((item) => item.id === config.templateId && character(item));
    vision = smokeFields(template);
  }
  const needsVision = config.vision === "smoke-manual" ||
    (config.vision === "smoke-template" && !Object.keys(vision).length);
  return { id, needsVision, metadata: { ...vision, [ARRIVAL]: { profile:profile.profile, needsVision } } };
}
