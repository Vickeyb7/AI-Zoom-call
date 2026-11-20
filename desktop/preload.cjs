const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopHud', {
  isElectron: true,
  setContentProtection: (enabled) => ipcRenderer.invoke('hud:set-content-protection', Boolean(enabled)),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('hud:set-always-on-top', Boolean(enabled)),
  getWindowState: () => ipcRenderer.invoke('hud:get-state'),
  getDisplays: () => ipcRenderer.invoke('hud:get-displays'),
  moveToDisplay: (displayId, corner = 'bottom-right') =>
    ipcRenderer.invoke('hud:move-to-display', displayId, corner),
  hideHud: () => ipcRenderer.invoke('hud:hide'),
  openFullWorkspace: (url) => ipcRenderer.invoke('hud:open-full-workspace', url),
  onWindowStateChange: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('hud:state-changed', listener);
    return () => ipcRenderer.removeListener('hud:state-changed', listener);
  },
});
