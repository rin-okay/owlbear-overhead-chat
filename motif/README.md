# Motif v0.3.4

[Install in Owlbear Rodeo](https://rin-okay.github.io/owlbear-overhead-chat/motif/manifest.json).

This extension is adapted from [Embers by Armindo Flores](https://github.com/ArmindoFlores/embers/tree/842d674946a4e031013ce12d0a5502b0e78bd407) with permission. The source archive beside this README includes the adapted Embers source, the original sample audio, and the npm lockfile. Build it with Node 22, `npm ci`, and `npm run build`. Output goes to `dist`.

## Play and manage sounds

Open the Motif tool with Shift+M or its toolbar icon, then press period to select a sound and Enter to play it. Optionally click a map cell or token to show a ripple. Music can play alongside effects. Manual playback goes to all audio-enabled tokens in the scene. A manually played music cue becomes the room’s fallback. Triggered music can take over for its listeners while the fallback keeps playing muted. It becomes audible again at its current position when the listener has no active music override. Right-click **Play selected sound** and choose **Force play** to override other music, including new automation cues, until the forced track stops. Sound effects continue to play. The GM can right-click the play button and choose **Play for** to send a cue only to the checked audio-enabled tokens.

The library is grouped into Sound effects and Music folders. Search matches track names, tags, and folders. The playback button stays in the footer. The GM can add music or effects under Custom using a public HTTPS media URL and set the folder, comma-separated tags, and optional duration. Motif reads duration from direct audio when it is available. Suno tracks can use a manually entered duration. Dropbox share links are normalized automatically. Audio needs to be directly playable by the browser. Motif prefetches the examples and prefetches a cue when selected, following Embers’ browser-cache approach. Sources that can’t be prefetched can stream directly.

Paste a Suno embed or full song URL into Custom to share a Suno track in Active. Select and play the cue to open Suno’s player. Other listeners can open it from Active and press play. Use Minimize to keep the Suno player in a small bar at the bottom left, then Expand to restore its controls. The embedded player has its own clock and controls. Use a publicly hosted audio file for synchronized playback, Motif volume, looping, and trimming.

Use Active to pause, resume, hide and mute, change volume, set clip points or looping, or stop a sound. Settings has personal music and effect volumes, plus the GM switch for player casting in the active scene. v0.2 starts a fresh custom library.

After a refresh, Motif resumes room audio at the shared playback position. If the browser blocks autoplay, open Motif and click **Resume audio**.

## Map triggers

Right-click a character token and choose **Enable audio**. The GM can review or change its listener in **Auto → Audio-enabled tokens**. If several tokens are assigned to the same Owlbear user, that client hears their combined cues with one playback per active entry.

Press **Shift+M** and choose **Trigger definition (line)** or **Trigger definition (region)**. Place two endpoints for a line, or click the vertices of a polygon. Press **Enter** or click **Finish drawing**, then name it. In **Auto → Add new**, select the trigger and a direct audio cue. Choose the start and stop conditions, looping, the map ripple, the audience, and any music tags to mute for that audience while the cue is active.

A room-wide region rule starts on the first entry and stops on the last exit when configured that way. A rule with no start event can be started from Auto. Automatic cues stop when the scene closes. Suno embeds use the manual share flow.

In **Active**, expand a cue’s listener list to mute, unmute, or remove a token. The cue’s edit and stop controls apply to the whole entry.

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

The built-in music IDs are `stillwater`, `lantern-lane`, and `iron-pulse`. The built-in sound effect IDs are `silver-bell`, `low-knock`, and `soft-sweep`. Custom IDs are shown in the GM library. A connected GM with Motif handles shared playback. Overhead Chat can send this broadcast alongside its existing Embers call.
