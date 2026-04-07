#include <WiFi.h>
#include <WebSocketsClient.h>
#include <Adafruit_NeoPixel.h>

// ============ WIFI CONFIG ============
const char* ssid     = "sapveh";
const char* password = "sapveh1234";

// ============ WEBSOCKET CONFIG ============
const char* WS_HOST = "10.249.120.237";   // Fixed server IP for 'sapveh' hotspot
const uint16_t WS_PORT = 5000;             // Server port
const char* WS_PATH = "/ws/esp32?device_id=ESP32_001";  // MUST include device_id

// ============ HARDWARE CONFIG ============
// NOTE: Avoid GPIO 0, 3, 9, 10, 45, 46 on ESP32-S3 (boot/flash pins)
// Safe GPIOs for outputs: 4, 5, 6, 7, 15, 16, 17, 18, 38, 39, 40, 41, 42
#define BUZZER_PIN     5    // Buzzer on GPIO 5 (safe pin - GPIO 9 causes boot issues!)
#define VIBRATION_PIN  7    // Vibration motor on GPIO 7

// Set to true to enable components
#define BUZZER_ENABLED    true
#define VIBRATION_ENABLED true

// Disable startup test to prevent boot issues
#define STARTUP_TEST_ENABLED false

#define RGB_PIN   48     // ESP32-S3 internal RGB
#define RGB_COUNT 1

// ============ ALARM CONFIG ============
#define ALARM_DURATION_MS 15000  // 15 seconds
#define BLINK_INTERVAL_MS 500    // 500ms interval for LED, buzzer, and vibration

// ==========================================

WebSocketsClient webSocket;
Adafruit_NeoPixel rgb(RGB_COUNT, RGB_PIN, NEO_GRB + NEO_KHZ800);

// ============ STATE ============
unsigned long alarmStartTime = 0;
unsigned long lastBlinkTime = 0;
bool alarmActive = false;
bool rgbOn = false;  // For blinking

// ============ HELPERS ============

void setRGB(uint8_t r, uint8_t g, uint8_t b) {
  rgb.setPixelColor(0, rgb.Color(r, g, b));
  rgb.show();
}

// ============ WEBSOCKET EVENT ============

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {

    case WStype_CONNECTED:
      Serial.println("✅ WebSocket CONNECTED to server!");
      Serial.print("   Host: "); Serial.println(WS_HOST);
      Serial.print("   Port: "); Serial.println(WS_PORT);
      Serial.print("   Path: "); Serial.println(WS_PATH);
      setRGB(0, 255, 255); // CYAN = connected
      break;

    case WStype_DISCONNECTED:
      Serial.println("❌ WebSocket DISCONNECTED from server");
      setRGB(0, 0, 255); // BLUE = disconnected but WiFi OK
      break;

    case WStype_TEXT: {
      String msg = String((char*)payload);
      Serial.println("========================================");
      Serial.print("📩 RECEIVED MESSAGE: [");
      Serial.print(msg);
      Serial.println("]");
      Serial.print("   Message length: ");
      Serial.println(length);

      if (msg == "ALARM") {
        Serial.println("🚨🚨🚨 ALARM COMMAND RECEIVED! 🚨🚨🚨");
        Serial.println("   → All outputs will PULSE ON/OFF (500ms interval)");
        Serial.print("   → BUZZER: GPIO "); Serial.println(BUZZER_PIN);
        Serial.print("   → VIBRATION: GPIO "); Serial.println(VIBRATION_PIN);
        Serial.print("   → Duration: ");
        Serial.print(ALARM_DURATION_MS / 1000);
        Serial.println(" seconds");

        // Start with ON phase
        setRGB(255, 0, 0); // RED
        if (BUZZER_ENABLED) digitalWrite(BUZZER_PIN, HIGH);
        if (VIBRATION_ENABLED) digitalWrite(VIBRATION_PIN, HIGH);
        rgbOn = true;

        alarmStartTime = millis();
        lastBlinkTime = millis();
        alarmActive = true;
        
        Serial.println("   ✅ Alarm activated - pulsing started!");
      } else if (msg == "CONNECTED") {
        Serial.println("   Server confirmed connection");
      } else {
        Serial.println("   ⚠️ Unknown command, ignoring");
      }
      Serial.println("========================================");
      break;
    }

    case WStype_ERROR:
      Serial.println("❌ WebSocket ERROR!");
      break;

    case WStype_PING:
      Serial.println("📡 Received PING from server");
      break;

    case WStype_PONG:
      Serial.println("📡 Received PONG from server");
      break;

    default:
      Serial.print("⚠️ Unknown WebSocket event type: ");
      Serial.println(type);
      break;
  }
}

// ============ SETUP ============

