# Overhead Chat for Owlbear Rodeo

Select a character, choose **Set as avatar** in the selection menu, and type into the Overhead Chat panel. Press Enter or click Send. Each character gets one speech bubble at a time. A new line replaces the previous one and stays up for six seconds. The extension displays bubbles for other players even while their chat panels are closed.

## Install for your group

1. Copy the [GitHub Pages manifest URL](https://rin-okay.github.io/owlbear-overhead-chat/manifest.json).
2. In your Owlbear Rodeo profile, choose **Add Extension** and paste the URL. If your room uses the old Netlify install, disable that copy in the room's **Extensions** menu.
3. Enable the GitHub Pages copy of **Overhead Chat** in the room's **Extensions** menu and reload any open room tabs. The GM enables it for the room and players join normally.
4. Select a placed image on the **Character** layer and choose **Set as avatar**. Use the speech-bubble icon near the top left to reopen chat.

GitHub Pages publishes changes pushed to `main`. The extension loads Owlbear Rodeo SDK 3.1.0 from jsDelivr.

Players need **Update** enabled for characters in the room's Player Permissions. If the GM also enables **Owner Only**, players must own their token. The GM can assign it using the token's **Owner** menu. Players can speak through unlocked characters they have permission to update. The GM can speak through visible character tokens.

## Test locally

With Python 3 installed, name the checkout folder `owlbear-overhead-chat` and run this in its parent directory.

```sh
python3 -m http.server 5173 --bind 127.0.0.1
```

Add `http://localhost:5173/owlbear-overhead-chat/manifest.json` to your Owlbear Rodeo profile using the same steps. Use a shared HTTPS address to test with players on other devices.

Try two messages in quick succession, then move the token and confirm the latest bubble stays attached and disappears. Repeat from a player account with Owner Only enabled to check the ownership filter.

The extension sends public room speech. Use it for tokens the room is meant to see. Fog is not a privacy boundary for broadcasts. The transcript runs in memory for the current room tab. Closing the chat panel keeps the transcript, and reloading the room starts a new one. Avatar selection is remembered for this room in the same browser.

[Owlbear Rodeo's extension installation guide](https://docs.owlbear.rodeo/extensions/tutorial-hello-world/install-your-extension/) · [Owlbear Rodeo's player permissions guide](https://docs.owlbear.rodeo/docs/permissions/)

## Discord relay

In a Discord text channel, create an incoming webhook under **Edit Channel → Integrations** and copy its URL. As the Owlbear room GM, open the **gm** tab, paste the webhook URL under **discord mirroring**, and use **send test**. To start sending new messages, turn on **mirror new chat messages** and save.

The relay runs while the configured GM has the Owlbear room tab open. It mirrors new public Overhead Chat messages; it does not replay history or bring Discord messages back into Owlbear. Use one configured GM browser per room. The webhook URL stays in that browser’s local storage for that GM and room.

## Rolling dice

Send `/r 1d20+7` for a standalone roll, or include `r[2d20kh1]` inside a message. Hover over a result in the chat log to see the expression and dice breakdown.

With Rumble! off, everyone in the Owlbear room running Overhead Chat, including the roller, sees the same 3D toss in a temporary popup. The popup animates up to eight standard dice (d4, d6, d8, d10, d12, d20) and shows the roll totals. Custom dice and dice beyond the preview limit still count in the chat result.

Roll `/r 1d100` or `/r 1d%` for percentile dice. The tens die (00–90) and the ones die (0–9) add together, with 00 + 0 counting as 100. Keep and drop modifiers apply to the combined percentile value.

The dice use the roller’s bubble fill for the body, text color for the numbers, and bubble border for the 3 px edges. The tray shows each die and modifier in the final calculation, with dropped dice struck through.

The shared replay uses the [Dicesuki](https://github.com/donovan-yohan/dicesuki) solo WebAssembly physics engine by Donovan Yohan (MIT), pinned to commit `8fae459b1b31a112d918ec3897e66c5f67b5e409`. Its Rapier simulation produces the faces and motion for the 3D dice. The popup uses Dicesuki's basic white dice styling and [face numbering](./DICESUKI-LICENSE.md).

The GM can enable **use rumble! for dice rolls** in the **gm** tab to use Rumble’s notation and dice animations. Open Rumble! in the room before rolling in Overhead Chat.
