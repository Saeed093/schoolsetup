# Quick Start Guide

## Step 1: Install Dependencies

Open a terminal in the project root and run:

```bash
npm install
cd client
npm install
cd ..
```

## Step 2: Connect Your RFID Reader

1. Plug in your USB RFID reader
2. Wait for Windows to recognize it (check Device Manager if needed)
3. Note the COM port number (e.g., COM3, COM4)

## Step 3: Start the Application

From the project root, run:

```bash
npm run dev
```

This will start both the backend (port 5000) and frontend (port 3000).

## Step 4: Open the Application

Open your browser and go to: **http://localhost:3000**

You'll see a home page with two options:
- **Scan View** - For displaying card scans (perfect for display screens)
- **Management View** - For adding and managing cards

## Step 5: Add Your First Card

1. Click on **Management View** or go to: **http://localhost:3000/manage**
2. Enter a Card ID
   - You can type it manually, or
   - Scan a card with your RFID reader (the ID will appear in the field)
3. Enter the person's name
4. Click "Add Card"

## Step 6: Test Scanning

1. Open the **Scan View** at: **http://localhost:3000/scan**
   - This is perfect for displaying on a separate screen/monitor
2. Scan an RFID card with your reader
3. You should see:
   - The card name appear instantly
   - The scan added to the "Recent Scans" history

### Dual Screen Setup

For the best experience:
- **Screen 1**: Open Management View (`/manage`) for administration
- **Screen 2**: Open Scan View (`/scan`) for displaying scans

Both views update in real-time, so you can manage cards on one screen while scans appear on the other!

## Troubleshooting

### Reader Not Detected?
- The app will still work! You can manually enter card IDs
- Check the server console for connection attempts
- Try unplugging and replugging the reader

### Port Already in Use?
- Make sure no other application is using port 5000 or 3000
- Close other Node.js applications

### WebSocket Connection Error?
- Make sure the backend is running
- Check that port 5000 is not blocked by firewall

## Next Steps

Once everything is working:
- Add all your cards
- Test scanning multiple cards
- When ready, integrate with ESP32 using the API endpoints (see README.md)