void setup() {
  // Boot delay
  delay(2000);
  
  Serial.begin(115200);

  // IMMEDIATELY turn off RGB (clear any previous state)
  rgb.begin();
  rgb.clear();
  rgb.show();  // Force update to turn OFF
  
  // Initialize output pins as LOW
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(VIBRATION_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(VIBRATION_PIN, LOW);

  Serial.println("\n🚀 ESP32-S3 ALARM SYSTEM");
  Serial.print("   Buzzer: GPIO "); Serial.println(BUZZER_PIN);
  Serial.print("   Vibration: GPIO "); Serial.println(VIBRATION_PIN);

  // Connect to WiFi
  Serial.print("📡 Connecting to WiFi...");
  WiFi.begin(ssid, password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" OK!");
    Serial.print("   IP: "); Serial.println(WiFi.localIP());
    setRGB(0, 0, 255); // BLUE = WiFi connected
    
    // Start WebSocket
    Serial.print("🔌 WebSocket: ");
    Serial.print(WS_HOST); Serial.print(":"); Serial.println(WS_PORT);
    webSocket.begin(WS_HOST, WS_PORT, WS_PATH);
    webSocket.onEvent(webSocketEvent);
    webSocket.setReconnectInterval(5000);
  } else {
    Serial.println(" FAILED!");
    setRGB(255, 100, 0); // ORANGE = WiFi failed
  }

  Serial.println("✅ Ready!\n");
}

// ============ WIFI RECONNECTION ============

void reconnectWiFi() {
  Serial.println("⚠️ WiFi lost - reconnecting...");
  setRGB(255, 100, 0); // ORANGE
  
  WiFi.disconnect();
  WiFi.begin(ssid, password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ WiFi reconnected!");
    setRGB(0, 0, 255); // BLUE
    
    // Restart WebSocket
    webSocket.begin(WS_HOST, WS_PORT, WS_PATH);
    webSocket.onEvent(webSocketEvent);
    webSocket.setReconnectInterval(5000);
  } else {
    Serial.println("\n❌ WiFi reconnect failed");
    setRGB(255, 100, 0); // ORANGE
  }
}

// ============ LOOP ============

unsigned long lastWiFiCheck = 0;
const unsigned long WIFI_CHECK_INTERVAL = 10000; // Check every 10 seconds

void loop() {
  // Only run WebSocket loop if WiFi is connected
  if (WiFi.status() == WL_CONNECTED) {
    webSocket.loop();
  }

  // Handle pulsing during alarm (500ms interval) - LED, buzzer, and vibration all pulse together
  if (alarmActive) {
    if (millis() - lastBlinkTime >= BLINK_INTERVAL_MS) {
      lastBlinkTime = millis();
      rgbOn = !rgbOn;
      
      if (rgbOn) {
        // ON phase
        setRGB(255, 0, 0); // RED ON
        if (BUZZER_ENABLED) digitalWrite(BUZZER_PIN, HIGH);
        if (VIBRATION_ENABLED) digitalWrite(VIBRATION_PIN, HIGH);
      } else {
        // OFF phase
        setRGB(0, 0, 0);   // OFF
        if (BUZZER_ENABLED) digitalWrite(BUZZER_PIN, LOW);
        if (VIBRATION_ENABLED) digitalWrite(VIBRATION_PIN, LOW);
      }
    }
  }

  // Stop alarm after ALARM_DURATION_MS (10 seconds)
  if (alarmActive && millis() - alarmStartTime >= ALARM_DURATION_MS) {
    Serial.println("========================================");
    Serial.println("⏱️ Alarm duration expired!");
    
    if (BUZZER_ENABLED) {
      Serial.println("   → BUZZER OFF");
      digitalWrite(BUZZER_PIN, LOW);
    }
    
    if (VIBRATION_ENABLED) {
      Serial.println("   → VIBRATION OFF");
      digitalWrite(VIBRATION_PIN, LOW);
    }
    
    alarmActive = false;

    if (WiFi.status() == WL_CONNECTED) {
      setRGB(0, 255, 255); // CYAN = connected
      Serial.println("   → RGB set to CYAN (WebSocket connected)");
    } else {
      setRGB(255, 100, 0); // ORANGE = no WiFi
      Serial.println("   → RGB set to ORANGE (WiFi disconnected)");
    }

    Serial.println("✅ Alarm cleared - ready for next alarm");
    Serial.println("========================================\n");
  }

  // Check WiFi connection and reconnect if needed (when not in alarm)
  if (!alarmActive && millis() - lastWiFiCheck >= WIFI_CHECK_INTERVAL) {
    lastWiFiCheck = millis();
    
    if (WiFi.status() != WL_CONNECTED) {
      reconnectWiFi();
    }
  }

  delay(5); // keep watchdog happy
}
