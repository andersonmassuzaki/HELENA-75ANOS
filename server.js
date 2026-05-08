const http = require('http');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const PORT = process.env.PORT || 8080;
const MEDIA_DIR = path.join(__dirname, 'FOTOS E VIDEOS');

// Inicializa Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY.replace(/\n/g, '\\n'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const MIME_TYPES = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript'
};

async function loadMetadata() {
    const snap = await db.collection('metadata').get();
    const meta = {};
    snap.forEach(doc => { meta[doc.id] = doc.data(); });
    return meta;
}

async function saveItem(filename, data) {
    await db.collection('metadata').doc(filename).set(data, { merge: true });
}

async function getMediaList() {
    const meta = await loadMetadata();
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
                files.push({ id: `p-${f}`, filename: f, type: 'image', url: `/media/${encodeURIComponent(f)}`, order: m.order || null, notes: m.notes || '' });
            } else if (subPath === 'video' && VIDEO_EXTS.has(ext)) {
                const m = meta[f] || { order: null, notes: '' };
                if (m.deleted) continue;
                files.push({ id: `v-${f}`, filename: f, type: 'video', url: `/media/${encodeURIComponent(f)}`, order: m.order || null, notes: m.notes || '' });
            }
        }
        return files;
    }

    items.push(...scan('FOTOS', 'image'));
    items.push(...scan('VIDEOS', 'video'));
    return items;
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;

    try {
        // API: lista de mídias
        if (p === '/api/media') {
            const list = await getMediaList();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(list));
            return;
        }

        // API: salvar metadados de um item
        if (p.startsWith('/api/save/') && req.method === 'POST') {
            const filename = decodeURIComponent(p.split('/api/save/')[1]);
            let body = '';
            req.on('data', c => body += c);
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body);
                    await saveItem(filename, { order: data.order, notes: data.notes });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true }));
                } catch { res.writeHead(400); res.end('erro'); }
            });
            return;
        }

        // API: enviar aprovação — salva todos os itens de uma vez
        if (p === '/api/submit' && req.method === 'POST') {
            let body = '';
            req.on('data', c => body += c);
            req.on('end', async () => {
                try {
                    const items = JSON.parse(body);
                    // Apaga tudo antes de salvar o novo estado
                    const snap = await db.collection('metadata').get();
                    const batch = db.batch();
                    snap.forEach(doc => batch.delete(doc.ref));
                    await batch.commit();
                    // Salva cada item
                    for (const item of items) {
                        await saveItem(item.filename, {
                            order: item.order || null,
                            notes: item.notes || '',
                            deleted: item.deleted || false
                        });
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true }));
                } catch (err) { res.writeHead(400); res.end('erro'); }
            });
            return;
        }

        // API: recomeçar — apaga todos os metadados do Firestore
        if (p === '/api/reset' && req.method === 'POST') {
            const snap = await db.collection('metadata').get();
            const batch = db.batch();
            snap.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        // Servir mídia
        if (p.startsWith('/media/')) {
            const filename = decodeURIComponent(p.replace('/media/', ''));
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

    } catch (err) {
        console.error(err);
        res.writeHead(500); res.end('Erro interno');
    }
});

server.listen(PORT, () => {
    console.log(`\n Organizador rodando em: http://localhost:${PORT}`);
    console.log(` Abra no navegador para comecar!\n`);
});
