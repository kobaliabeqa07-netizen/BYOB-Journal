// ══════════════════════════════════════════════════════════════
// BYOB Journal — Electron Main Process
// Manages the native desktop window lifecycle.
// ══════════════════════════════════════════════════════════════
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const { setupUpdater } = require('./updater');

let mainWindow = null;
let didShowMainWindow = false;

function getWorkspacesRoot() {
    return path.join(app.getPath('documents'), 'BYOB Journal Workspaces');
}

function sanitizeWorkspaceName(name) {
    const cleaned = String(name || '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/g, '');

    const safeName = cleaned || 'Workspace';
    const reservedWindowsName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

    return reservedWindowsName.test(safeName) ? `${safeName} Workspace` : safeName;
}

function sanitizeFileName(name) {
    const cleaned = String(name || '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/g, '');

    return cleaned || 'screenshot';
}

function extensionFromMime(type) {
    const map = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/webp': '.webp',
        'image/gif': '.gif',
        'image/bmp': '.bmp'
    };

    return map[String(type || '').toLowerCase()] || '';
}

function resolveInsideWorkspacesRoot(targetPath) {
    const rootPath = path.resolve(getWorkspacesRoot());
    const resolvedPath = path.resolve(String(targetPath || ''));
    const rootPrefix = rootPath.endsWith(path.sep) ? rootPath : `${rootPath}${path.sep}`;

    if (!resolvedPath.toLowerCase().startsWith(rootPrefix.toLowerCase())) {
        throw new Error('Workspace folder path is outside the workspace root.');
    }

    return { rootPath, resolvedPath };
}

async function createUniqueDirectory(root, baseName) {
    const rootPath = path.resolve(root);
    let suffix = 1;

    while (suffix < 1000) {
        const folderName = suffix === 1 ? baseName : `${baseName} ${suffix}`;
        const folderPath = path.resolve(rootPath, folderName);
        const rootPrefix = rootPath.endsWith(path.sep) ? rootPath : `${rootPath}${path.sep}`;

        if (!folderPath.toLowerCase().startsWith(rootPrefix.toLowerCase())) {
            throw new Error('Workspace folder path is outside the workspace root.');
        }

        try {
            await fs.mkdir(folderPath, { recursive: false });
            return { folderName, folderPath };
        } catch (error) {
            if (!error || error.code !== 'EEXIST') {
                throw error;
            }
            suffix += 1;
        }
    }

    throw new Error('Could not find a free workspace folder name.');
}

async function renameWorkspaceDirectory(oldPath, newBaseName) {
    const { rootPath, resolvedPath } = resolveInsideWorkspacesRoot(oldPath);
    let suffix = 1;

    try {
        const stat = await fs.stat(resolvedPath);
        if (!stat.isDirectory()) {
            throw new Error('Workspace path is not a folder.');
        }
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return createUniqueDirectory(rootPath, newBaseName);
        }
        throw error;
    }

    while (suffix < 1000) {
        const folderName = suffix === 1 ? newBaseName : `${newBaseName} ${suffix}`;
        const nextPath = path.resolve(rootPath, folderName);

        if (nextPath.toLowerCase() === resolvedPath.toLowerCase()) {
            return { folderName, folderPath: resolvedPath };
        }

        try {
            await fs.rename(resolvedPath, nextPath);
            return { folderName, folderPath: nextPath };
        } catch (error) {
            if (!error || error.code !== 'EEXIST') {
                throw error;
            }
            suffix += 1;
        }
    }

    throw new Error('Could not find a free workspace folder name.');
}

async function ensureWorkspaceDirectory(workspace) {
    const root = getWorkspacesRoot();
    await fs.mkdir(root, { recursive: true });

    if (workspace && workspace.folderPath) {
        const { resolvedPath } = resolveInsideWorkspacesRoot(workspace.folderPath);
        await fs.mkdir(resolvedPath, { recursive: true });

        return {
            root,
            folderName: path.basename(resolvedPath),
            folderPath: resolvedPath
        };
    }

    const created = await createUniqueDirectory(root, sanitizeWorkspaceName(workspace && workspace.name));

    return {
        root,
        folderName: created.folderName,
        folderPath: created.folderPath
    };
}

