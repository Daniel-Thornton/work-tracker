# Work Tracker

A static web app for logging notes about people and projects at work, with a chat tab that lets a local LLM (via Ollama) answer questions using everything you've written.

Built the same way as the `calorie-logger` example: a static frontend (deployable to GitHub Pages, or just opened locally) talks to a small Node.js server running on your own PC, which stores your data as JSON and proxies requests to a local Ollama model. A Cloudflare quick tunnel lets you reach that PC from anywhere without opening router ports.

---

## How it works

- **Notes tab** — write a Subject and a note, hit Save. Each note is timestamped and appended to `notes.json` on your PC. History is listed below, newest first.
- **Ask tab** — a simple chat. Every message you send is answered by Ollama with *all* your notes injected as context, so you can ask things like "When was Rebecca working in Unreal?" and get an answer plus the date it happened.

Nothing is sent to any third party — only to your own Ollama instance.

---

## One-time setup

### 1. Install Node.js and Ollama on the PC that will store your data

```powershell
ollama pull llama3.2
```

### 2. Install cloudflared on that PC

Download from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

No account needed for quick tunnels — just make sure `cloudflared-windows-amd64.exe` is in this same folder (or on PATH) as `start-tunnel.ps1`.

### 3. (Optional) Deploy the frontend

You can just open `index.html` locally, or push these files to a GitHub repo and enable GitHub Pages (Settings → Pages → Source → `main`, root folder).

---

## Using the app

1. On the PC holding your notes, run `start-tunnel.ps1` (right-click → Run with PowerShell). After a few seconds you'll see a URL like:
   ```
   https://xxxx-xxxx-xxxx.trycloudflare.com
   ```
2. In the app, tap the gear icon and paste that URL into **Cloudflare Tunnel URL**. Save.
3. Write notes on the Notes tab, ask questions on the Ask tab.

The tunnel URL changes each time you restart the script — repeat step 2 when it does. That PC needs to stay on and the script needs to keep running for the app to work remotely.

To skip the tunnel when you're on the same machine/network, set the Tunnel URL to `http://localhost:8789` instead (still requires `server.js` to be running).

---

## Data

Notes are stored in `notes.json` next to `server.js`, and cached in the browser's `localStorage` for offline viewing. Use the Settings modal to download/upload a JSON backup.

## A note on scale

The chat feature currently sends your *entire* notes history to the model as context on every question. This is fine for a personal note archive of normal size, but if it grows very large you may hit the model's context window — worth revisiting (e.g. only sending recent/matching notes) if that happens.
