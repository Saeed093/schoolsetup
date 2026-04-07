# School Pickup RFID System

A comprehensive RFID card management system for school pickup with real-time scanning, card management, and ESP32 integration support.

## Features

- 📋 **Card Management**: Add, edit, and delete RFID cards with assigned names
- 📡 **Real-time Scanning**: Live display of scanned cards with instant name recognition
- 🔌 **USB RFID Reader Support**: Automatic detection and connection to USB RFID readers
- 🌐 **WebSocket Integration**: Real-time updates via WebSocket for instant scan notifications
- 📱 **ESP32 Ready**: API endpoints prepared for remote ESP32 activation over WiFi
- 💾 **SQLite Database**: Persistent storage of card data
- 🎨 **Modern UI**: Beautiful, responsive interface with gradient design
- 🖥️ **Dual Screen Support**: Separate views for scanning and management

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- USB RFID Reader (connected via USB/Serial port)

## Installation

1. **Install backend dependencies:**
   ```bash
   npm install
   ```

2. **Install frontend dependencies:**
   ```bash
   cd client
   npm install
   cd ..
   ```

   Or use the convenience script:
   ```bash
   npm run install-all
   ```

## Running the Application

### Development Mode

Run both backend and frontend concurrently:
```bash
npm run dev
```

Or run them separately:

**Backend only:**
```bash
npm run server
```

**Frontend only:**
```bash
npm run client
```

The application will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:5000

### Production Build

1. Build the React frontend:
   ```bash
   npm run build
   ```

2. Set environment variable:
   ```bash
   set NODE_ENV=production
   ```

3. Start the server:
   ```bash
   npm run server
   ```

## Usage

### Navigation

The application has three main views:

1. **Home** (`/`) - Landing page with navigation options
2. **Scan View** (`/scan`) - Full-screen display for card scanning (perfect for display screens)
3. **Management View** (`/manage`) - Card management interface

### Adding Cards

1. Navigate to the Management View
2. Enter a Card ID (you can type it manually or scan it)
3. Enter the person's name
4. Click "Add Card"

### Editing Cards

1. In the Management View, click the edit button (✏️) on any card
2. Modify the name
3. Click "Update Card"

### Scanning Cards

- Open the Scan View (`/scan`) on your display screen
- Simply scan an RFID card with your USB reader
- The scan will appear instantly with the registered name
- If the card is not registered, a warning will appear

### Dual Screen Setup

You can run the two views on separate screens:

1. **Management Screen**: Open `http://localhost:3000/manage` on one monitor/device
2. **Scan Display Screen**: Open `http://localhost:3000/scan` on another monitor/device

Both views update in real-time via WebSocket, so scans will appear on the Scan View even when managed from the Management View.

## API Endpoints

### Cards API

- `GET /api/cards` - Get all cards
- `GET /api/cards/:id` - Get a specific card
- `GET /api/cards/card/:cardId` - Get card by RFID card ID
- `POST /api/cards` - Create a new card
- `PUT /api/cards/:id` - Update a card
- `DELETE /api/cards/:id` - Delete a card

### RFID API

- `GET /api/rfid/status` - Get reader status
- `POST /api/rfid/activate` - Activate reader (for ESP32)
- `POST /api/rfid/deactivate` - Deactivate reader (for ESP32)
- `POST /api/rfid/scan` - Manual scan endpoint (for testing)

## ESP32 Integration

The system is ready for ESP32 integration. Your ESP32 can:

1. **Activate/Deactivate Reader:**
   ```
   POST http://your-server-ip:5000/api/rfid/activate
   POST http://your-server-ip:5000/api/rfid/deactivate
   ```

2. **Check Reader Status:**
   ```
   GET http://your-server-ip:5000/api/rfid/status
   ```

3. **Send Card Scans:**
   ```
   POST http://your-server-ip:5000/api/rfid/scan
   Body: { "card_id": "ABC123" }
   ```

### Example ESP32 Code (Arduino)

```cpp
#include <WiFi.h>
#include <HTTPClient.h>

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
const char* serverUrl = "http://YOUR_SERVER_IP:5000";

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("WiFi connected");
}

void sendCardScan(String cardId) {
  HTTPClient http;
  http.begin(String(serverUrl) + "/api/rfid/scan");
  http.addHeader("Content-Type", "application/json");
  
  String json = "{\"card_id\":\"" + cardId + "\"}";
  int httpResponseCode = http.POST(json);
  
  if (httpResponseCode > 0) {
    String response = http.getString();
    Serial.println(response);
  }
  http.end();
}
```

## RFID Reader Setup

The system automatically detects USB RFID readers on common serial ports. It tries multiple baud rates (9600, 115200, 57600, 38400, 19200) to establish connection.

If your reader uses a different baud rate or port, you can modify `server/services/rfidService.js`.

## Troubleshooting

### RFID Reader Not Detected

1. Check that the reader is connected via USB
2. Verify the reader appears in Device Manager (Windows) or `/dev/` (Linux/Mac)
3. Check the console logs for connection attempts
4. You can still use the app manually by entering card IDs

### WebSocket Connection Failed

- Ensure the backend server is running on port 5000
- Check firewall settings
- Verify CORS settings if accessing from a different origin

### Database Issues

- The database file (`server/database/cards.db`) is created automatically
- If you encounter issues, delete the database file and restart the server

## Project Structure

```
school-pickup-rfid-system/
├── server/
│   ├── index.js              # Main server file
│   ├── database/
│   │   └── db.js             # Database initialization
│   ├── routes/
│   │   ├── cards.js          # Card management routes
│   │   └── rfid.js           # RFID reader routes
│   └── services/
│       └── rfidService.js    # RFID reader service
├── client/
│   ├── src/
│   │   ├── App.js            # Main app with routing
│   │   ├── pages/
│   │   │   ├── Home.js       # Home page
│   │   │   ├── ScanView.js   # Scan display view
│   │   │   └── ManagementView.js  # Card management view
│   │   └── components/
│   │       ├── CardManager.js    # Card management UI
│   │       ├── ScanDisplay.js    # Live scan display
│   │       └── ReaderStatus.js   # Reader status indicator
│   └── public/
└── package.json
```

## License

ISC

## Support

For issues or questions, please check the console logs for detailed error messages.
