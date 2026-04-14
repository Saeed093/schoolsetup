"""
Read raw bytes from the UHF reader to see what protocol it uses.
Run this WHILE holding a tag near the reader.
"""
import serial
import time

PORT = "COM8"
BAUD = 115200

print(f"Opening {PORT} at {BAUD} baud for 15 seconds...")
print("Hold a UHF tag near the reader antenna!\n")

try:
    ser = serial.Serial(PORT, BAUD, timeout=0.1)
except Exception as e:
    print(f"Failed to open port: {e}")
    print("Is the manufacturer software still running? Close it first.")
    exit(1)

time.sleep(0.2)

# Some readers need a command to start; try a few common "inventory start" commands
# and also just listen passively
commands = [
    # Prime reader typical start command
    bytes.fromhex("BB 00 27 00 03 22 00 00 4A 7E".replace(" ","")),
    # Generic: just listen first
]

print("Sending common inventory start command...")
try:
    ser.write(bytes.fromhex("BB0027000322004A7E".replace(" ","")))
except Exception:
    pass

print("Listening for raw bytes (15s)...")
raw_all = b""
start = time.time()
while time.time() - start < 15:
    chunk = ser.read(256)
    if chunk:
        raw_all += chunk
        hexstr = " ".join(f"{b:02X}" for b in chunk)
        print(f"  RAW: {hexstr}")
    time.sleep(0.05)

ser.close()

print(f"\n--- Total bytes received: {len(raw_all)} ---")
if raw_all:
    hexdump = " ".join(f"{b:02X}" for b in raw_all[:120])
    print(f"First bytes: {hexdump}")
    
    # Detect protocol by frame header
    if b'\xBB' in raw_all:
        print("\n>>> Looks like M100/UHFREADER18 protocol (0xBB header)")
        print("    This reader uses the 'uhf' Python library commands differently")
    elif b'\x5A' in raw_all:
        print("\n>>> Looks like protocol with 0x5A header (matches uhf.reader SDK)")
    elif b'\xA0' in raw_all or b'\xA1' in raw_all:
        print("\n>>> Looks like CISC/M6E protocol")
    else:
        print(f"\n>>> Unknown protocol. First byte: 0x{raw_all[0]:02X}")
else:
    print("No data received. Reader may need a specific start command, or wrong port/baud.")
    print("Try running this with the manufacturer software open to compare.")
