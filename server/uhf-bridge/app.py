"""
UHF Prime Reader - Direct Serial Bridge (CF Protocol)

Your reader uses the CF-frame protocol:
  CF [addr:3] [data_len:1] [signal:2] [?:1] [antenna:1] [PC:2] [EPC:N] [checksum:1] 7D

Run: python app.py [--port 8888] [--com COM8] [--baud 115200]
"""

import threading
import time
import logging
import argparse
import serial
import serial.tools.list_ports
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
logging.getLogger('werkzeug').setLevel(logging.WARNING)

@app.after_request
def _quiet(response):
    if request.path in ('/health', '/GetTagInfo', '/favicon.ico'):
        return response
    logger.info('%s %s %s', request.method, request.path, response.status_code)
    return response

# ── State ─────────────────────────────────────────────────────────────
ser = None
reader_connected = False
inventory_running = False
tag_buffer = []
tag_lock = threading.Lock()
reader_thread = None
stop_thread = threading.Event()

FRAME_START = 0xCF
FRAME_END   = 0x7D
# Fixed offsets within a frame:
#   0      : CF
#   1-3    : reader address (3 bytes)
#   4      : data_len  (typically 0x12 = 18)
#   5-6    : signal / RSSI
#   7      : ?
#   8      : antenna ID
#   9-10   : PC word  (byte 10 = EPC length in bytes, e.g. 0x0C = 12)
#   11-22  : EPC  (length = byte 10)
#   -2     : checksum
#   -1     : 0x7D end marker

EPC_START_OFFSET = 11   # byte index where EPC starts


def parse_frames(buf: bytearray):
    """
    Scan buf for complete CF frames, return (list_of_epcs, remaining_buf).
    """
    epcs = []
    i = 0
    while i < len(buf):
        # Find start byte
        if buf[i] != FRAME_START:
            i += 1
            continue

        # Need at least 5 bytes to read data_len
        if i + 5 > len(buf):
            break

        data_len = buf[i + 4]
        frame_len = 1 + 3 + 1 + data_len + 1 + 1  # CF + addr + data_len_byte + data + checksum + END

        if i + frame_len > len(buf):
            break  # incomplete frame, wait for more bytes

        frame = buf[i:i + frame_len]

        # Validate end marker
        if frame[-1] != FRAME_END:
            # Bad frame, skip this CF and try next
            i += 1
            continue

        # Extract EPC
        epc_len = frame[10] if len(frame) > 10 else 0
        if epc_len > 0 and EPC_START_OFFSET + epc_len <= len(frame) - 2:
            epc_bytes = frame[EPC_START_OFFSET: EPC_START_OFFSET + epc_len]
            epc = epc_bytes.hex().upper()
            if epc:
                epcs.append(epc)

        i += frame_len

    return epcs, buf[i:]


def reader_loop():
    """Background thread: reads serial data and parses CF frames."""
    global reader_connected, inventory_running
    buf = bytearray()
    logger.info("Reader thread started")

    while not stop_thread.is_set():
        if ser is None or not ser.is_open:
            time.sleep(0.1)
            continue
        try:
            chunk = ser.read(256)
            if chunk:
                buf += chunk
                epcs, buf = parse_frames(buf)
                for epc in epcs:
                    logger.info('>>> TAG SCANNED  EPC: %s', epc)
                    with tag_lock:
                        tag_buffer.append({"epc": epc})
            # Prevent runaway buffer
            if len(buf) > 4096:
                buf = buf[-1024:]
        except Exception as e:
            logger.error("Reader thread error: %s", e)
            time.sleep(0.2)

    logger.info("Reader thread stopped")


# ── Routes ────────────────────────────────────────────────────────────

@app.route('/getPorts', methods=['POST', 'GET'])
def get_ports():
    ports = [p.device for p in serial.tools.list_ports.comports()]
    return jsonify({"ports": ports})


