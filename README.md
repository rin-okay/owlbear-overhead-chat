# Overhead Chat for Owlbear Rodeo

Select a character, choose **Set as avatar** in the selection menu, and type into the Overhead Chat panel. Press Enter or click Send. Each character gets one speech bubble at a time. A new line replaces the previous one and stays up for six seconds. The extension displays bubbles for other players even while their chat panels are closed.

## Install for your group

1. Unzip the download. The folder containing `manifest.json` is the site to publish. There is no build step. The extension loads Owlbear Rodeo SDK 3.1.0 from jsDelivr.
2. Open [Netlify Drop](https://app.netlify.com/drop) and drop that folder. You can also use any static HTTPS host. Place the files at the site root, since the manifest uses root-relative paths.
3. Open the deployed site's `/manifest.json` URL. For example, `https://your-site.netlify.app/manifest.json`. It should show the Overhead Chat manifest.
4. In your [Owlbear Rodeo profile](https://www.owlbear.rodeo/profile), choose **Add Extension** and paste that URL. Enable Overhead Chat from the room’s **Extensions** menu and reload any open room tabs. The GM enables it for the room and players join that room normally.
5. Open a scene and click a placed image on the **Character** layer. Find **Set as avatar** in the selected token's menu. After picking an avatar, use the speech-bubble icon near the top left to reopen chat.

Players need **Update** enabled for characters in the room's Player Permissions. If the GM also enables **Owner Only**, players must own their token. The GM can assign it using the token's **Owner** menu. Players can speak through unlocked characters they have permission to update. The GM can speak through visible character tokens.

## Test locally

With Python 3 installed, run this inside the folder containing `manifest.json`.

```sh
python3 -m http.server 5173 --bind 127.0.0.1
```

Add `http://localhost:5173/manifest.json` to your Owlbear Rodeo profile using the same steps. Use a shared HTTPS address to test with players on other devices.

Try two messages in quick succession, then move the token and confirm the latest bubble stays attached and disappears. Repeat from a player account with Owner Only enabled to check the ownership filter.

The extension sends public room speech. Use it for tokens the room is meant to see. Fog is not a privacy boundary for broadcasts. The transcript runs in memory for the current room tab. Closing the chat panel keeps the transcript, and reloading the room starts a new one. Avatar selection is remembered for this room in the same browser. This release has no Discord connection.

[Owlbear Rodeo's extension installation guide](https://docs.owlbear.rodeo/extensions/tutorial-hello-world/install-your-extension/) · [Owlbear Rodeo's player permissions guide](https://docs.owlbear.rodeo/docs/permissions/)
