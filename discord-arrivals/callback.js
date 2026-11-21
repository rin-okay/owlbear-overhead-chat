const ticket = document.querySelector("textarea");
const back = document.querySelector("#return");
if (window.opener) {
  window.opener.postMessage({ type: "discord-arrivals/oauth", ticket: ticket.value }, ticket.dataset.openerOrigin);
  back.hidden = false;
}
back.addEventListener("click", () => window.close());
document.querySelector("#copy").addEventListener("click", async () => {
  ticket.select();
  try {
    await navigator.clipboard.writeText(ticket.value);
    document.querySelector("#feedback").textContent = "Code copied. Paste it into Discord Arrivals.";
  } catch {
    document.querySelector("#feedback").textContent = "Copy the selected code and paste it into Discord Arrivals.";
  }
});
