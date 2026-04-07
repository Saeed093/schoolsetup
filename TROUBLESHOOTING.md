# Troubleshooting Guide

## Common Issues and Solutions

### 1. Port Already in Use Errors

**Error:** `EADDRINUSE: address already in use :::5000` or `Something is already running on port 3000`

**Solution:**

#### Option A: Kill processes using the ports (Windows PowerShell)
```powershell
.\kill-ports.ps1
```

#### Option B: Manual port killing
```powershell
# Find process on port 5000
Get-NetTCPConnection -LocalPort 5000 | Select-Object -ExpandProperty OwningProcess

# Kill the process (replace PID with actual process ID)
Stop-Process -Id <PID> -Force

# Same for port 3000
Get-NetTCPConnection -LocalPort 3000 | Select-Object -ExpandProperty OwningProcess
Stop-Process -Id <PID> -Force
```

#### Option C: Change ports
Create a `.env` file in the root directory:
```
PORT=5001
```
Then update `client/package.json` proxy to match.

### 2. RFID Reader Access Denied

**Error:** `Failed to open at [baud] baud: Opening COM6: Access denied`

**Solutions:**

1. **Close other applications** that might be using the COM port:
   - Arduino IDE
   - Serial Monitor
   - Other RFID reader software
   - Device Manager (if open)

2. **Run as Administrator:**
   - Right-click PowerShell/Command Prompt
   - Select "Run as Administrator"
   - Navigate to project and run `npm run dev`

3. **Check Device Manager:**
   - Open Device Manager
   - Find your COM port under "Ports (COM & LPT)"
   - Right-click → Properties → Check if port is in use

4. **Try a different COM port:**
   - Unplug and replug the USB RFID reader
   - It may get assigned a different COM port

5. **The app will still work** - you can manually enter card IDs even if the reader isn't connected.

### 3. Module Not Found Errors

**Error:** `Module not found: Error: Can't resolve 'react-router-dom'`

**Solution:**
```powershell
cd client
npm install react-router-dom
```

Or install all dependencies:
```powershell
npm run install-all
```

### 4. WebSocket Connection Failed

**Error:** WebSocket connection errors in browser console

**Solutions:**
1. Make sure backend server is running on port 5000
2. Check firewall settings
3. Verify CORS is enabled (it should be by default)
4. Check browser console for specific error messages

#### If you are running the UI on a different laptop (LAN)

When the frontend runs on another laptop, `localhost` points to that laptop (not the server PC).
Set the server PC's LAN IP so the UI connects to the correct backend.

**PowerShell (recommended on Windows):**

```powershell
# On the OTHER laptop (the one showing "Connecting...")
$env:REACT_APP_SERVER_HOST="192.168.1.100"   # <-- replace with the SERVER PC IP
$env:REACT_APP_SERVER_PORT="5000"
cd client
npm start
```

Optional (if you prefer an explicit API base):

```powershell
$env:REACT_APP_API_BASE="http://192.168.1.100:5000"
cd client
npm start
```

Then open the app on that laptop at `http://localhost:3000`.

**Also required:** allow inbound TCP `5000` on the server PC (Windows Firewall), or the WebSocket will never connect.

### 5. Database Errors

**Error:** Database-related errors

**Solution:**
- The database is created automatically on first run
- If corrupted, delete `server/database/cards.db` and restart
- Make sure you have write permissions in the project directory

### 6. React App Won't Start

**Error:** React app fails to compile or start

**Solutions:**
1. Clear cache and reinstall:
   ```powershell
   cd client
   rm -r node_modules
   rm package-lock.json
   npm install
   ```

2. Check Node.js version (should be 14+):
   ```powershell
   node -v
   ```

3. Try clearing React cache:
   ```powershell
   cd client
   npm start -- --reset-cache
   ```

## Quick Fix Script

Run this to fix most common issues:

```powershell
# Kill processes on ports
.\kill-ports.ps1

# Reinstall dependencies
npm run install-all

# Start fresh
npm run dev
```

## Still Having Issues?

1. Check the console output for specific error messages
2. Verify all dependencies are installed
3. Make sure ports 3000 and 5000 are available
4. Check that Node.js version is 14 or higher
5. Try running as Administrator if you have COM port issues
