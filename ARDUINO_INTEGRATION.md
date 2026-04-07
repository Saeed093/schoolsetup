# Arduino ESP32 Integration Guide

## Overview

This system integrates an Arduino ESP32 device with the School Pickup System to trigger physical alarms (buzzer, vibration motor, and LED lights) when specific RFID cards are scanned.

## Features

✅ **WebSocket Communication**: Real-time connection between server and Arduino ESP32  
✅ **Selective Alarm Trigger**: Enable/disable alarm for each student card individually  
✅ **Visual Indicators**: See which cards have alarm enabled in the management dashboard  
✅ **Quick Toggle**: Enable/disable alarms with one click  
✅ **5-Second Alarm Sequence**: Buzzer, vibration, and flashing red LEDs

---

## Arduino Hardware Setup

### Components Used
- **ESP32 Development Board**
- **Vibration Motor** (Pin 7)
- **Buzzer** (Pin 9)
- **Green LED** (Pin 42) - Power indicator
- **Blue LED** (Pin 39) - WiFi connection indicator
- **Red LEDs** (Pins 36, 45, 21) - Alarm indicators

### Wiring Diagram
```
ESP32 Pin Configuration:
├── Pin 7  → Vibration Motor
├── Pin 9  → Buzzer
├── Pin 42 → Green LED (Power)
├── Pin 39 → Blue LED (WiFi)
├── Pin 36 → Red LED 1 (Alarm)
├── Pin 45 → Red LED 2 (Alarm)
└── Pin 21 → Red LED 3 (Alarm)
```

---

## Arduino Code Configuration

### 1. Update WiFi Credentials

In your Arduino code, update these lines with your network details:

```cpp
const char* WIFI_SSID     = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
```

### 2. Update Server IP Address

Find your laptop's IP address and update the Arduino code:

**On Windows (PowerShell):**
```powershell
ipconfig
```
Look for "IPv4 Address" under your active network adapter.

**Update the Arduino code:**
```cpp
const char* WS_HOST = "192.168.1.XXX";  // Replace with your laptop's IP
```

### 3. Upload to ESP32

1. Open the Arduino code in Arduino IDE
2. Select **Board**: ESP32 Dev Module (or your specific ESP32 board)
3. Select the correct **Port**
4. Click **Upload**

---

## Server Configuration

The server automatically creates a WebSocket endpoint at `/ws/ping` (port 8000) that the Arduino connects to.

### WebSocket Endpoints

| Endpoint | Purpose | Client Type |
|----------|---------|-------------|
| `ws://SERVER_IP:5000/` | Web client communication | React Frontend |
| `ws://SERVER_IP:8000/ws/ping` | Arduino communication | ESP32 Device |

**Note**: The Arduino WebSocket runs on port **8000**, not 5000. Make sure your firewall allows connections on both ports.

---

## How to Use

### 1. Enable Alarm for a Student Card

1. Go to **Management Dashboard** (`http://localhost:3000/manage`)
2. Add a new card or edit an existing one
3. Check the box: **"🚨 Enable Arduino Alarm"**
4. Click **Save** or **Update Card**

### 2. Quick Toggle Alarm Status

In the card list, each card has a bell button:
- **🔔 (Orange)**: Alarm is **enabled** - click to disable
- **🔕 (Gray)**: Alarm is **disabled** - click to enable

### 3. Scan a Card

When a card with alarm enabled is scanned:
1. The scan appears on the screen
2. The server sends "PING" to the Arduino
3. Arduino triggers:
   - ✅ Buzzer sounds for 5 seconds
   - ✅ Vibration motor runs for 5 seconds
   - ✅ Red LEDs flash on/off (300ms intervals)

---

## Testing the Integration

### Step 1: Start the Backend Server

```powershell
cd "E:\102 psc AI\School pickup sys"
node server/index.js
```

**Expected Output:**
```
✅ WiFi Connected
ESP32 IP: 192.168.1.XXX
Server running on port 5000
WebSocket server ready for connections
🔌 Arduino connected from 192.168.1.XXX. Total Arduino clients: 1
```

### Step 2: Test Card Scan

1. Open the Scan View: `http://localhost:3000/scan`
2. Scan a card that has alarm enabled
3. Check the server console for:
   ```
   🚨 Alarm enabled for this card! Triggering Arduino alarm...
   ✅ PING sent to Arduino (1/1)
   ```

### Step 3: Verify Arduino Response

The Arduino Serial Monitor should show:
```
📩 Received: PING
🚨 Alarm triggered
```

