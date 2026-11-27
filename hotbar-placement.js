import OBR from "./obr.js";
import { HOTBAR_PLACEMENT, clampAnchor, sendHotbarCommand } from "./hotbar.js?v=3.2.2";

const params = new URLSearchParams(location.search);
const number = (key) => Number(params.get(key));
const left = params.get("left") === "true";
const compact = params.get("compact") === "true";
const slots = number("slots");
const size = { width: number("width"), height: number("height") };
const startX = number("screenX");
const startY = number("screenY");
const gripX = number("x") - (left ? 0 : size.width / 2);
const gripY = number("y") - (left ? size.height / 2 : size.height);
const preview = document.querySelector("#preview");
const cancel = document.querySelector("#cancel");
let ready = false;
let committing = false;
let pressed = false;

function close() {
  void OBR.modal.close(HOTBAR_PLACEMENT).catch(console.error);
}

function position(event) {
  const viewport = { width: innerWidth, height: innerHeight };
  return clampAnchor(left, { left: event.clientX - gripX, top: event.clientY - gripY }, viewport, size);
}

function show(event) {
  const point = position(event);
  preview.style.left = (point.left - (left ? 0 : size.width / 2)) + "px";
  preview.style.top = (point.top - (left ? size.height / 2 : size.height)) + "px";
  preview.hidden = false;
}

preview.style.width = size.width + "px";
preview.style.height = size.height + "px";
OBR.onReady(() => { ready = true; cancel.focus({ preventScroll: true }); });
cancel.addEventListener("click", close);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
document.addEventListener("pointerdown", (event) => {
  if (event.isPrimary && event.button === 0 && !event.target.closest("button")) pressed = true;
});
document.addEventListener("pointercancel", () => { pressed = false; });
document.addEventListener("pointermove", show);
document.addEventListener("pointerup", async (event) => {
  if (!ready || committing || !event.isPrimary || event.button !== 0 || event.target.closest("button")) return;
  const wasPressedHere = pressed;
  pressed = false;
  // Opening the placement surface from a click leaves it armed for the next click.
  if (!wasPressedHere && Math.hypot(event.screenX - startX, event.screenY - startY) < 4) return;
  const anchor = position(event);
  committing = true;
  try {
    await sendHotbarCommand(OBR, "move", {
      left, compact, slots, absolute: true, x: anchor.left / innerWidth, y: anchor.top / innerHeight,
    });
    await OBR.modal.close(HOTBAR_PLACEMENT);
  } catch (error) {
    console.error("Overhead Chat hotbar placement", error);
    committing = false;
  }
});
