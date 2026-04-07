## HTTPS setup (so camera works on LAN URLs)

Browsers require **HTTPS** (secure context) for camera access (`getUserMedia`) unless you are on `http://localhost`.

This project can run the React dev server on HTTPS and proxy API/WebSocket/uploads to the backend.

### 1) Generate a trusted dev certificate (Windows)

1. Install **mkcert**:
   - `winget install -e --id FiloSottile.mkcert`
   - or `choco install mkcert -y`
2. From the project root, run:

```powershell
.\scripts\setup-https.ps1
```

This creates:
- `certs/dev-cert.pem`
- `certs/dev-key.pem`

### 2) Start the system in HTTPS mode

From the project root:

```powershell
npm run dev:https
```

### 3) Open pages from other laptops

Use your server PC LAN IP (example `192.168.18.129`):

- Home: `https://192.168.18.129:3000`
- Capture Station: `https://192.168.18.129:3000/capture`
- Class View: `https://192.168.18.129:3000/class/1`
- Principal: `https://192.168.18.129:3000/principal`

### Important note about cameras

The browser will always use the **camera of the device that opened the page**.

So if you open Capture Station from another laptop, it will use **that laptop's camera**, not the server PC camera.

