# Company Meeting Platform

A role-based meeting scheduling platform with **real live video calls**, built with Express.js, vanilla HTML/CSS/JS, WebRTC + Socket.io, and a JSON file database (no external DB server needed).

## Roles
1. **Super Admin (you)** — the only account seeded manually. Creates Department Admin and Employee accounts for all 5 departments: Operations, Sales & Marketing, Supply Chain & Logistics, Finance, Human Resources. Can view every meeting company-wide (and join any of them).
2. **Department Admin** — one per department. Logs in, sees only their department's employees, and can create/edit/delete meetings, choosing exactly which employees to invite.
3. **Employee** — logs in and sees only the meetings they've been invited to.

## Setup
```bash
npm install
npm run seed      # creates the one super admin account (prints email/password)
npm start          # starts the server on http://localhost:3000
```

Open http://localhost:3000 in your browser and log in with the printed super admin credentials.
Change SUPERADMIN_PASSWORD in seed.js before first run if you want a custom password, or change it manually in the UI later (see "Improvement ideas" below).

## How it works
- `db.json` (in `/data`) stores departments, users (hashed passwords), and meetings — no MySQL/Postgres setup required.
- Sessions are cookie-based via `express-session`.
- Passwords are hashed with bcrypt — never stored in plain text.
- Departments are fixed to the 5 you specified (edit `db.js` defaults to rename/add more).

## 🎥 Real Video Meetings
Meetings are real, live video calls — not just calendar entries.

- A **Join** button appears next to every meeting for the organizer, invited employees, and the super admin (oversight).
- Uses **WebRTC** (peer-to-peer video/audio) with **Socket.io** as the signaling server — no third-party video service required.
- In the room: toggle 🎤 mic and 📷 camera on/off, see everyone's video tile live, and use the built-in 💬 chat panel to send text messages to everyone in the call.
- Access is enforced server-side: only the meeting's creator, invited employees, or the super admin can join — checked both on page load (`GET /api/meetings/:id`) and again when the socket connects (`join-room` event), so people can't guess a meeting link and get in.
- Good for small-to-medium teams (mesh WebRTC — every participant connects directly to every other participant, ideal for up to ~6 people per call). A **TURN relay** is included by default (Open Relay) so calls work across different networks when deployed on Railway; for production scale, set your own TURN credentials (see below).

### Deploying on Railway (video/audio fix)
WebRTC needs more than HTTPS — when users are on different networks, peer-to-peer connections often fail without a **TURN server** (you get black video, no audio, broken screen share).

This project now ships with:
- **ICE candidate queuing** — fixes dropped connections during setup
- **TURN relay fallback** — works out of the box via Open Relay (good for testing)
- **Screen share renegotiation** — remotes actually receive the shared screen track

**Railway environment variables (recommended for production):**
```
NODE_ENV=production
SESSION_SECRET=your-long-random-secret
APP_URL=https://your-app.up.railway.app
TURN_URL=turn:your-turn-server:3478
TURN_USERNAME=your-turn-user
TURN_CREDENTIAL=your-turn-password
```

Free/cheap TURN options: [Metered.ca](https://www.metered.ca/tools/openrelay/) (Open Relay, already used as fallback), [Cloudflare Calls](https://developers.cloudflare.com/calls/), or self-hosted [coturn](https://github.com/coturn/coturn).

After changing env vars, redeploy on Railway, then test with two browsers on **different networks** (e.g. phone hotspot vs home Wi‑Fi).

### Try the video call
1. `npm install` (includes `socket.io`).
2. `npm start`.
3. Log in as two different accounts (in two browser windows, or a normal window + incognito window) that are both invited to the same meeting.
4. Both click **Join** on that meeting — you'll see live video/audio and can chat between them in real time.

## Folder structure
```
meeting-platform/
├── server.js             # Express app + all API routes + Socket.io signaling
├── db.js                 # JSON database setup (lowdb)
├── seed.js               # creates the super admin account
├── package.json
├── data/db.json           # your data lives here
└── public/
    ├── index.html         # login page
    ├── superadmin.html
    ├── deptadmin.html
    ├── employee.html
    ├── meeting-room.html  # live video call + chat room
    ├── meeting-room.css
    ├── common.js          # shared fetch helpers
    └── style.css
```

## Improvement ideas (optional next steps)
- Add a "change password" feature for all roles.
- Add email notifications when invited to a meeting.
- Add screen sharing in the meeting room.
- Add a TURN server for reliable connections across restrictive networks. *(Done — see "Deploying on Railway" above.)*
- Add recurring meetings / calendar view.
- Move from JSON file to a real database (MongoDB/Postgres) for production scale.
- Add HTTPS + a real `SESSION_SECRET` via environment variable before deploying (WebRTC's `getUserMedia` requires HTTPS on any non-localhost domain).
