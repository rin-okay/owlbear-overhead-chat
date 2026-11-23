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

All chat tabs are visible to everyone in the Owlbear room. The public chat dropdown starts on **general** and also offers **rin's room** and **kim's room**. Messages and dice results go to the log for the chat room selected when you send. Overhead bubbles are still public to the Owlbear room. Use them for tokens the room is meant to see. Fog is not a privacy boundary for broadcasts. The transcript keeps the latest 1,000 messages across all chat rooms in memory for the current room tab. Switching chat rooms shows the latest 100 messages in that room, and **load older messages** shows earlier messages in batches. Closing the chat panel keeps the transcript. After reloading or rejoining, Overhead Chat asks a connected GM running the updated extension for the last two minutes of chat. Recovery covers messages received by that GM during their current room session. Avatar selection is remembered for this room in the same browser.

With an Owlbear scene open, F1 opens and focuses chat, and F2 opens chat in move mode. F3 centers the view on your saved chat avatar at the current zoom. Turn on camera follow mode in settings or press F4 to keep the avatar centered as it moves. F4 toggles the setting, which is saved for this room in your browser. The shortcuts use your saved avatar regardless of the map selection. The move button also enters move mode. The arrow keys and WASD move it by one grid interval. On square grids, a regular step from off-grid snaps to the next cell center along that axis. If that center is less than an eighth of a cell away, the step continues to the following center. Hold Shift to move exactly half a cell without snapping. Q or comma rotates left, and E or period rotates right, 15 degrees at a time. Shift+Q and Shift+E turn left and right by 90 degrees. Hold a rotation key to keep turning. Press R to mirror the avatar horizontally. Space, Enter, F1, or Escape returns to typing. Clicking away also exits move mode.

The **avatar** tab saves nine artwork slots for this room in your browser. In **change to**, choose artwork from Owlbear’s Characters assets and press **1–9** in move mode to apply it. If Owlbear can’t open the Characters picker, choose the artwork from a character token you own in the open scene. You can remove the source token after saving the slot. The GM also has nine **talk as** slots for switching to visible, unlocked character tokens. Tap the same number twice quickly to apply the slot and return to typing.

The GM can turn on **habbo hotel mode** in the **gm** tab for pixel-style bubbles. They rise from the spot where each message was spoken, stack above newer bubbles, and disappear after roughly six lines of travel. Set **bubble scale** to resize new bubbles and scale the distance they rise per step. The room default is 2×.

