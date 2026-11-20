const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  session,
  shell,
} = require('electron');
const path = require('path');

function resolveBaseServerUrl() {
  const cliArg = process.argv.find((a) => a.startsWith('--url='));
  const raw =
    (cliArg ? cliArg.slice('--url='.length) : '') ||
    process.env.COPILOT_SERVER_URL ||
    'http://localhost:3000';
  return raw.replace(/\/+$/, '');
}

const BASE_SERVER_URL = resolveBaseServerUrl();
const HUD_URL = `${BASE_SERVER_URL}/?mode=desktop-hud`;

let hudWindow = null;
let tray = null;
let hudState = {
  alwaysOnTop: true,
  contentProtection: true,
};

function createTrayIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
    <rect x="1" y="1" width="16" height="16" rx="4" fill="#4F46E5"/>
    <path d="M9 4.2l1.2 3.1L13.5 8.5l-3.3 1.2L9 13l-1.2-3.3L4.5 8.5l3.3-1.2z" fill="#FFFFFF"/>
  </svg>`;
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
  );
}

function broadcastState() {
  if (hudWindow && !hudWindow.isDestroyed()) {
    hudWindow.webContents.send('hud:state-changed', hudState);
  }
  refreshTrayMenu();
}

function positionCorner(win, corner = 'bottom-right') {
  const workArea = screen.getPrimaryDisplay().workArea;
  const [winWidth, winHeight] = win.getSize();
  const margin = 16;
  const x = corner.endsWith('left')
    ? workArea.x + margin
    : Math.max(workArea.x + margin, workArea.x + workArea.width - winWidth - margin);
  const y = corner.startsWith('top')
    ? workArea.y + margin
    : Math.max(workArea.y + margin, workArea.y + workArea.height - winHeight - margin);
  win.setPosition(x, y);
}

function applyWindowFlags(win) {
  win.setAlwaysOnTop(hudState.alwaysOnTop, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setContentProtection(hudState.contentProtection);
}

function createHudWindow() {
  const width = 350;
  const height = 430;

  hudWindow = new BrowserWindow({
    width,
    height,
    minWidth: 320,
    minHeight: 360,
    frame: false,
    resizable: true,
    alwaysOnTop: hudState.alwaysOnTop,
    backgroundColor: '#0F172A',
    title: 'AI Sales Strategist HUD',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  positionCorner(hudWindow, 'bottom-right');
  applyWindowFlags(hudWindow);
  hudWindow.loadURL(HUD_URL);

  hudWindow.webContents.on('did-fail-load', () => {
    const fallbackHtml = `
      <html>
        <body style="margin:0;padding:24px;background:#0F172A;color:#E2E8F0;font-family:system-ui,sans-serif;">
          <h3 style="margin:0 0 8px 0;font-size:15px;">Cannot reach AI Sales Strategist server</h3>
          <p style="font-size:12px;color:#94A3B8;line-height:1.5;">
            Start the backend server or set <code>COPILOT_SERVER_URL</code> to your hosted app URL.<br/>
            Target: <code>${HUD_URL}</code>
          </p>
        </body>
      </html>`;
    hudWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fallbackHtml)}`);
  });

  hudWindow.on('closed', () => {
    hudWindow = null;
  });
}

function toggleHudVisibility() {
  if (!hudWindow) {
    createHudWindow();
    return;
  }
  if (hudWindow.isVisible()) {
    hudWindow.hide();
  } else {
    hudWindow.show();
    applyWindowFlags(hudWindow);
  }
}

function refreshTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: hudWindow && hudWindow.isVisible() ? 'Hide Copilot HUD (Cmd/Ctrl+Shift+Space)' : 'Show Copilot HUD (Cmd/Ctrl+Shift+Space)',
      click: toggleHudVisibility,
    },
    {
      label: 'Screen-Share Shield (Hide from Zoom Share)',
      type: 'checkbox',
      checked: hudState.contentProtection,
      click: (item) => {
        hudState.contentProtection = item.checked;
        if (hudWindow) hudWindow.setContentProtection(item.checked);
        broadcastState();
      },
    },
    {
      label: 'Always on Top over Zoom',
      type: 'checkbox',
      checked: hudState.alwaysOnTop,
      click: (item) => {
        hudState.alwaysOnTop = item.checked;
        if (hudWindow) hudWindow.setAlwaysOnTop(item.checked, 'floating');
        broadcastState();
      },
    },
    { type: 'separator' },
    {
      label: 'Snap to Bottom-Right Corner',
      click: () => {
        if (hudWindow) {
          hudWindow.show();
          positionCorner(hudWindow, 'bottom-right');
        }
      },
    },
    {
      label: 'Snap to Top-Right Corner',
      click: () => {
        if (hudWindow) {
          hudWindow.show();
          positionCorner(hudWindow, 'top-right');
        }
      },
    },
    {
      label: 'Open Full Web Workspace',
      click: () => {
        shell.openExternal(BASE_SERVER_URL);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit AI Sales Strategist HUD',
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(menu);
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture' || permission === 'audioCapture');
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      if (sources.length > 0) {
        callback({ video: sources[0], audio: 'loopback' });
        return;
      }
    } catch {
      // Fallback below
    }
    callback({});
  });

  createHudWindow();

  tray = new Tray(createTrayIcon());
  tray.setToolTip('AI Sales Strategist — Live Zoom HUD');
  tray.on('click', toggleHudVisibility);
  refreshTrayMenu();

  globalShortcut.register('CommandOrControl+Shift+Space', toggleHudVisibility);

  ipcMain.handle('hud:get-state', () => hudState);
  ipcMain.handle('hud:set-content-protection', (_event, enabled) => {
    hudState.contentProtection = Boolean(enabled);
    if (hudWindow) hudWindow.setContentProtection(hudState.contentProtection);
    broadcastState();
    return hudState;
  });
  ipcMain.handle('hud:set-always-on-top', (_event, enabled) => {
    hudState.alwaysOnTop = Boolean(enabled);
    if (hudWindow) hudWindow.setAlwaysOnTop(hudState.alwaysOnTop, 'floating');
    broadcastState();
    return hudState;
  });
  ipcMain.handle('hud:hide', () => {
    if (hudWindow) hudWindow.hide();
    return true;
  });
  ipcMain.handle('hud:open-full-workspace', (_event, targetUrl) => {
    shell.openExternal(targetUrl || BASE_SERVER_URL);
    return true;
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
