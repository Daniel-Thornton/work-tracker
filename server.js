'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT        = 8789;
const OLLAMA_URL   = 'http://localhost:11434';
const NOTES_FILE   = path.join(__dirname, 'notes.json');

// ── Persistence ──

function loadNotes() {
    try { return JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8')); }
    catch { return []; }
}

function saveNotes(notes) {
    fs.writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2), 'utf8');
}

// ── Helpers ──

const CORS_HEADERS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400'
};

function json(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(); } });
        req.on('error', reject);
    });
}

function ollamaChat(body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const opts = {
            hostname: 'localhost',
            port: 11434,
            path: '/api/chat',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };
        const req = http.request(opts, ollamaRes => {
            const chunks = [];
            ollamaRes.on('data', c => chunks.push(c));
            ollamaRes.on('end', () => {
                try {
                    resolve({ status: ollamaRes.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) });
                } catch {
                    reject(new Error('Invalid JSON from Ollama'));
                }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

// ── Notes → LLM context ──

function buildNotesContext(notes) {
    if (!notes.length) return 'No notes have been recorded yet.';
    return notes
        .map(n => `[${n.date} ${n.time}] ${n.title}\n${n.body}`)
        .join('\n\n---\n\n');
}

function buildSystemPrompt(notes) {
    return `You are a helpful assistant with access to the user's work notes. These are personal notes about people and projects at work, each timestamped with the date and time they were written.

Answer questions using ONLY the notes below. When relevant, mention the date(s) the information comes from. If the notes don't contain an answer, say so plainly instead of guessing.

NOTES:
${buildNotesContext(notes)}`;
}

// ── Notes-aware chat endpoint ──

async function handleNotesChat(req, res) {
    let body;
    try { body = await readBody(req); }
    catch { return json(res, 400, { error: 'Invalid JSON body.' }); }

    const { model, messages } = body;
    if (!model || !Array.isArray(messages)) return json(res, 400, { error: 'Missing model or messages.' });

    const notes = loadNotes();
    const fullMessages = [{ role: 'system', content: buildSystemPrompt(notes) }, ...messages];

    let result;
    try {
        result = await ollamaChat({ model, messages: fullMessages, stream: false });
    } catch {
        return json(res, 502, { error: 'Ollama is not reachable on this PC.' });
    }

    json(res, result.status, result.data);
}

// ── Ollama proxy (used for raw /api/* calls, e.g. checking models) ──

function proxyToOllama(req, res) {
    const ollamaUrl = new URL(req.url, OLLAMA_URL);
    const options = {
        hostname: ollamaUrl.hostname,
        port:     Number(ollamaUrl.port) || 11434,
        path:     ollamaUrl.pathname + (ollamaUrl.search || ''),
        method:   req.method,
        headers:  { ...req.headers, host: ollamaUrl.host }
    };

    const proxy = http.request(options, ollamaRes => {
        const headers = Object.fromEntries(
            Object.entries(ollamaRes.headers).filter(([k]) => !k.toLowerCase().startsWith('access-control-'))
        );
        res.writeHead(ollamaRes.statusCode, { ...headers, ...CORS_HEADERS });
        ollamaRes.pipe(res);
    });

    proxy.on('error', () => json(res, 502, { error: 'Ollama is not reachable on this PC.' }));
    req.pipe(proxy);
}

// ── Router ──

const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');

    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
    }

    // Notes-aware chat
    if (pathname === '/api/notes-chat' && req.method === 'POST') {
        await handleNotesChat(req, res);
        return;
    }

    // Raw Ollama proxy (e.g. /api/tags to list models)
    if (pathname.startsWith('/api/')) {
        proxyToOllama(req, res);
        return;
    }

    // GET /notes — full list
    if (pathname === '/notes' && req.method === 'GET') {
        json(res, 200, loadNotes());
        return;
    }

    // PUT /notes — replace entire list (import)
    if (pathname === '/notes' && req.method === 'PUT') {
        try {
            const data = await readBody(req);
            if (!Array.isArray(data)) throw new Error();
            saveNotes(data);
            json(res, 200, { ok: true });
        } catch {
            json(res, 400, { error: 'Invalid notes data.' });
        }
        return;
    }

    // POST /notes — add a note { title, body }
    if (pathname === '/notes' && req.method === 'POST') {
        try {
            const { title, body } = await readBody(req);
            if (!title || !body) throw new Error();
            const now = new Date();
            const entry = {
                id:    Date.now(),
                date:  now.toISOString().slice(0, 10),
                time:  now.toTimeString().slice(0, 5),
                title,
                body
            };
            const notes = loadNotes();
            notes.push(entry);
            saveNotes(notes);
            json(res, 200, entry);
        } catch {
            json(res, 400, { error: 'Invalid request body.' });
        }
        return;
    }

    // DELETE /notes/:id — remove a note
    const del = pathname.match(/^\/notes\/(\d+)$/);
    if (del && req.method === 'DELETE') {
        const id = Number(del[1]);
        const notes = loadNotes().filter(n => n.id !== id);
        saveNotes(notes);
        json(res, 200, { ok: true });
        return;
    }

    res.writeHead(404, CORS_HEADERS);
    res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log('  Work Tracker server running');
    console.log(`  Listening on http://localhost:${PORT}`);
    console.log(`  Notes file: ${NOTES_FILE}`);
    console.log('');
    console.log('  Point your Cloudflare tunnel at:');
    console.log(`  http://localhost:${PORT}`);
    console.log('');
});
