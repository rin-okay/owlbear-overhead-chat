const channel = new BroadcastChannel(`chat.overhead.dice-tray:${location.hash.slice(1)}`);
const canvas = document.querySelector("canvas");
const speaker = document.querySelector("#speaker");
const output = document.querySelector("output");
const faces = document.querySelector("#faces");

document.querySelector("button").addEventListener("click", () => channel.postMessage("close"));
channel.onmessage = async ({ data: { name, rolls, dice, count, frames, duration } }) => {
  channel.onmessage = null;
  speaker.textContent = `${name} is rolling…`;

  let animated = false;
  if (frames.length) {
    try {
      const { animateTray } = await import("./dice-render.js");
      canvas.hidden = false;
      await animateTray(canvas, dice.filter((die) => die.physical), frames, duration);
      animated = true;
    } catch (error) {
      console.warn("Overhead Chat dice rendering unavailable", error);
      canvas.hidden = true;
    }
  }

  speaker.textContent = `${name} rolled`;
  const chips = animated ? dice.filter((die) => !die.physical) : dice;
  for (const { sides, value, kept } of chips) {
    const chip = document.createElement("span");
    chip.textContent = `d${sides} · ${value}`;
    if (!kept) {
      chip.className = "dropped";
      chip.title = "Dropped";
    }
    faces.append(chip);
  }
  if (count > dice.length) {
    const more = document.createElement("span");
    more.textContent = `+${count - dice.length} more`;
    faces.append(more);
  }
  if (faces.childElementCount) {
    faces.hidden = false;
    if (animated) faces.dataset.overlay = "";
  }
  for (const { notation, total } of rolls) {
    const result = document.createElement("span");
    result.textContent = `${notation} = ${total}`;
    output.append(result);
  }
  channel.postMessage("settled");
};
channel.postMessage("ready");
