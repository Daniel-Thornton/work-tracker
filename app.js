'use strict';

const STORAGE_KEY  = 'worktracker_notes_v1';
const SETTINGS_KEY = 'worktracker_settings_v1';
const CHAT_KEY     = 'worktracker_chat_v1';

// ── DOM references ──

const settingsBtn      = document.getElementById('settings-btn');
const settingsModal    = document.getElementById('settings-modal');
const tunnelUrlInput   = document.getElementById('tunnel-url');
const modelNameInput   = document.getElementById('model-name');
const saveSettingsBtn  = document.getElementById('save-settings');
const closeSettingsBtn = document.getElementById('close-settings');
const cancelSettingsBtn= document.getElementById('cancel-settings');

const errorBanner   = document.getElementById('error-banner');
const noteTitleInput= document.getElementById('note-title');
const noteBodyInput = document.getElementById('note-body');
const saveNoteBtn   = document.getElementById('save-note-btn');
const loadingEl     = document.getElementById('loading');
const noteEntriesEl = document.getElementById('note-entries');

const chatErrorBanner = document.getElementById('chat-error-banner');
const chatMessagesEl  = document.getElementById('chat-messages');
const chatLoadingEl   = document.getElementById('chat-loading');
const chatInput       = document.getElementById('chat-input');
const chatSendBtn     = document.getElementById('chat-send-btn');
const newChatBtn      = document.getElementById('new-chat-btn');

// ── State ──

let settings     = loadSettings();
let chatMessages = loadChat();

// ── Boot ──

async function init() {
    tunnelUrlInput.value = settings.tunnelUrl || '';
    modelNameInput.value = settings.model || 'llama3.2';
    setupEventListeners();
    await refreshNotes();
    renderChat();
}

// ── Settings ──

function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
    catch { return {}; }
}

