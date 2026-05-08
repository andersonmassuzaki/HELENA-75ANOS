const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const MEDIA_DIR = path.join(__dirname, 'FOTOS E VIDEOS');
const METADATA_FILE = path.join(__dirname, '.media.metadata.json');

const MIME_TYPES = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript'
};

function loadMetadata() {
    try { return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8')); }
    catch { return {}; }
}

function saveMetadata(data) {
    fs.writeFileSync(METADATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function getMediaList() {
    const meta = loadMetadata();
    const items = [];
    const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
    const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov']);

    function scan(folderName, subPath) {
        const dirPath = path.join(MEDIA_DIR, folderName);
        if (!fs.existsSync(dirPath)) return [];
        const files = [];
        for (const f of fs.readdirSync(dirPath)) {
            if (['.DS_Store'].includes(f)) continue;
            const ext = path.extname(f).toLowerCase();
            if (subPath === 'image' && IMAGE_EXTS.has(ext)) {
                const m = meta[f] || { order: null, notes: '' };
                if (m.deleted) continue;
                files.push({ id: `p-${f}`, filename: f, type: 'image', url: `/media/${encodeURIComponent(f)}`, order: m.order, notes: m.notes });
            } else if (subPath === 'video' && VIDEO_EXTS.has(ext)) {
                const m = meta[f] || { order: null, notes: '' };
                if (m.deleted) continue;
                files.push({ id: `v-${f}`, filename: f, type: 'video', url: `/media/${encodeURIComponent(f)}`, order: m.order, notes: m.notes });
            }
        }
        return files;
    }

    items.push(...scan('FOTOS', 'image'));
    items.push(...scan('VIDEOS', 'video'));
    return items;
}

function saveExisting(filename, data) {
    const meta = loadMetadata();
    meta[filename] = { order: data.order, notes: data.notes };
    saveMetadata(meta);
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;

    // API: lista de mídias
    if (p === '/api/media') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getMediaList()));
        return;
    }

    // API: salvar metadados de um item
    if (p.startsWith('/api/save/') && req.method === 'POST') {
        const filename = decodeURIComponent(p.split('/api/save/')[1]);
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            try {
                saveExisting(filename, JSON.parse(body));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            } catch { res.writeHead(400); res.end('erro'); }
        });
        return;
    }

    // API: excluir item (soft delete)
    if (p.startsWith('/api/delete/') && req.method === 'POST') {
        const filename = decodeURIComponent(p.split('/api/delete/')[1]);
        const meta = loadMetadata();
        meta[filename] = { ...(meta[filename] || {}), deleted: true };
        saveMetadata(meta);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    // Servir mídia
    if (p.startsWith('/media/')) {
        const filename = decodeURIComponent(p.replace('/media/', ''));
        // Buscar em ambas pastas
        const folders = ['FOTOS', 'VIDEOS'];
        for (const folder of folders) {
            const filePath = path.join(MEDIA_DIR, folder, filename);
            if (fs.existsSync(filePath)) {
                const ext = path.extname(filePath).toLowerCase();
                res.writeHead(200, {
                    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
                    'Content-Range': 'bytes */' + fs.statSync(filePath).size,
                    'Access-Control-Allow-Origin': '*'
                });
                fs.createReadStream(filePath).pipe(res);
                return;
            }
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Arquivo não encontrado');
        return;
    }

    // Index HTML
    if (p === '/' || p === '/index.html') {
        const htmlPath = path.join(__dirname, 'organizador-midia.html');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        fs.createReadStream(htmlPath).pipe(res);
        return;
    }

    res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
    console.log(`\n Organizador rodando em: http://localhost:${PORT}`);
    console.log(` Abra no navegador para comecar!\n`);
});
