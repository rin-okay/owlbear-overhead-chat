export const ASSIGNMENT_MODAL = "chat.overhead.assignment.v1";
const MENU = ASSIGNMENT_MODAL + "/menu";

export async function openAssignment(obr, tokenId) {
  if (await obr.player.getRole() !== "GM") return;
  const [width, height] = await Promise.all([obr.viewport.getWidth(), obr.viewport.getHeight()]);
  const url = new URL("./assignment.html?v=3.1.0", import.meta.url);
  if (tokenId) url.searchParams.set("token", tokenId);
  await obr.modal.open({
    id: ASSIGNMENT_MODAL, url: url.href, hidePaper: true,
    width: Math.max(1, Math.min(width - 32, 1040)),
    height: Math.max(1, Math.min(height - 32, 780)),
    fullScreen: width < 640 || height < 560,
  });
}

export function setupAssignmentMenu(obr) {
  let registered = false;
  let queue = Promise.resolve();
  const sync = () => {
    queue = queue.then(async () => {
      const gm = await obr.player.getRole() === "GM";
      if (gm === registered) return;
      if (gm) {
        await obr.contextMenu.create({
          id: MENU,
          icons: [{
            icon: new URL("./assignment.svg", import.meta.url).href, label: "Assign",
            filter: { min: 1, max: 1, every: [{ key: "type", value: "IMAGE" }, { key: "layer", value: "CHARACTER" }] },
          }],
          onClick: ({ items }) => openAssignment(obr, items[0]?.id).catch(console.error),
        });
      } else await obr.contextMenu.remove(MENU);
      registered = gm;
    }).catch(console.error);
  };
  obr.player.onChange(({ role }) => { if ((role === "GM") !== registered) sync(); });
  sync();
}
