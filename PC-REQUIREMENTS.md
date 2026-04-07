# PC Requirements – School Pickup RFID Server

For running this server with **500+ children** (cards).  
*(No Arduino/ESP32 – web app + optional USB RFID reader only.)*

---

## Without Arduino / ESP32 (current setup)

The server runs **only**:

- **HTTP** (Express) – API and static files
- **One WebSocket server** – for web clients (Class View, Principal View, Admin, etc.)
- **SQLite** – cards and pickups
- **Optional:** one USB serial RFID reader (single COM port)

No Arduino or ESP32 connections, so load is very light.

---

## Minimum (usable)

| Component | Requirement |
|-----------|-------------|
| **CPU** | Any dual-core, 1 GHz+ (e.g. Intel Celeron, AMD A4, or older i3) |
| **RAM** | 4 GB system RAM |
| **Storage** | 2 GB free (SQLite, uploads, app) |
| **OS** | Windows 10/11 or Linux |
| **Network** | Same LAN as devices that open the web app (Wi‑Fi or Ethernet). |

---

## Recommended (comfortable)

| Component | Requirement |
|-----------|-------------|
| **CPU** | Dual-core or quad-core (e.g. Intel i3, AMD Ryzen 3) |
| **RAM** | 8 GB system RAM |
| **Storage** | 5 GB free (SSD preferred for faster startup) |
| **Network** | Wired Ethernet and a static IP (or DHCP reservation) for the server. |

---

## Why these numbers?

- **Server load:** One Node.js process; Express + one WebSocket server for browsers. Work is I/O (DB, WebSocket), not CPU-heavy.
- **Database:** SQLite with ~500 cards; lookups by `card_id` are trivial.
- **Connections:** Only browser clients (Class View, Principal View, Admin, Management, etc.) – typically under 10 WebSocket connections.
- **Polling:** Principal views poll every 1.5 s; a few HTTP requests per second are negligible.

---

## USB (if using one RFID reader)

- If you use **one USB serial RFID reader** on this PC: one free USB port; OS must see it (e.g. COM port on Windows).
- If you use **only the Admin “Simulate scan”** and no physical reader: no USB requirement.

---

## Summary (no Arduino/ESP32)

- **Minimum:** Any dual-core PC, 4 GB RAM, 2 GB free disk, same LAN as clients.
- **Recommended:** Dual/quad-core, 8 GB RAM, some free SSD space, wired Ethernet, static IP.
- A typical office or classroom PC is more than enough for 500+ children without Arduino/ESP32.
