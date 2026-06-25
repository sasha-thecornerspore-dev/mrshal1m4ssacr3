# ★MARSH‼★ — backend deploy (Cloudflare Worker + KV)

This wires the community board, accounts, moderation, and config to a real shared
server so everyone sees the same thing — instead of each browser keeping its own copy.

**It's free.** Cloudflare's free tier (100k Worker requests/day + a generous KV
allowance) is far more than a fan board will ever use. You also get a free
`*.workers.dev` URL — no domain purchase needed.

The site keeps working **before** you do any of this: with no server URL set,
`marsh-backend.js` runs in local-only mode (the old behaviour, single browser).

---

## 1. Install Wrangler (one time)

> **Windows:** run these in **Command Prompt** or **PowerShell** (not bash) —
> the commands are exactly the same, just hit Enter in your normal terminal.
> Install [Node.js](https://nodejs.org) first if you don't have it (that gives
> you `npm`). After `npm install -g`, close and reopen the terminal so `wrangler`
> is found.

```bash
npm install -g wrangler
wrangler login          # opens the browser, authorizes your Cloudflare account
```
(No Cloudflare account yet? Make one free at dash.cloudflare.com first.)

## 2. Create the KV namespace

```bash
wrangler kv namespace create MARSH_KV
```
Copy the `id = "…"` it prints and paste it into **wrangler.toml** where it says
`PASTE_KV_NAMESPACE_ID_HERE`.

## 3. Deploy the Worker

```bash
wrangler deploy
```
Wrangler prints your live URL, e.g. `https://marsh.<your-subdomain>.workers.dev`.
On first request the Worker seeds the same starter data (owner `marsh` / mod
`voidkitten` / user `sk8rat`) the site shipped with.

## 4. Point the site at it

Open **marsh-backend.js**, find the line near the top:

```js
var SERVER = (window.MARSH_SERVER || '').replace(/\/+$/, '');
```

Set your URL one of two ways:

- **Quick:** change that line to
  `var SERVER = (window.MARSH_SERVER || 'https://marsh.<you>.workers.dev').replace(/\/+$/, '');`
- **Cleaner:** leave the file alone and add this *before* the `marsh-backend.js`
  `<script>` tag on each page:
  `<script>window.MARSH_SERVER='https://marsh.<you>.workers.dev';</script>`

Reload the site. It now reads from and writes to the Worker; open it in two
different browsers and you'll see the same board.

## 5. Lock down the owner account ‼

The seed owner login is **marsh / marsh** — change it. (Right now there's no
"change password" screen, so the simplest path: log in, then in the Cloudflare
dashboard → Workers & Pages → KV → your namespace, you can inspect the `db` key.
Or tell me and I'll add a password-change endpoint.)

---

## How it behaves (awaited auth/post + synced reads)

- **Reads** come from a local mirror, so pages render instantly.
- **Login / signup / posting** wait for the server and show the *real* result —
  a wrong password just shows "wrong username or password", no logged-in flicker.
  The buttons show "… working" briefly while the request is in flight.
- **Moderation & config changes** apply immediately on screen, then sync in the
  background and reconcile with the server's authoritative result.
- **Other people's changes** show up within a few seconds (the client polls
  `/state`, and on window focus).
- **Passwords** are hashed server-side with PBKDF2 and never sent to other
  clients. Sessions are opaque bearer tokens kept in the Worker.

### Limits / notes
- Whole DB is one KV document with last-write-wins — perfect for a fan board,
  not built for thousands of simultaneous writers.
- Uploaded images are stored inline (base64) in posts; KV values cap at 25 MB,
  so the board stays comfortably small. If it ever grows huge, move images to R2.
- KV reads are eventually consistent (a write can take a few seconds to be
  globally visible) — that's why a fresh post may "settle" after a second.

## Endpoints (reference)
- `GET  /state` → public snapshot (no password hashes, no tokens)
- `POST /auth/signup` `{username,password}` → `{token,user}`
- `POST /auth/login`  `{username,password}` → `{token,user}`
- `POST /auth/logout` (Bearer token)
- `POST /mutate` `{op,args}` (Bearer token) → applies one moderated action
