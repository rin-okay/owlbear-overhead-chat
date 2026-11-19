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

The extension sends public room speech. Use it for tokens the room is meant to see. Fog is not a privacy boundary for broadcasts. The transcript runs in memory for the current room tab. Closing the chat panel keeps the transcript, and reloading the room starts a new one. Avatar selection is remembered for this room in the same browser. This release has no Discord connection.

[Owlbear Rodeo's extension installation guide](https://docs.owlbear.rodeo/extensions/tutorial-hello-world/install-your-extension/) · [Owlbear Rodeo's player permissions guide](https://docs.owlbear.rodeo/docs/permissions/)
