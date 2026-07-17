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
- Good for small-to-medium teams (mesh WebRTC — every participant connects directly to every other participant, ideal for up to ~6 people per call with the free public STUN server). For larger company-wide calls, or use across strict corporate firewalls/NAT, add a TURN server (e.g. coturn or Twilio's) — ask and it can be wired in.

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
- Add a TURN server for reliable connections across restrictive networks.
- Add recurring meetings / calendar view.
- Move from JSON file to a real database (MongoDB/Postgres) for production scale.
- Add HTTPS + a real `SESSION_SECRET` via environment variable before deploying (WebRTC's `getUserMedia` requires HTTPS on any non-localhost domain).
