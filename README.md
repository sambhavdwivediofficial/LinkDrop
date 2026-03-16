<div align="center">

<br />

# LINKDROP

### Browser-to-Browser File & Text Sharing

<br />

![License](https://img.shields.io/badge/license-All%20Rights%20Reserved-black?style=flat-square)
![Stack](https://img.shields.io/badge/React%20%2B%20Node.js%20%2B%20WebRTC-white?style=flat-square&labelColor=black)
![P2P](https://img.shields.io/badge/P2P%20Direct%20Transfer-white?style=flat-square&labelColor=black)
![Storage](https://img.shields.io/badge/Zero%20Server%20Storage-white?style=flat-square&labelColor=black)

<br />

</div>

---

## Overview

LinkDrop is a peer-to-peer file and text sharing tool. Files travel **directly** between two browsers using WebRTC — the server never sees, stores, or touches your data. The signaling server exists only to introduce two peers to each other, then steps aside completely.

---

## How It Works

```
Sender's Browser                              Receiver's Browser
       │                                               │
       │         Signaling Server (Socket.io)          │
       │◄──────── peer introduction only ────────────► │
       │                                               │
       └─────────── WebRTC P2P Direct Transfer ────────┘
                    server never sees the file
```

1. Sender selects files or text, sets a password, clicks **Create Link**
2. A unique password-protected link is generated
3. Receiver opens the link and enters the password
4. Content transfers **directly** between browsers — no upload, no cloud, no server

---

## Features

- **Any file type** — `.exe` `.zip` `.mp4` `.iso` `.apk` `.pdf` — zero restrictions
- **Unlimited file size** — only browser memory is the limit
- **Up to 5 files** at once with full folder selection support
- **Text sharing** — send code snippets, notes, or links alongside files
- **Password protected** — every transfer requires a password to access
- **Reload-safe** — received files persist in IndexedDB until downloaded
- **Sender protection** — browser warns before tab close until receiver saves
- **Zero server storage** — nothing is ever written to disk on the server
- **Dead link detection** — invalid or expired links show a 404 instantly
- **Fully responsive** — works on mobile, tablet, and desktop

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      LINKDROP SYSTEM                        │
├──────────────────┬──────────────────┬───────────────────────┤
│   Sender         │ Signaling Server │   Receiver            │
│   Browser        │ (Socket.io)      │   Browser             │
│                  │                  │                       │
│  Files/Text  ──► │ room created     │                       │
│  Password set    │ peer introduced  │ ◄── Link opened       │
│  Link shared ──► │ handshake done   │     Password entered  │
│                  │                  │                       │
│  ◄───────────────────── WebRTC ─────────────────────────►  │
│         Direct P2P — server completely bypassed             │
└─────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite |
| Fonts | IBM Plex Mono + Bebas Neue |
| P2P Transport | Native Browser WebRTC — `RTCPeerConnection` |
| Signaling | Node.js + Express + Socket.io |
| Client Storage | Browser IndexedDB |
| Security | SHA-256 password hashing in-browser |

---

## Project Structure

```
linkdrop/
├── client/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── peer.js          # WebRTC P2P send & receive logic
│   │   │   ├── idb.js           # IndexedDB session persistence
│   │   │   └── icons.jsx        # SVG icon components
│   │   ├── pages/
│   │   │   ├── SharePage.jsx    # Sender interface
│   │   │   └── ReceivePage.jsx  # Receiver interface
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
├── server/
│   ├── server.js                # Signaling server
│   └── package.json
│
├── .gitignore
├── LICENSE
└── README.md
```

---

## Security

- Passwords are hashed with **SHA-256** before leaving the browser — plaintext never transmitted
- The signaling server stores only the hash — never the password itself
- Files never touch the server — pure browser-to-browser transfer
- Each session link is a **UUID v4** — cryptographically unguessable
- Links are live only while the sender's tab is open — no persistent exposure

---

## Author

**Sambhav Dwivedi**
[sambhavdwivedi.in](https://sambhavdwivedi.in)

---

## License

Copyright © 2025 Sambhav Dwivedi. All Rights Reserved.

See [LICENSE](./LICENSE) — unauthorized use, copying, or distribution is strictly prohibited.

---

<div align="center">
  <sub>Built with WebRTC · Zero Server Storage · P2P Direct · Password Protected</sub>
</div>