@app.route('/OpenDevice', methods=['POST'])
def open_device():
    global ser, reader_connected, reader_thread, stop_thread
    data = request.get_json(silent=True) or {}
    port = data.get('port', 'COM8')
    baud = int(data.get('baud', 115200))

    # Close existing
    if ser and ser.is_open:
        try:
            ser.close()
        except Exception:
            pass

    try:
        ser = serial.Serial(port, baud, timeout=0.1)
        reader_connected = True

        # Start background reader thread if not running
        if reader_thread is None or not reader_thread.is_alive():
            stop_thread.clear()
            reader_thread = threading.Thread(target=reader_loop, daemon=True, name="UHFReader")
            reader_thread.start()

        logger.info("Reader opened on %s at %s baud", port, baud)
        return jsonify({"success": True})
    except Exception as e:
        logger.error("Failed to open %s: %s", port, e)
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/CloseDevice', methods=['POST'])
def close_device():
    global ser, reader_connected, inventory_running
    inventory_running = False
    if ser and ser.is_open:
        try:
            ser.close()
        except Exception:
            pass
    reader_connected = False
    logger.info("Reader closed")
    return jsonify({"success": True})


@app.route('/GetDevicePara', methods=['POST', 'GET'])
def get_device_para():
    return jsonify({"connected": reader_connected, "sdk": True})


@app.route('/StartCounting', methods=['POST'])
def start_counting():
    global inventory_running
    with tag_lock:
        tag_buffer.clear()
    inventory_running = True

    # Try sending a start command — CF readers often auto-scan but this wakes some models
    if ser and ser.is_open:
        try:
            # Common CF-protocol start inventory command
            cmd = bytes([0xCF, 0x00, 0x00, 0x01, 0x01, 0x00, 0x01, 0x7D])
            ser.write(cmd)
        except Exception:
            pass  # Reader may already be in auto mode

    logger.info("Inventory started")
    return jsonify({"success": True})


@app.route('/InventoryStop', methods=['POST'])
def inventory_stop():
    global inventory_running
    inventory_running = False

    if ser and ser.is_open:
        try:
            # Common CF-protocol stop command
            cmd = bytes([0xCF, 0x00, 0x00, 0x01, 0x02, 0x00, 0x02, 0x7D])
            ser.write(cmd)
        except Exception:
            pass

    logger.info("Inventory stopped")
    return jsonify({"success": True})


@app.route('/GetTagInfo', methods=['POST', 'GET'])
def get_tag_info():
    if not inventory_running:
        return jsonify({"tags": []})
    with tag_lock:
        result = list(tag_buffer)
        tag_buffer.clear()
    return jsonify({"tags": result})


@app.route('/SimulateTag', methods=['POST'])
def simulate_tag():
    data = request.get_json(silent=True) or {}
    epc = data.get('epc', '').strip().upper()
    if not epc:
        return jsonify({"error": "epc required"}), 400
    with tag_lock:
        tag_buffer.append({"epc": epc})
    logger.info('>>> SIMULATED TAG  EPC: %s', epc)
    return jsonify({"success": True, "epc": epc})


@app.route('/health', methods=['GET'])
def health():
    return jsonify({"ok": True, "service": "uhf-bridge", "connected": reader_connected, "scanning": inventory_running})


@app.route('/', methods=['GET'])
def index():
    return jsonify({
        "service": "UHF Prime Reader Bridge (CF Protocol)",
        "sdk_available": True,
        "connected": reader_connected,
        "scanning": inventory_running
    })


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8888)
    parser.add_argument('--host', default='0.0.0.0')
    args = parser.parse_args()

    logger.info("Starting UHF Bridge (CF Protocol) on %s:%s", args.host, args.port)

    # Start the reader thread immediately (it waits for serial to open)
    stop_thread.clear()
    reader_thread = threading.Thread(target=reader_loop, daemon=True, name="UHFReader")
    reader_thread.start()

    app.run(host=args.host, port=args.port, debug=False, threaded=True)
