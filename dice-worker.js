import { simulate } from "./dice-physics.js";

self.onmessage = async ({ data }) => {
  try {
    self.postMessage(await simulate(data));
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
