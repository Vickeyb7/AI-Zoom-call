# AI Sales Strategist — Always-On-Top Desktop HUD Wrapper

Lightweight Electron desktop shell that floats a compact, draggable **AI Sales Strategist** recommendation window directly on top of your native **Zoom** (or Meet/Teams) desktop window.

## Key Capabilities
- **Bot-Free Live Audio Listening**: Capture system loopback audio (Prospect on Zoom) + your microphone (Sales Rep) directly from the HUD with no bot joining the meeting.
- **Always-on-Top Floating HUD**: Stays visible above native Zoom calls and full-screen spaces.
- **Screen-Share Shield (`contentProtection`)**: Enabled by default so your private competitor weaknesses and counter-pitches stay invisible to prospects even if you share your entire screen on Zoom.
- **Global Instant Shortcut**: Press `Cmd+Shift+Space` (macOS) or `Ctrl+Shift+Space` (Windows/Linux) to show or hide the HUD mid-call.
- **Real-Time WebSocket Sync**: Connects directly to your running server's `/?mode=desktop-hud` view so every live utterance updates the floating window automatically.

## Running Locally
1. Ensure the main server is running (or point `COPILOT_SERVER_URL` to your deployed cloud app URL):
   ```bash
   cd desktop
   npm install
   npm start
   ```
2. To connect the desktop HUD to your hosted cloud URL instead of `http://localhost:3000`:
   ```bash
   COPILOT_SERVER_URL="https://your-app-url" npm start
   ```
   Or pass `--url=https://your-app-url`.

## Packaging Installers (.dmg / .exe / .AppImage)
```bash
npm run pack:mac    # macOS .dmg & .zip
npm run pack:win    # Windows NSIS installer
npm run pack:linux  # Linux AppImage
```