function bufferFromAttachmentData(data) {
    if (!data) {
        return null;
    }

    if (Buffer.isBuffer(data)) {
        return data;
    }

    if (data instanceof ArrayBuffer) {
        return Buffer.from(new Uint8Array(data));
    }

    if (ArrayBuffer.isView(data)) {
        return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }

    if (Array.isArray(data.data)) {
        return Buffer.from(data.data);
    }

    return null;
}

async function saveAttachment(workspace, file) {
    const allowedExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
    const workspaceInfo = await ensureWorkspaceDirectory(workspace);
    const attachmentsDir = path.join(workspaceInfo.folderPath, 'Attachments');

    await fs.mkdir(attachmentsDir, { recursive: true });

    const originalName = sanitizeFileName(file && file.name);
    const originalExt = path.extname(originalName).toLowerCase();
    const ext = allowedExtensions.has(originalExt) ? originalExt : extensionFromMime(file && file.type);

    if (!ext || !allowedExtensions.has(ext)) {
        throw new Error('Only image files can be attached.');
    }

    const baseName = sanitizeFileName(path.basename(originalName, path.extname(originalName))).slice(0, 80) || 'screenshot';
    const storedName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${baseName}${ext}`;
    const destination = path.join(attachmentsDir, storedName);

    if (file && file.path) {
        await fs.copyFile(file.path, destination);
    } else {
        const buffer = bufferFromAttachmentData(file && file.data);
        if (!buffer) {
            throw new Error('Could not read the selected image.');
        }
        await fs.writeFile(destination, buffer);
    }

    const stat = await fs.stat(destination);

    return {
        workspace: workspaceInfo,
        attachment: {
            path: destination,
            url: pathToFileURL(destination).href,
            name: originalName,
            storedName,
            type: file && file.type ? file.type : '',
            size: stat.size,
            createdAt: new Date().toISOString()
        }
    };
}

ipcMain.handle('workspace:create-folder', async (_event, workspace) => {
    const root = getWorkspacesRoot();
    const baseName = sanitizeWorkspaceName(workspace && workspace.name);

    await fs.mkdir(root, { recursive: true });
    const created = await createUniqueDirectory(root, baseName);

    return {
        root,
        folderName: created.folderName,
        path: created.folderPath
    };
});

ipcMain.handle('workspace:rename-folder', async (_event, workspace) => {
    const root = getWorkspacesRoot();
    const baseName = sanitizeWorkspaceName(workspace && workspace.name);

    await fs.mkdir(root, { recursive: true });

    if (!workspace || !workspace.folderPath) {
        const created = await createUniqueDirectory(root, baseName);

        return {
            root,
            folderName: created.folderName,
            path: created.folderPath
        };
    }

    const renamed = await renameWorkspaceDirectory(workspace.folderPath, baseName);

    return {
        root,
        folderName: renamed.folderName,
        path: renamed.folderPath
    };
});

ipcMain.handle('workspace:ensure-folder', async (_event, workspace) => {
    const ensured = await ensureWorkspaceDirectory(workspace);

    return {
        root: ensured.root,
        folderName: ensured.folderName,
        path: ensured.folderPath
    };
});

ipcMain.handle('workspace:save-attachment', async (_event, payload) => {
    return saveAttachment(payload && payload.workspace, payload && payload.file);
});

// Gallery thumbnails: persistent derived cache, no change to original files.
const { createHash } = require('crypto');
const galleryThumbRoot = () => path.join(app.getPath('userData'), 'gallery-thumbnails-v1');
const galleryThumbKey = p => createHash('sha256').update(path.resolve(p)).digest('hex');
async function galleryThumbnail(payload) {
    const { resolvedPath } = resolveInsideWorkspacesRoot(payload && payload.path);
    const [root, source] = await Promise.all([fs.realpath(getWorkspacesRoot()), fs.realpath(resolvedPath)]);
    const rel = path.relative(root, source);
    if (!rel || rel.startsWith('..'+path.sep) || path.isAbsolute(rel) || rel==='..' || path.basename(path.dirname(source)).toLowerCase() !== 'attachments' || !/\.(png|jpe?g|webp|gif|bmp)$/i.test(source)) throw new Error('Invalid attachment path');
    const stat = await fs.stat(source);
    if (!stat.isFile() || stat.size > 5*1024*1024) throw new Error('Invalid attachment size');
    const dir = galleryThumbRoot(), dest = path.join(dir, galleryThumbKey(resolvedPath)+'.png');
    await fs.mkdir(dir,{recursive:true});
    try { const cached=await fs.stat(dest); if(cached.isFile() && cached.mtimeMs>=stat.mtimeMs) return {url:pathToFileURL(dest).href}; } catch (_) {}
    const image = nativeImage.createFromPath(source);
    if (image.isEmpty()) return {url:pathToFileURL(source).href};
    const {width,height}=image.getSize();
    if (!width || !height) throw new Error('Invalid image');
    const scale=Math.min(1,720/width,480/height);
    const thumbnail=scale<1?image.resize({width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale)),quality:'good'}):image;
    const png=thumbnail.toPNG();
    // A deleted or replaced file may disappear while a thumbnail is being generated.
    await fs.access(source);
    await fs.writeFile(dest,png);
    try { await fs.access(source); } catch (err) { await fs.rm(dest,{force:true}); throw err; }
    return {url:pathToFileURL(dest).href};
}
ipcMain.handle('workspace:gallery-thumbnail', (_event,payload)=>galleryThumbnail(payload));

ipcMain.handle('workspace:delete-attachment', async (_event, attachment) => {
    if (!attachment || !attachment.path) {
        return { ok: true };
    }

    const { resolvedPath } = resolveInsideWorkspacesRoot(attachment.path);

    try {
        const stat = await fs.stat(resolvedPath);
        if (stat.isFile()) {
            await fs.unlink(resolvedPath);
        }
    } catch (error) {
        if (!error || error.code !== 'ENOENT') {
            throw error;
        }
    }

    await fs.rm(path.join(galleryThumbRoot(), galleryThumbKey(resolvedPath)+'.png'), {force:true}).catch(err=>console.error('Thumbnail cleanup failed:',err));
    return { ok: true };
});

// Economic Calendar — fixed official weekly export, local cache, no renderer URLs.
const https = require('https');
const NEWS_ENDPOINT = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const newsDay = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(ms);
let newsCache = null, newsLoaded = false, newsPending = null, newsLastAttempt = 0, newsError = '';
function newsFile() { return path.join(app.getPath('userData'), 'economic-calendar-cache.json'); }
function normalizeNews(rows) {
    if (!Array.isArray(rows) || rows.length > 10000) throw new Error('Unexpected calendar format');
    const clean = rows.filter(r => r && typeof r.title === 'string' && typeof r.country === 'string' && /^[A-Z]{3}$/.test(r.country) && typeof r.date === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(r.date) && Number.isFinite(Date.parse(r.date)) && ['High','Medium','Low','Holiday'].includes(r.impact)).map(r => ({title:r.title.slice(0,300),country:r.country,date:new Date(r.date).toISOString(),impact:r.impact,forecast:String(r.forecast ?? '').slice(0,80),previous:String(r.previous ?? '').slice(0,80)}));
    if (rows.length && !clean.length) throw new Error('No valid calendar events');
    return clean.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
}
function requestNews() {
    return new Promise((resolve,reject)=>{
        const req=https.get(NEWS_ENDPOINT,{headers:{Accept:'application/json'}},res=>{
            if(res.statusCode!==200){res.resume(); reject(new Error('Calendar source HTTP '+res.statusCode));return;}
            let size=0; const chunks=[];
            res.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024){req.destroy(new Error('Calendar response too large'));return;}chunks.push(chunk);});
            res.on('error',reject);res.on('aborted',()=>reject(new Error('Calendar response interrupted')));
            res.on('end',()=>{try{resolve(normalizeNews(JSON.parse(Buffer.concat(chunks).toString('utf8'))));}catch(e){reject(e);}});
        });
        const timer=setTimeout(()=>req.destroy(new Error('Calendar request timed out')),12000);
        req.on('close',()=>clearTimeout(timer));req.on('error',reject);
    });
}
async function readNews(force) {
    if(newsPending) return newsPending;
    newsPending=(async()=>{
        if(!newsLoaded){newsLoaded=true;try{const saved=JSON.parse(await fs.readFile(newsFile(),'utf8'));if(Number.isFinite(saved.fetchedAt)&&saved.fetchedAt<=Date.now()){newsCache={fetchedAt:saved.fetchedAt,events:normalizeNews(saved.events)};}}catch(_){} }
        const now=Date.now();
        const needed=(!newsCache||newsDay(newsCache.fetchedAt)!==newsDay(now))&&(!newsLastAttempt||newsDay(newsLastAttempt)!==newsDay(now));
        let cooldown=false;
        if((force||needed)&&(!newsLastAttempt||now-newsLastAttempt>=60000)){
            newsLastAttempt=now;
            try{
                const events=await requestNews();
                newsCache={fetchedAt:Date.now(),events};newsError='';
                try{const file=newsFile();await fs.writeFile(file+'.tmp',JSON.stringify(newsCache),'utf8');await fs.rename(file+'.tmp',file);}catch(e){newsError='Calendar loaded, but offline cache could not be saved.';}
            }catch(e){newsError=String(e.message||'Calendar unavailable').slice(0,200);}
        }else if(force){cooldown=true;}
        return {events:newsCache?.events||[],fetchedAt:newsCache?.fetchedAt||null,error:newsError,cooldown};
    })();
    try{return await newsPending;}finally{newsPending=null;}
}
ipcMain.handle('news:calendar', (event, force) => {
    if(!mainWindow || event.sender!==mainWindow.webContents) throw new Error('Unauthorized calendar request');
    return readNews(force===true);
});

// Window buttons (minimize / maximize / close) follow the app theme
const WINDOW_THEMES = {
    navy:   { background: '#0F1117', overlay: '#131723', symbol: '#A8AFC0' },
    amoled: { background: '#000000', overlay: '#0A0A0C', symbol: '#B4B3B8' }
};

ipcMain.on('theme:set', (_event, name) => {
    if (!mainWindow) return;
    const theme = WINDOW_THEMES[name] || WINDOW_THEMES.navy;
    mainWindow.setBackgroundColor(theme.background);
    if (process.platform !== 'darwin' && mainWindow.setTitleBarOverlay) {
        mainWindow.setTitleBarOverlay({
            color: theme.overlay,
            symbolColor: theme.symbol,
            height: 38
        });
    }
});

function showMainWindow() {
    if (!mainWindow || didShowMainWindow) {
        return;
    }

    didShowMainWindow = true;
    mainWindow.center();
    mainWindow.show();
    mainWindow.focus();
}

function createWindow() {
    didShowMainWindow = false;

    mainWindow = new BrowserWindow({
        width: 1480,
        height: 940,
        minWidth: 1024,
        minHeight: 700,
        backgroundColor: '#0F1117',
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#131723',
            symbolColor: '#A8AFC0',
            height: 38
        },
        autoHideMenuBar: true,
        show: false,
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            spellcheck: false
        }
    });

    mainWindow.loadFile('index.html').catch((error) => {
        console.error('Failed to load index.html:', error);
        showMainWindow();
    });

    // Prevent white flash — show only when content is painted
    mainWindow.once('ready-to-show', showMainWindow);
    mainWindow.webContents.once('did-finish-load', showMainWindow);
    setTimeout(showMainWindow, 3000);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// ── App Lifecycle ────────────────────────────────────────────
app.whenReady().then(() => {
    setupUpdater(() => mainWindow);
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});