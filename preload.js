// ══════════════════════════════════════════════════════════════
// BYOB Journal — Preload Script
// Runs in an isolated context before the renderer page loads.
// Only a small, validated workspace API is exposed to the renderer.
// localStorage is natively available in the renderer context.
// ══════════════════════════════════════════════════════════════
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('byobWorkspace', {
    createFolder: (workspace) => ipcRenderer.invoke('workspace:create-folder', {
        id: workspace && workspace.id,
        name: workspace && workspace.name
    }),
    renameFolder: (workspace) => ipcRenderer.invoke('workspace:rename-folder', {
        id: workspace && workspace.id,
        name: workspace && workspace.name,
        folderPath: workspace && workspace.folderPath
    }),
    ensureFolder: (workspace) => ipcRenderer.invoke('workspace:ensure-folder', {
        id: workspace && workspace.id,
        name: workspace && workspace.name,
        folderPath: workspace && workspace.folderPath
    }),
    saveAttachment: async (workspace, file) => {
        // Convert File/Blob to ArrayBuffer for IPC
        let fileData = file;
        if (file instanceof File || file instanceof Blob) {
            const buffer = await file.arrayBuffer();
            fileData = {
                name: file.name || 'screenshot',
                type: file.type || 'image/png',
                data: buffer,
                size: file.size
            };
        }
        return ipcRenderer.invoke('workspace:save-attachment', {
            workspace: workspace,
            file: fileData
        });
    },
    getGalleryThumbnail: (attachment) => ipcRenderer.invoke('workspace:gallery-thumbnail', {path: attachment && attachment.path}),
    deleteAttachment: (attachment) => ipcRenderer.invoke('workspace:delete-attachment', attachment)
});

contextBridge.exposeInMainWorld('byobNews', { calendar: (force=false) => ipcRenderer.invoke('news:calendar', force===true) });

contextBridge.exposeInMainWorld('byobTheme', {
    set: (name) => ipcRenderer.send('theme:set', name)
});

contextBridge.exposeInMainWorld('byobUpdater', {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (callback) => ipcRenderer.on('update:status', (_event, status) => callback(status))
});

window.addEventListener('DOMContentLoaded', () => {
    // Desktop environment flag
    document.body.setAttribute('data-platform', process.platform);
});