[Owlbear Rodeo's extension installation guide](https://docs.owlbear.rodeo/extensions/tutorial-hello-world/install-your-extension/) · [Owlbear Rodeo's player permissions guide](https://docs.owlbear.rodeo/docs/permissions/)

## Skill hotkeys with Embers

Enable [Embers](https://extensions.owlbear.rodeo/embers) in the room, then turn on **enable skill hotkeys** in **skills → grants** as GM. Choose a token, select a spell or weapon variant, then check the corresponding grant box. Everyone starts with generic slash. The enable switch and grants are saved in the GM’s browser for the room. A GM running this release must be connected to approve casts.

Open **skills** to set your avatar’s facing at zero rotation, pick a granted weapon, and rebind available skills. Facing is saved per artwork, and weapon choice is saved per token. The default move-mode keys are **F** for melee weapon attack, **G** for Magic Missile, **H** for Burning Hands, **J** for Fire Bolt, and **K** for Fireball. The GM grants the spells independently. After granting Fireball or Burning Hands, set its radius or cone length for that token in cells. Clear the field to restore the default.

A token’s **Spell Level** sets the highest level it can cast, from 0 (cantrips only) to 9. Existing tokens start at 9 until a cap is saved. Players can see the cap under **skills → stats**. GMs edit it under **skills → grants → stats**, and **editable stats for players** also lets eligible players edit it. Attempts above the cap show a private notice in the player’s chat.

Magic Missile (**G**) fires three staggered darts at level 1. Hold **Shift** and press its bound hotkey, then press **1–9** on the number row to choose the spell level, or **Escape** to cancel. Each level above 1 adds another dart. The darts share the current aim, and each hit rolls and displays its own 1d4 + 1 force damage.

Eldritch Blast (**U**) fires along your facing, toward the selected target, or toward your map marker. It reaches up to 24 cells and stops at the first eligible token or blocking wall. It rolls 1d10 force damage per beam, with extra beams at token levels 5, 11, and 17. The beams share one aim point and the hit marker shows their combined damage.

Misty Step (**I**) moves your avatar to an open map target within six cells and plays mist at both ends. Press **Z**, position the marker with **WASD**, then press **Space** to set it. The landing space must be clear of tokens and blocking walls.

Shatter (**O**) uses the map marker or a single selected token within 12 cells. Its radius defaults to two cells and can be changed per token in **skills → grants**. The blast rolls 3d8 thunder damage once and shows that amount on eligible tokens in the area. Resolve spell attacks, saves, and HP changes at the table.

Bless (default **B**) uses the same team assignments. With no selection, Bless affects the caster and randomly fills the remaining slots with allies in range. With a selection, it affects only the selected eligible allies, including the caster if selected. The GM can set the range and maximum recipients in **skills → grants**. The defaults are six cells and three targets. Cast again to remove this caster’s Bless graphics. Bless uses the [JB2A loop from Embers](https://github.com/ArmindoFlores/embers).

Use **team** under **skills → grants** to assign any combination of the six teams to a token. Tokens are allies if they share at least one team. Assignments are private to the GM’s browser. **Enable friendly fire** defaults to **enabled**, so all eligible targets can be hit. **Disabled** lets projectiles pass through allies and excludes allies from all hit markers. **AoE** lets projectiles pass through allies and applies allied hit markers to Fireball’s explosion, the Burning Hands cone, and Shatter.

Melee attacks show rolled weapon damage on the first character token struck within one grid width along your avatar’s facing. In the GM tab, set melee hit marker timing from 0% (swing start) to 100% (animation end). The default is 75%. Blocking walls stop the hit. A melee strike opens a closed, unlocked Smoke & Spectre door at the point of impact. Players can do this when Smoke & Spectre’s Players See Doors setting is on. Melee attacks, projectiles, and cones turn the avatar toward a single other selected character token before casting. When aimed at a selection, Magic Missile, Fire Bolt, and Fireball can travel farther than their forward-cast range. Melee reach and Burning Hands length still apply. With no target selected, skills fire forward. Magic Missile travels up to eight grid widths, Fire Bolt up to 24, and Fireball up to 30 on a forward cast. They stop at the first eligible character token, blocking native wall, or active Smoke & Spectre obstruction. Open doors and nonblocking windows let projectiles through. Explicitly hidden tokens, Spectres, and audience-restricted Smoke walls are omitted from shared collision effects. Fire Bolt shows a red `-1` over the first token struck. Magic Missile shows one rolled damage marker per dart. Fireball plays an explosion at its endpoint (eight cells wide by default) and shows a `-1` over every other eligible token whose hit circle overlaps the blast and whose center has a clear path to the impact. Hit markers are visible in the scene and don’t change hit points. Burning Hands plays a cone (three cells long by default) and marks each eligible token it reaches around the caster’s facing. Blocking walls provide cover. Hit markers provide visual feedback. Resolve any remaining damage, saves, and elevation at the table.

## Discord relay

In a Discord text channel, create an incoming webhook under **Edit Channel → Integrations** and copy its URL. As the Owlbear room GM, open the **gm** tab, paste the webhook URL under **discord mirroring**, and use **send test**. To start sending new messages, turn on **mirror new general messages** and save. To include the other tabs, also enable **also mirror the other public chat tabs**. Existing relay settings default to General after the update.

The relay runs while the configured GM has the Owlbear room tab open. It mirrors new public Overhead Chat messages in the selected scope. The relay only runs from Owlbear to Discord and starts with new messages. Use one configured GM browser per room. The webhook URL stays in that browser’s local storage for that GM and room.

## Rolling dice

Start a message with `/r` followed by the dice expression, such as `/r 1d20+7` or `/r 2d20kh1`. Hover over a result in the chat log to see the expression and dice breakdown.

With Rumble! off, everyone in the Owlbear room running Overhead Chat, including the roller, sees the same 3D toss in a temporary popup. The popup animates up to eight standard dice (d4, d6, d8, d10, d12, d20) and shows the roll totals. Custom dice and dice beyond the preview limit still count in the chat result.

Roll `/r 1d100` or `/r 1d%` for percentile dice. The tens die (00–90) and the ones die (0–9) add together, with 00 + 0 counting as 100. Keep and drop modifiers apply to the combined percentile value.

The dice use the roller’s bubble fill for the body, text color for the numbers, and bubble border for the 3 px edges. The tray shows each die and modifier in the final calculation, with dropped dice struck through.

The shared replay uses the [Dicesuki](https://github.com/donovan-yohan/dicesuki) solo WebAssembly physics engine by Donovan Yohan (MIT), pinned to commit `8fae459b1b31a112d918ec3897e66c5f67b5e409`. Its Rapier simulation produces the faces and motion for the 3D dice. The popup uses Dicesuki's basic white dice styling and [face numbering](./DICESUKI-LICENSE.md).

The GM can enable **use rumble! for dice rolls** in the **gm** tab to use Rumble’s notation and dice animations. Open Rumble! in the room before rolling in Overhead Chat.
