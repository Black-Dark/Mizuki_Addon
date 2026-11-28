# Mizuki Add-on website

This static site contains the title-screen illustration, interactive HUD and container previews, and install instructions for mobile, Windows, and Nintendo Switch via Realms.

To test the download locally, run the repository build, then copy the generated package to the path used by the site.

```powershell
./build.ps1
New-Item -ItemType Directory -Force website/downloads
Copy-Item dist/Chibi-Companions-Mizuki-3.8.0.mcaddon website/downloads/
```

Serve the `website` directory with a static HTTP server. The published site and current download are available at [Mizuki Add-on](https://mizuki-addon.penney846.chatgpt.site/).
