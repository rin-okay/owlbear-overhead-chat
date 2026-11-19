import OBR from "./obr.js";
import { discordSettings, normalizeWebhook, saveDiscordSettings, sendDiscord } from "./discord.js";

export function setupDiscordPanel(openChat, openDiscord) {
  const tab = document.querySelector("#discord-tab");
  const panel = document.querySelector("#discord-panel");
  const form = panel.querySelector("form");
  const field = form.elements.namedItem("webhook");
  const enabled = form.elements.namedItem("enabled");
  const status = panel.querySelector("#discord-status");
  const test = panel.querySelector("#discord-test");

  function load() {
    const saved = discordSettings();
    field.value = "";
    field.placeholder = saved.url ? "Webhook URL saved" : "Paste Discord webhook URL";
    enabled.checked = saved.enabled;
  }

  function draftUrl() {
    if (!field.value.trim()) return discordSettings().url;
    const url = normalizeWebhook(field.value);
    if (!url) throw new Error("Paste a Discord webhook URL from the channel’s Integrations settings.");
    return url;
  }

  function updateRole(role) {
    tab.hidden = role !== "GM";
    if (!tab.hidden || panel.hidden) return;
    field.value = "";
    status.textContent = "";
    openChat();
  }

  OBR.player.getRole().then(updateRole).catch(() => updateRole("PLAYER"));
  OBR.player.onChange(({ role }) => updateRole(role));
  tab.addEventListener("click", async () => {
    if (await OBR.player.getRole() !== "GM") return;
    load();
    status.textContent = "";
    openDiscord();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (await OBR.player.getRole() !== "GM") return;
    try {
      const url = draftUrl();
      if (!url) throw new Error("Paste a webhook URL before saving.");
      saveDiscordSettings({ url, enabled: enabled.checked });
      load();
      status.textContent = enabled.checked ? "Saved. New chat messages will be mirrored." : "Saved. Mirroring is paused.";
    } catch (error) {
      status.textContent = error.name === "SecurityError" || error.name === "QuotaExceededError"
        ? "This browser blocked saving the webhook." : error.message;
    }
  });

  panel.querySelector("#discord-remove").addEventListener("click", async () => {
    if (await OBR.player.getRole() !== "GM") return;
    try {
      saveDiscordSettings({ url: "", enabled: false });
      load();
      status.textContent = "Webhook removed.";
    } catch {
      status.textContent = "This browser blocked removing the webhook.";
    }
  });

  test.addEventListener("click", async () => {
    if (await OBR.player.getRole() !== "GM") return;
    test.disabled = true;
    try {
      const url = draftUrl();
      if (!url) throw new Error("Paste a webhook URL before testing.");
      status.textContent = "Sending test message…";
      await sendDiscord(url, { name: "Overhead Chat", text: "Discord relay test from Owlbear Rodeo." });
      status.textContent = "Test message delivered.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      test.disabled = false;
    }
  });
}
