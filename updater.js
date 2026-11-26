// ══════════════════════════════════════════════════════════════
// BYOB Journal — Auto Update (electron-updater + GitHub Releases)
// ══════════════════════════════════════════════════════════════
const { app, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

function setupUpdater(getWindow) {
    // Download only after the user clicks "Update"
    autoUpdater.autoDownload = false;

    let downloading = false;

    const send = (status) => {
        const win = getWindow();
        if (win && !win.isDestroyed()) {
            win.webContents.send('update:status', status);
        }
    };

    autoUpdater.on('update-available', (info) => {
        send({ state: 'available', version: info.version, notes: info.releaseNotes });
    });

    autoUpdater.on('download-progress', (progress) => {
        send({ state: 'downloading', percent: Math.round(progress.percent) });
    });

    autoUpdater.on('update-downloaded', () => {
        downloading = false;
        send({ state: 'downloaded' });
    });

    autoUpdater.on('error', (error) => {
        console.error('Update error:', error);
        // A failed background check (e.g. no internet) stays silent
        if (downloading) {
            downloading = false;
            send({ state: 'error' });
        }
    });

    ipcMain.handle('update:check', async () => {
        // Updates work only in the installed app, not with "npm start"
        if (!app.isPackaged) return;
        try {
            await autoUpdater.checkForUpdates();
        } catch (error) {
            console.error('Update check failed:', error);
        }
    });

    ipcMain.handle('update:download', async () => {
        if (downloading) return;
        downloading = true;
        try {
            await autoUpdater.downloadUpdate();
        } catch (error) {
            console.error('Update download failed:', error);
            downloading = false;
            send({ state: 'error' });
        }
    });

    ipcMain.handle('update:install', () => {
        // silent install, then reopen the app
        autoUpdater.quitAndInstall(true, true);
    });
}

module.exports = { setupUpdater };
