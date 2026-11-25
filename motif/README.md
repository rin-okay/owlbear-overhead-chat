# Motif v0.2.6

[Install in Owlbear Rodeo](https://rin-okay.github.io/owlbear-overhead-chat/motif/manifest.json).

This extension is adapted from [Embers by Armindo Flores](https://github.com/ArmindoFlores/embers/tree/842d674946a4e031013ce12d0a5502b0e78bd407) with permission. The source archive beside this README includes the adapted Embers source, the original sample audio, and the npm lockfile. Build it with Node 22, `npm ci`, and `npm run build`. Output goes to `dist`.

## Play and manage sounds

Use the Motif tool, then press period to select a sound and Enter to play it. Shift+C is shared with Embers, so use the separate toolbar buttons when both extensions are enabled. Optionally click a map cell or token to show a ripple. Music can play alongside effects. Playing a second music track replaces the first.

The library is grouped into Sound effects and Music folders. Search matches track names, tags, and folders. The playback button stays in the footer. The GM can add music or effects under Custom using a public HTTPS media URL and set the folder, comma-separated tags, and optional duration. Motif reads duration from direct audio when it is available. Suno tracks can use a manually entered duration. Dropbox share links are normalized automatically. Audio needs to be directly playable by the browser. Motif prefetches the examples and prefetches a cue when selected, following Embers’ browser-cache approach. Sources that can’t be prefetched can stream directly.

Paste a Suno embed or full song URL into Custom to share a Suno track in Active. Select and play the cue to open Suno’s player. Other listeners can open it from Active and press play. The embedded player has its own clock and controls. Use a publicly hosted audio file for synchronized playback, Motif volume, looping, and trimming.

Use Active to pause, resume, hide and mute, change volume, set clip points or looping, or stop a sound. Settings has personal music and effect volumes, plus the GM switch for player casting in the active scene. v0.2 starts a fresh custom library.

## Broadcast API

Motif keeps Embers’ instruction envelope and uses its own channel. Pass a Motif library ID in each instruction. Optional `delay` and `duration` use milliseconds. `loops: -1` loops until stopped. The optional source coordinates place a map ripple.

```js
await OBR.broadcast.sendMessage("io.github.rin-okay.motif-v2/effects", {
  instructions: [{
    type: "effect",
    id: "silver-bell",
    effectProperties: { source: { x: 200, y: 300 } }
  }],
  spellData: { name: "Silver Bell", caster: await OBR.player.getId() }
}, { destination: "ALL" });
```

The built-in IDs are `stillwater`, `silver-bell`, `low-knock`, and `soft-sweep`. Custom IDs are shown in the GM library. A connected GM with Motif handles shared playback. Overhead Chat can send this broadcast alongside its existing Embers call.
