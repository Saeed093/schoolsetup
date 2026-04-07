# Testing Card Scanning

## Debugging Steps

1. **Check Server Console** - When you scan a card, you should see:
   - "Raw serial data (hex): ..."
   - "Raw serial data (string): ..."
   - "Raw data received from RFID reader: ..."
   - "Card scanned: [CARD_ID]"
   - "Broadcasting card scan: ..."

2. **Check Reader Status**:
   - Open browser console (F12)
   - Go to: http://localhost:3000/scan
   - Check if reader shows as "Connected"

3. **Test Manual Scan**:
   - Use the API endpoint to test:
   ```bash
   curl -X POST http://localhost:5000/api/rfid/scan \
     -H "Content-Type: application/json" \
     -d "{\"card_id\":\"YOUR_CARD_ID\"}"
   ```

4. **Check WebSocket Connection**:
   - Open browser console
   - You should see "WebSocket connected"
   - When scanning, you should see "Card scan received: ..."

## Common Issues

### No data received
- Check if reader is connected (status endpoint)
- Check server console for "Raw serial data" messages
- Try different baud rates
- Check if another app is using the COM port

### Data received but not processed
- Check server console for "Raw data received" messages
- Check the format of the card ID
- Make sure card ID matches format in database

### WebSocket not receiving
- Check browser console for WebSocket connection
- Check server console for "Card scan broadcasted" message
- Verify WebSocket is connected before scanning
