# School Pickup System — How to Run

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- npm (comes with Node)

## First-time setup

From the project root (`School pickup sys`):

```powershell
npm run install-all:ps
```

Or manually:

```powershell
npm install
cd client
npm install
cd ..
```

### Optional: physical RFID reader (serial)

The `serialport` native module may fail to install on some Windows setups. If it is missing, the server still runs; you can use **manual card entry** or **keyboard-wedge (USB) scanners**. Install/build issues are logged at startup.

## Running the app (development)

From the project root in **PowerShell**:

```powershell
Set-Location "e:\102 psc AI\School pickup sys"
npm run dev
```

This starts:

- **API + WebSocket server** (nodemon) — default port **5000**
- **React client** (Create React App) — usually **http://localhost:3000**

If port 3000 is in use, the terminal will show the actual URL.

**Alternative scripts** (from `package.json`):

| Command | Purpose |
|--------|---------|
| `npm run server` | Backend only |
| `npm run client` | Frontend only (expects API on port 5000 via proxy) |
| `npm run dev:https` | Dev with HTTPS client (needs certs under `certs/`) |
| `npm run build` | Production build of the React app into `client/build` |

## URLs (after `npm run dev`)

| Page | Path | Notes |
|------|------|--------|
| Home | http://localhost:3000/ | Main menu |
| Admin | http://localhost:3000/admin | **Password required** (see below) |
| Capture station | http://localhost:3000/capture | No login |
| Class selection / class display | `/class-selection`, `/class/:classId` | No login |
| Principal dashboard | http://localhost:3000/principal | No login |
| Principal class detail | `/principal/class/:classId` | No login |
| Scan | http://localhost:3000/scan | No login |
| Manage cards | http://localhost:3000/manage | No login |
| Time to go home | http://localhost:3000/time-to-go-home | No login |

**API (direct):** http://localhost:5000  
WebSocket URLs for devices are printed in the server console on startup (see also `/api/websocket-info`).

## Logins and access control

| Area | Login? | Details |
|------|--------|---------|
| **Admin** (`/admin`) | Yes | Password: **`system1234`** — checked in the browser and sent to protected admin API routes. Session is stored in **sessionStorage** (`admin_logged_in`) until the tab is closed or you log out. |
| **All other screens** | No | Anyone with the URL can open them. |

**Security note:** The admin password is defined in application code (client `client/src/pages/Admin.js` and server `server/routes/admin.js`). For real deployment, treat this as a **demo default** and replace it with proper authentication and environment-based secrets.

## Configuration (`server/.env`)

Optional variables (see `server/.env` for examples):

- **`PORT`** — API port (default **5000**).
- **`SERVER_HOST`** — Fixed LAN IP for WebSocket URLs if auto-detection is wrong.
- **Twilio** (`TWILIO_*`) — Optional SMS/WhatsApp when a student is picked up; leave unset if unused.

## Production-style run

1. `npm run build` — builds the React app.
2. Set `NODE_ENV=production` and start the server so it serves `client/build` (see `server/index.js`).

On Windows PowerShell:

```powershell
$env:NODE_ENV = "production"
node server/index.js
```

(Ensure dependencies are installed and the build exists.)

## Troubleshooting

- **`&&` fails in PowerShell** — use `;` instead, e.g. `Set-Location "..."; npm run dev`.
- **Client cannot reach API** — confirm the server is on port 5000; dev client uses the `proxy` in `client/package.json`.
- **`serialport` missing** — RFID serial reader disabled; other features still work.
