const { app, BrowserWindow, ipcMain, shell } = require('electron');
const argv = require('yargs-parser')(process.argv.slice(1));
const path = require('path');
const url = require('url');
const fs = require('fs');
const mkdirp = require('mkdirp');
const settings = require('electron-settings');

const createMenu = require('./libs/createMenu');
const windowStateKeeper = require('./libs/windowStateKeeper');
const checkForUpdate = require('./libs/checkForUpdate');
const setProtocols = require('./libs/setProtocols');
const registerFiltering = require('./libs/adblock/registerFiltering');
const clearBrowsingData = require('./libs/clearBrowsingData');

const getAllAppPath = require('./libs/appManagement/getAllAppPath');
const getServerUrl = require('./libs/appManagement/getServerUrl');

const scanInstalledAsync = require('./libs/appManagement/scanInstalledAsync');
const openApp = require('./libs/appManagement/openApp');
const installAppAsync = require('./libs/appManagement/installAppAsync');
const uninstallAppAsync = require('./libs/appManagement/uninstallAppAsync');

const isShell = argv.url !== undefined && argv.id !== undefined;
const isDevelopment = argv.development === 'true';
const isTesting = argv.testing === 'true';

setProtocols();

// for Netflix
if (isShell) {
  const widewine = require('electron-widevinecdm');
  // only need DRM in webview
  widewine.load(app);
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;

const createWindow = () => {
  if (!isShell) {
    // ensure app folder exists
    const allAppPath = getAllAppPath();
    if (!fs.existsSync(allAppPath)) {
      mkdirp.sync(allAppPath);
    }

    ipcMain.on('sign-in', () => {
      let authWindow = new BrowserWindow({
        width: 420,
        height: 492,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          sandbox: true,
          partition: `jwt-${Date.now()}`,
        },
      });
      const authUrl = getServerUrl('/auth/google?jwt=1');
      authWindow.loadURL(authUrl);
      authWindow.show();

      // Handle the response
      authWindow.webContents.on('did-stop-loading', () => {
        if (/^.*(auth\/google\/callback\?code=).*$/.exec(authWindow.webContents.getURL())) {
          mainWindow.webContents.send('token', authWindow.webContents.getTitle());
          authWindow.destroy();
        }
      });

      // Reset the authWindow on close
      authWindow.on('close', () => {
        authWindow = null;
      }, false);
    });

    ipcMain.on('open-app', (e, id, name) => {
      openApp(id, name);
    });

    ipcMain.on('scan-installed-apps', () => {
      scanInstalledAsync()
        .then((installedApps) => {
          installedApps.forEach((installedApp) => {
            mainWindow.webContents.send('app-status', installedApp.id, 'INSTALLED', installedApp);
          });
        })
        .catch(err => mainWindow.webContents.send('log', err));
    });

    ipcMain.on('install-app', (e, id, token) => {
      mainWindow.webContents.send('app-status', id, 'INSTALLING');

      installAppAsync(id, token)
        .then(appObj => mainWindow.webContents.send('app-status', id, 'INSTALLED', appObj))
        .catch(() => mainWindow.webContents.send('app-status', id, null));
    });

    ipcMain.on('uninstall-app', (e, id, name, token) => {
      mainWindow.webContents.send('app-status', id, 'UNINSTALLING');

      uninstallAppAsync(id, token)
        .then(() => mainWindow.webContents.send('app-status', id, null))
        .catch(() => mainWindow.webContents.send('app-status', id, 'INSTALLED'));
    });
  }

  ipcMain.on('set-setting', (e, name, val) => {
    settings.set(name, val);
  });

  ipcMain.on('get-setting', (e, name, defaultVal) => {
    mainWindow.webContents.send('setting', name, settings.get(name, defaultVal));
  });

  ipcMain.on('open-in-browser', (e, browserUrl) => {
    shell.openExternal(browserUrl);
  });

  ipcMain.on('set-title', (e, title) => {
    mainWindow.setTitle(title);
  });

  const mainWindowState = windowStateKeeper({
    id: isShell ? argv.id : 'webcatalog',
    defaultWidth: isShell ? 1280 : 800,
    defaultHeight: isShell ? 800 : 600,
  });

  const options = {
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 500,
    minHeight: 400,
    title: argv.name || 'WebCatalog',
    titleBarStyle: (process.platform === 'darwin') ? 'hidden' : 'default',
    frame: true,
    icon: process.platform === 'linux' ? `~/.icons/webcatalog/${argv.id}.png` : null,
  };

  mainWindow = new BrowserWindow(options);

  mainWindowState.manage(mainWindow);

  if (isShell) {
    ipcMain.on('get-shell-info', () => {
      mainWindow.webContents.send('shell-info', {
        id: argv.id,
        name: argv.name,
        url: argv.url,
        userAgent: mainWindow.webContents.getUserAgent().replace(`Electron/${process.versions.electron}`, ''), // make browser think SSB is a browser
        isTesting,
        isDevelopment,
      });
    });

    /* Badge count */
    // support macos
    const setDockBadge = (process.platform === 'darwin') ? app.dock.setBadge : () => {};

    ipcMain.on('badge', (e, badge) => {
      setDockBadge(badge);
    });

    ipcMain.on('clear-browsing-data', () => {
      clearBrowsingData({ appName: argv.name, appId: argv.id });
    });

    const blockAds = settings.get(`behaviors.${argv.id}.blockAds`, false);
    if (blockAds) {
      registerFiltering(argv.id);
    }

    const swipeToNavigate = settings.get(`behaviors.${argv.id}.swipeToNavigate`, true);
    if (swipeToNavigate) {
      mainWindow.on('swipe', (e, direction) => {
        if (direction === 'left') {
          mainWindow.webContents.send('go-back');
        } else if (direction === 'right') {
          mainWindow.webContents.send('go-forward');
        }
      });
    }

    mainWindow.on('focus', () => {
      mainWindow.webContents.send('focus');
    });
  }
  // setup update checking
  checkForUpdate({ mainWindow, isDevelopment, isTesting });

  // Emitted when the close button is clicked.
  mainWindow.on('close', (e) => {
    // keep window running when close button is hit except when quit on last window is turned on
    if (isShell && process.platform === 'darwin' && !mainWindow.forceClose) {
      const quitOnLastWindow = settings.get(`behaviors.${argv.id}.quitOnLastWindow`, true);
      if (!quitOnLastWindow) {
        e.preventDefault();
        mainWindow.hide();
        return;
      }
    }
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });

  // create menu
  if (!(isDevelopment && !isShell)) {
    createMenu({
      isDevelopment,
      isShell,
      appName: argv.name || 'WebCatalog',
      appId: argv.id,
    });
  }

  // load window
  const windowUrl = url.format({
    pathname: path.join(__dirname, 'www', isShell ? 'shell.html' : 'store.html'),
    protocol: 'file:',
    slashes: true,
  });

  mainWindow.loadURL(windowUrl);
};

app.on('ready', createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  } else if (isShell) {
    const quitOnLastWindow = settings.get(`behaviors.${argv.id}.quitOnLastWindow`, false);
    if (quitOnLastWindow) {
      app.quit();
    }
  }
});

app.on('before-quit', () => {
  // https://github.com/atom/electron/issues/444#issuecomment-76492576
  if (mainWindow) {
    mainWindow.forceClose = true;
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow) {
    mainWindow.show();
  } else {
    createWindow();
  }
});