function persistSettings() {
    settings.tunnelUrl = tunnelUrlInput.value.trim().replace(/\/+$/, '');
    settings.model     = modelNameInput.value.trim() || 'llama3.2';
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function openSettings() {
    tunnelUrlInput.value = settings.tunnelUrl || '';
    modelNameInput.value = settings.model || 'llama3.2';
    settingsModal.classList.remove('hidden');
    tunnelUrlInput.focus();
}

function closeSettings() {
    settingsModal.classList.add('hidden');
}

// ── Event wiring ──

function setupEventListeners() {
    settingsBtn.addEventListener('click', openSettings);
    saveSettingsBtn.addEventListener('click', () => { persistSettings(); closeSettings(); });
    closeSettingsBtn.addEventListener('click', closeSettings);
    cancelSettingsBtn.addEventListener('click', closeSettings);
    settingsModal.addEventListener('click', e => { if (e.target === settingsModal) closeSettings(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });

    document.getElementById('download-notes').addEventListener('click', downloadNotes);
    document.getElementById('upload-notes').addEventListener('change', e => {
        if (e.target.files[0]) uploadNotes(e.target.files[0]);
        e.target.value = '';
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    saveNoteBtn.addEventListener('click', handleSaveNote);
    noteEntriesEl.addEventListener('click', async e => {
        const btn = e.target.closest('.log-delete');
        if (btn) await deleteNoteEntry(Number(btn.dataset.id));
    });

    chatSendBtn.addEventListener('click', handleSendChat);
    chatInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChat(); }
    });
    newChatBtn.addEventListener('click', startNewChat);
}

// ── Tabs ──

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
        b.setAttribute('aria-selected', b.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById(`tab-${tab}`).classList.remove('hidden');
}

// ── Notes data layer ──

async function loadNotes() {
    if (settings.tunnelUrl) {
        try {
            const res = await fetch(`${settings.tunnelUrl}/notes`);
            if (res.ok) {
                const data = await res.json();
                localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
                return data;
            }
        } catch { /* fall through to cache */ }
    }
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { return []; }
}

async function addNote(title, body) {
    let entry;
    if (settings.tunnelUrl) {
        const res = await fetch(`${settings.tunnelUrl}/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body })
        });
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        entry = await res.json();
    } else {
        const now = new Date();
        entry = {
            id: Date.now(),
            date: now.toISOString().slice(0, 10),
            time: now.toTimeString().slice(0, 5),
            title, body
        };
    }

    const notes = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    notes.push(entry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

async function removeNote(id) {
    if (settings.tunnelUrl) {
        await fetch(`${settings.tunnelUrl}/notes/${id}`, { method: 'DELETE' });
    }
    const notes = (JSON.parse(localStorage.getItem(STORAGE_KEY)) || []).filter(n => n.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

// ── Note actions ──

async function handleSaveNote() {
    const title = noteTitleInput.value.trim();
    const body  = noteBodyInput.value.trim();
    if (!title) { showError('Please add a subject line.'); return; }
    if (!body)  { showError('Please write some notes.'); return; }

    clearError();
    setLoading(true);
    try {
        await addNote(title, body);
        noteTitleInput.value = '';
        noteBodyInput.value  = '';
        await refreshNotes();
    } catch (err) {
        showError(err.message);
    } finally {
        setLoading(false);
    }
}

async function deleteNoteEntry(id) {
    await removeNote(id);
    await refreshNotes();
}

// ── Import / Export ──

async function downloadNotes() {
    const notes = await loadNotes();
    const blob = new Blob([JSON.stringify(notes, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `work-notes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}

async function uploadNotes(file) {
    let data;
    try { data = JSON.parse(await file.text()); }
    catch { showError('Could not read file — make sure it is a valid JSON export.'); return; }

    if (!Array.isArray(data)) { showError('Unrecognised format — file must be a notes JSON array.'); return; }

    if (settings.tunnelUrl) {
        const res = await fetch(`${settings.tunnelUrl}/notes`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) { showError('Failed to upload notes to server.'); return; }
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    closeSettings();
    await refreshNotes();
}

// ── Notes view ──

async function refreshNotes() {
    const notes = await loadNotes();
    renderNotes(notes);
}

function renderNotes(notes) {
    if (notes.length === 0) {
        noteEntriesEl.innerHTML = '<p class="empty-log">No notes yet</p>';
        return;
    }

    const sorted = [...notes].sort((a, b) => b.id - a.id);

    noteEntriesEl.innerHTML = sorted.map(entry => `
        <div class="log-entry">
            <div class="log-entry-header">
                <div>
                    <div class="note-entry-title">${escapeHtml(entry.title)}</div>
                    <span class="log-entry-time">${formatShortDate(entry.date)} · ${escapeHtml(entry.time)}</span>
                </div>
                <button class="log-delete" data-id="${entry.id}" aria-label="Delete entry">remove</button>
            </div>
            <p class="note-entry-body">${escapeHtml(entry.body)}</p>
        </div>
    `).join('');
}

// ── Chat ──

function loadChat() {
    try { return JSON.parse(sessionStorage.getItem(CHAT_KEY)) || []; }
    catch { return []; }
}

function persistChat() {
    sessionStorage.setItem(CHAT_KEY, JSON.stringify(chatMessages));
}

function startNewChat() {
    chatMessages = [];
    persistChat();
    clearChatError();
    renderChat();
}

async function handleSendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    if (!settings.tunnelUrl) { showChatError('No tunnel URL set. Open Settings and paste your Cloudflare tunnel URL.'); return; }

    clearChatError();
    chatMessages.push({ role: 'user', content: text });
    chatInput.value = '';
    persistChat();
    renderChat();
    setChatLoading(true);

    try {
        const reply = await callNotesChat(chatMessages);
        chatMessages.push({ role: 'assistant', content: reply });
        persistChat();
        renderChat();
    } catch (err) {
        showChatError(err.message);
    } finally {
        setChatLoading(false);
    }
}

async function callNotesChat(messages) {
    const model = settings.model || 'llama3.2';

    let response;
    try {
        response = await fetch(`${settings.tunnelUrl}/api/notes-chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages })
        });
    } catch {
        throw new Error('Could not reach your home PC. Check that the server is running and the tunnel is active.');
    }

    if (!response.ok) throw new Error(`Ollama error (HTTP ${response.status}). Check the model name in Settings.`);

    const data = await response.json();
    const content = data?.message?.content;
    if (typeof content !== 'string') throw new Error('Unexpected response format from the model.');
    return content;
}

function renderChat() {
    if (chatMessages.length === 0) {
        chatMessagesEl.innerHTML = '<div class="chat-empty">Ask about people or projects from your notes — e.g. "When was Rebecca working in Unreal?"</div>';
        return;
    }

    chatMessagesEl.innerHTML = chatMessages.map(m => `
        <div class="chat-bubble chat-${m.role}">
            <div class="chat-bubble-role">${m.role === 'user' ? 'You' : 'Assistant'}</div>
            <div class="chat-bubble-text">${escapeHtml(m.content)}</div>
        </div>
    `).join('');

    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

// ── Helpers ──

function setLoading(on) {
    loadingEl.classList.toggle('hidden', !on);
    saveNoteBtn.disabled = on;
}

function setChatLoading(on) {
    chatLoadingEl.classList.toggle('hidden', !on);
    chatSendBtn.disabled = on;
    chatInput.disabled = on;
}

function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.classList.remove('hidden');
}

function clearError() {
    errorBanner.textContent = '';
    errorBanner.classList.add('hidden');
}

function showChatError(msg) {
    chatErrorBanner.textContent = msg;
    chatErrorBanner.classList.remove('hidden');
}

function clearChatError() {
    chatErrorBanner.textContent = '';
    chatErrorBanner.classList.add('hidden');
}

function formatShortDate(isoDate) {
    const [y, m, d] = isoDate.split('-');
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Start ──

init();
