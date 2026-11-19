'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { KrzSqliteStore } = require('./db-sqlite');

// Enforce Single-Station (One Till / Single Instance Lock)
const gotSingleStationLock = app.requestSingleInstanceLock();
if (!gotSingleStationLock) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let sqliteStore = null;

function resolveSqlitePath() {
  // When packaged into an .exe (app.asar), store the SQLite file in a writable folder:
  // Prefer the portable executable folder if writable, otherwise %APPDATA%\krz-print-pos
  if (app.isPackaged) {
    const exeDir = path.dirname(process.execPath);
    try {
      fs.accessSync(exeDir, fs.constants.W_OK);
      const portableDb = path.join(exeDir, 'krz_print_pos.sqlite');
      // Test write access when running as portable
      if (process.env.PORTABLE_EXECUTABLE_DIR) {
        return path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'krz_print_pos.sqlite');
      }
      if (fs.existsSync(portableDb)) return portableDb;
    } catch {}
    const userDir = app.getPath('userData');
    fs.mkdirSync(userDir, { recursive: true });
    return path.join(userDir, 'krz_print_pos.sqlite');
  }
  return path.join(__dirname, 'krz_print_pos.sqlite');
}

function getSqliteStore() {
  if (!sqliteStore) {
    sqliteStore = new KrzSqliteStore(resolveSqlitePath());
  }
  return sqliteStore;
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

ipcMain.on('krz:load-data', (event) => {
  try {
    const state = getSqliteStore().loadState();
    event.returnValue = state ? JSON.stringify(state) : null;
  } catch (err) {
    console.error('Failed to read SQLite database:', err);
    event.returnValue = null;
  }
});

ipcMain.on('krz:save-data', (_event, jsonStr) => {
  try {
    const data = JSON.parse(String(jsonStr || '{}'));
    getSqliteStore().saveState(data);
  } catch (err) {
    console.error('Failed to write SQLite database:', err);
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    title: 'KRZ PRINT POS · Single Station (SQLite)',
    icon: path.join(__dirname, 'icon-512.png'),
    autoHideMenuBar: true,
    backgroundColor: '#f2f6fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 460,
      height: 700,
      autoHideMenuBar: true,
      icon: path.join(__dirname, 'icon-512.png')
    }
  }));

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
