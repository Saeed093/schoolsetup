"""
UHF Reader — Multi-Protocol Serial Bridge

Supported wire protocols (auto-detected):
  BB : 0xBB header / 0x7E footer  (M100, UHFREADER18, most Chinese readers)
  CF : 0xCF header / 0x7D footer

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

logging.basicConfig(level=logging.INFO,
                    format='[%(asctime)s] %(levelname)s - %(message)s')
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

# ── Protocol constants ────────────────────────────────────────────────
BB_START = 0xBB
BB_END   = 0x7E
CF_START = 0xCF
CF_END   = 0x7D

CF_EPC_START_OFFSET = 11


# ── BB command builder ────────────────────────────────────────────────

def bb_command(cmd_byte, params=b''):
    """Build a BB-protocol command:  BB 00 cmd PLh PLl [params] CS 7E"""
    frame = bytearray([0xBB, 0x00, cmd_byte])
    pl = len(params)
    frame.append((pl >> 8) & 0xFF)
    frame.append(pl & 0xFF)
    frame.extend(params)
    frame.append(sum(frame[1:]) & 0xFF)
    frame.append(0x7E)
    return bytes(frame)


BB_START_CMDS = [
    bb_command(0x22),                             # simple real-time inventory
    bb_command(0x27, bytes([0x22, 0x00, 0x00])),  # multi-poll inventory
]
BB_STOP_CMD  = bb_command(0x28)
CF_START_CMD = bytes([0xCF, 0x00, 0x00, 0x01, 0x01, 0x00, 0x01, 0x7D])
CF_STOP_CMD  = bytes([0xCF, 0x00, 0x00, 0x01, 0x02, 0x00, 0x02, 0x7D])


# ── Frame parsers ─────────────────────────────────────────────────────

def _try_bb(buf, i):
    """Try to parse one BB frame at buf[i].

    Returns (epc_str, bytes_to_advance)  — epc_str may be '' for non-tag frames.
    Returns None when the frame is incomplete (need more bytes).
    """
    avail = len(buf) - i
    if avail < 7:                       # minimum BB frame is 7 bytes
        return None

    pl = (buf[i + 3] << 8) | buf[i + 4]
    if pl > 300:                        # sanity guard
        return ('', 1)

    frame_len = pl + 7                  # BB type cmd PLh PLl [data…] CS 7E
    if avail < frame_len:
        return None                     # wait for more data

    if buf[i + frame_len - 1] != BB_END:
        return ('', 1)                  # bad end marker — skip one byte

    cmd = buf[i + 2]
    epc = ''

    # Inventory tag notification — cmd 0x22
    # Payload: RSSI(1) + PC(2) + EPC(N) + CRC(2)  →  N = pl − 5
    if cmd == 0x22 and pl >= 7:
        epc_len = pl - 5
        if 0 < epc_len <= 62:
            epc = buf[i + 8: i + 8 + epc_len].hex().upper()

    return (epc, frame_len)


def _try_cf(buf, i):
    """Try to parse one CF frame at buf[i].  Same return convention as _try_bb.

    Frame layout (length-delimited — no fixed end marker):
      [0]    0xCF start
      [1-3]  reader address
      [4]    data_len
      [5-6]  RSSI / signal
      [7]    flags
      [8]    antenna
      [9-10] PC word  (byte 10 = EPC byte-length, e.g. 0x0C = 12)
      [11…]  EPC
      …      checksum + trailing byte(s)
    Total = 5 + data_len + 2   (header + data + checksum/trailer)
    """
    avail = len(buf) - i
    if avail < 6:
        return None

    data_len = buf[i + 4]
    if data_len == 0 or data_len > 250:
        return ('', 1)

    frame_len = 5 + data_len + 2           # CF+addr+dlen | data | CS+trail
    if avail < frame_len:
        return None                         # wait for more bytes

    epc = ''
    if frame_len > 12:                      # enough room for PC + at least 1 EPC byte
        epc_byte_len = buf[i + 10]
        if 0 < epc_byte_len <= 62 and (CF_EPC_START_OFFSET + epc_byte_len) <= (frame_len - 2):
            epc = buf[i + CF_EPC_START_OFFSET:
                       i + CF_EPC_START_OFFSET + epc_byte_len].hex().upper()

    return (epc, frame_len)


def parse_frames(buf):
    """Scan *buf* for complete frames of any supported protocol.

    Returns (list_of_epc_strings, remaining_bytearray).
    """
    epcs = []
    i = 0
    while i < len(buf):
        b = buf[i]
        result = None

        if b == BB_START:
            result = _try_bb(buf, i)
        elif b == CF_START:
            result = _try_cf(buf, i)

        if result is None:
            break                       # possible incomplete frame — keep rest
        epc, advance = result
        if epc:
            epcs.append(epc)
        i += max(advance, 1)

    return epcs, buf[i:]


# ── Reader background thread ─────────────────────────────────────────

def reader_loop():
    """Continuously read serial data and parse protocol frames."""
    global reader_connected, inventory_running
    buf = bytearray()
    raw_log_budget = 10
    logger.info("Reader thread started")

    while not stop_thread.is_set():
        if ser is None or not ser.is_open:
            time.sleep(0.1)
            continue
        try:
            chunk = ser.read(256)
            if not chunk:
                continue

            if raw_log_budget > 0:
                raw_log_budget -= 1
                hexstr = ' '.join(f'{b:02X}' for b in chunk[:80])
                logger.info('RAW [%d bytes]: %s%s',
                            len(chunk), hexstr,
                            '...' if len(chunk) > 80 else '')

            buf += chunk
            epcs, buf = parse_frames(buf)

            for epc in epcs:
                logger.info('>>> TAG SCANNED  EPC: %s', epc)
                with tag_lock:
                    tag_buffer.append({"epc": epc})

            if len(buf) > 4096:
                buf = buf[-1024:]

        except Exception as e:
            logger.error("Reader thread error: %s", e)
            time.sleep(0.2)

    logger.info("Reader thread stopped")


# ── Serial command helpers ────────────────────────────────────────────

def send_start_commands():
    """Send start-inventory commands for every supported protocol."""
    if not ser or not ser.is_open:
        return
    for cmd in BB_START_CMDS:
        try:
            ser.write(cmd)
            time.sleep(0.05)
        except Exception:
            pass
    try:
        ser.write(CF_START_CMD)
    except Exception:
        pass


def send_stop_commands():
    """Send stop-inventory commands for every supported protocol."""
    if not ser or not ser.is_open:
        return
    try:
        ser.write(BB_STOP_CMD)
    except Exception:
        pass
    try:
        ser.write(CF_STOP_CMD)
    except Exception:
        pass


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

    # Idempotent: already open on the same port/baud — nothing to do
    if ser and ser.is_open and ser.port == port and ser.baudrate == baud:
        reader_connected = True
        logger.info("Reader already open on %s — reusing", port)
        return jsonify({"success": True})

    # Close existing connection on a different port/baud
    if ser and ser.is_open:
        try:
            ser.close()
        except Exception:
            pass
        time.sleep(0.3)  # let the OS release the handle

    # Retry up to 3 times — first attempt can hit PermissionError if the
    # OS hasn't fully released the port from the previous close.
    last_err = None
    for attempt in range(3):
        try:
            ser = serial.Serial(port, baud, timeout=0.1)
            reader_connected = True

            if reader_thread is None or not reader_thread.is_alive():
                stop_thread.clear()
                reader_thread = threading.Thread(target=reader_loop, daemon=True,
                                                 name="UHFReader")
                reader_thread.start()

            logger.info("Reader opened on %s at %s baud (attempt %d)", port, baud, attempt + 1)
            return jsonify({"success": True})
        except Exception as e:
            last_err = e
            logger.warning("Open attempt %d failed for %s: %s", attempt + 1, port, e)
            time.sleep(0.4)

    logger.error("Failed to open %s after 3 attempts: %s", port, last_err)
    return jsonify({"success": False, "error": str(last_err)}), 500


@app.route('/CloseDevice', methods=['POST'])
def close_device():
    global ser, reader_connected, inventory_running
    inventory_running = False
    send_stop_commands()
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
    send_start_commands()
    logger.info("Inventory started")
    return jsonify({"success": True})


@app.route('/InventoryStop', methods=['POST'])
def inventory_stop():
    global inventory_running
    inventory_running = False
    send_stop_commands()
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
    return jsonify({
        "ok": True,
        "service": "uhf-bridge",
        "connected": reader_connected,
        "scanning": inventory_running
    })


@app.route('/', methods=['GET'])
def index():
    return jsonify({
        "service": "UHF Reader Bridge (Multi-Protocol: BB + CF)",
        "sdk_available": True,
        "connected": reader_connected,
        "scanning": inventory_running
    })


def auto_connect(com_port, baud):
    """Open the serial port and start inventory automatically on startup."""
    global ser, reader_connected, inventory_running
    logger.info("Auto-connecting to %s at %d baud...", com_port, baud)
    try:
        ser = serial.Serial(com_port, baud, timeout=0.1)
        reader_connected = True
        inventory_running = True
        send_start_commands()
        logger.info("Auto-connected and inventory started on %s", com_port)
    except Exception as e:
        logger.warning("Auto-connect failed (%s): %s — waiting for manual /OpenDevice call", com_port, e)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8888)
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--com', default='COM8')
    parser.add_argument('--baud', type=int, default=115200)
    args = parser.parse_args()

    logger.info("Starting UHF Bridge (Multi-Protocol) on %s:%s", args.host, args.port)

    stop_thread.clear()
    reader_thread = threading.Thread(target=reader_loop, daemon=True, name="UHFReader")
    reader_thread.start()

    auto_connect(args.com, args.baud)

    app.run(host=args.host, port=args.port, debug=False, threaded=True)
