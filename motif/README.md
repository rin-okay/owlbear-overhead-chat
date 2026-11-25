# Motif

A standalone Owlbear Rodeo extension for room music and sound effects. Install its [manifest](https://rin-okay.github.io/owlbear-overhead-chat/motif/manifest.json) and enable Motif in your room.

## Play a sound

- Activate the Motif tool with Shift+C or its waveform toolbar button. Press period or use Select sound to open the library. Choose a cue, then use Play selected sound in the panel or Enter with the Motif tool active.
- With Embers installed alongside Motif, both tools use Shift+C. The individual toolbar buttons let you pick the intended tool.
- Click a token or cell with the Motif tool to add an optional ripple. X clears the target. A target has no effect on who hears the cue.
- The active list lets the GM pause, resume, stop, hide and mute, or edit loops, volume, and clip start/end times. One music track can play alongside multiple effects. Music keeps its place when effects are added, and starting a second music track replaces the first.
- Everyone can adjust their own music and effects sliders. If the browser blocks autoplay, click Enable room audio in Motif, then Enable audio in the floating listener. Keep that listener open while using the fallback.

## Audio links

Add sound in the library and paste a public HTTPS link to a browser-playable audio file. MP3 and WAV are good starting points. Dropbox share links are converted to raw links automatically. The host needs to return media that plays without sign-in. Page links and files in unsupported codecs won’t play.

Motif first checks a per-device browser cache. Successful CORS-readable responses can be stored, up to 24 MiB per file and twelve files. When a host supports playback without CORS or a file exceeds the cache size, Motif falls back to browser streaming. Custom cues and current room playback are stored in room metadata. The four included sounds are original synthesized samples served alongside this extension.

## Broadcast API

Send to Motif using the Owlbear Rodeo SDK. Audio URLs and playback settings come from the Motif library, and no protocol changes to Overhead Chat are required to test Motif on its own.

```js
await OBR.broadcast.sendMessage("io.github.rin-okay.motif/play", {
  cueId: "spell-chime",
  requestId: crypto.randomUUID(),
  // Optional scene coordinates for a ripple.
  // target: { x: 200, y: 300 },
}, { destination: "ALL" });
```

The host is the first connected GM ordered by player ID and connection ID. That GM needs Motif enabled. GMs can trigger all cues. Players can trigger custom effects whose “Players can trigger this effect” setting is enabled. Use the visible cue ID in the library for an integration. Built-in IDs are `lantern-room`, `threshold`, `spell-chime`, and `low-impact`.

Embers is the reference for the tool and library workflow. Motif uses its own source, sound assets, room metadata and broadcast channels.
