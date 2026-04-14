"""Quick test: read CF-protocol frames directly from the UHF reader."""
import serial
import time

PORT = "COM8"
BAUD = 115200
FRAME_START = 0xCF
FRAME_END   = 0x7D
EPC_OFFSET  = 11

def parse_frames(buf):
    epcs = []
    i = 0
    while i < len(buf):
        if buf[i] != FRAME_START:
            i += 1
            continue
        if i + 5 > len(buf):
            break
        data_len = buf[i + 4]
        frame_len = 1 + 3 + 1 + data_len + 1 + 1
        if i + frame_len > len(buf):
            break
        frame = buf[i:i + frame_len]
        if frame[-1] != FRAME_END:
            i += 1
            continue
        epc_len = frame[10] if len(frame) > 10 else 0
        if epc_len > 0 and EPC_OFFSET + epc_len <= len(frame) - 2:
            epc = frame[EPC_OFFSET:EPC_OFFSET + epc_len].hex().upper()
            if epc:
                epcs.append(epc)
        i += frame_len
    return epcs, buf[i:]

print(f"Opening {PORT} at {BAUD}...")
ser = serial.Serial(PORT, BAUD, timeout=0.1)
print("Hold a tag near the reader for 10 seconds...\n")

buf = bytearray()
found = set()
for _ in range(100):
    chunk = ser.read(256)
    if chunk:
        buf += chunk
        epcs, buf = parse_frames(buf)
        for epc in epcs:
            if epc not in found:
                found.add(epc)
                print(f"  >>> EPC: {epc}")
    time.sleep(0.1)

ser.close()
print(f"\n{'SUCCESS' if found else 'NO TAGS FOUND'}: {len(found)} unique EPC(s)")
for e in found:
    print(f"  {e}")