---

## Troubleshooting

### Arduino Won't Connect

**Problem**: Arduino shows "❌ Disconnected from server"

**Solutions**:
1. Verify WiFi credentials are correct
2. Check that both devices are on the same network
3. Verify server IP address in Arduino code
4. Ensure firewall allows port 8000
5. Restart both server and Arduino

### Alarm Not Triggering

**Problem**: Card is scanned but alarm doesn't activate

**Check**:
1. ✅ Card has alarm enabled in management dashboard
2. ✅ Arduino is connected (check server console)
3. ✅ Server shows "🚨 Alarm enabled for this card!"
4. ✅ Server shows "✅ PING sent to Arduino"

### Port Already in Use

**Problem**: Server can't start on port 8000

**Solution**:
```powershell
.\kill-ports.ps1
```
This will kill processes on ports 3000 and 5000.

For port 8000, manually check:
```powershell
netstat -ano | findstr :8000
taskkill /F /PID [PID_NUMBER]
```

---

## Database Schema Changes

The `cards` table now includes:

```sql
CREATE TABLE cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT UNIQUE NOT NULL,
  student_name TEXT NOT NULL,
  student_class TEXT DEFAULT '',
  alarm_enabled INTEGER DEFAULT 0,  -- NEW FIELD (0 = disabled, 1 = enabled)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Migration**: The database automatically adds the `alarm_enabled` column when you restart the server.

---

## API Endpoints

### Enable/Disable Alarm

**Update Card with Alarm Status**:
```http
PUT /api/cards/:id
Content-Type: application/json

{
  "student_name": "John Doe",
  "student_class": "Grade 5A",
  "card_id": "87719321",
  "alarm_enabled": true
}
```

**Response**:
```json
{
  "message": "Card updated successfully"
}
```

---

## Security Considerations

⚠️ **Important**: The Arduino connects over local WiFi without authentication. For production:

1. Add authentication tokens
2. Use SSL/TLS (wss://)
3. Implement IP whitelisting
4. Add rate limiting

---

## Advanced Configuration

### Change WebSocket Port

**In `server/index.js`:**

Currently hardcoded to port 8000. The server uses the HTTP server upgrade mechanism, so it shares the server port (5000 by default).

**To use a different port**, update your Arduino code:
```cpp
const uint16_t WS_PORT = 5000;  // Match your server port
```

### Customize Alarm Duration

**In Arduino code**, change the alarm duration (default 5000ms = 5 seconds):

```cpp
while (millis() - startTime < 5000) {  // Change 5000 to desired milliseconds
  // ... alarm sequence
}
```

### Add More Alarm Patterns

Modify the `alarmSequence()` function in the Arduino code to create different patterns:

```cpp
void alarmSequence() {
  // Example: Fast flashing
  for(int i = 0; i < 10; i++) {
    digitalWrite(RED_LED_1, HIGH);
    delay(100);
    digitalWrite(RED_LED_1, LOW);
    delay(100);
  }
}
```

---

## Support

For issues or questions:
1. Check server console logs for error messages
2. Check Arduino Serial Monitor for connection status
3. Verify all hardware connections
4. Test WebSocket connection manually using a WebSocket client

---

## Files Modified

### Backend
- ✅ `server/database/db.js` - Added `alarm_enabled` column
- ✅ `server/index.js` - Added Arduino WebSocket endpoint
- ✅ `server/routes/cards.js` - Updated API to handle alarm status
- ✅ `server/services/rfidService.js` - Added alarm trigger logic

### Frontend
- ✅ `client/src/components/CardManager.js` - Added alarm checkbox and toggle
- ✅ `client/src/components/CardManager.css` - Added alarm styling

### Documentation
- ✅ `ARDUINO_INTEGRATION.md` - This file

---

## System Flow Diagram

```
┌─────────────────┐
│   RFID Reader   │
└────────┬────────┘
         │ Scan Card
         ▼
┌─────────────────┐
│  Backend Server │ Check if alarm_enabled = 1
│  (rfidService)  │
└────────┬────────┘
         │ alarm_enabled = 1?
         ▼ YES
┌─────────────────┐
│   WebSocket     │ Send "PING"
│  /ws/ping:8000  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Arduino ESP32 │ Receive "PING"
│                 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Alarm Trigger  │
│  • Buzzer: ON   │
│  • Vibration: ON│
│  • LEDs: FLASH  │
│  Duration: 5s   │
└─────────────────┘
```

---

**Last Updated**: January 2026  
**Version**: 1.0
