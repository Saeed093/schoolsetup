#include <WiFi.h>
#include <WebSocketsClient.h>

// ================= WIFI CONFIG =================
const char* WIFI_SSID     = "sapveh";
const char* WIFI_PASSWORD = "sapveh1234";

// ================= SERVER CONFIG =================
const char* WS_HOST = "10.56.70.237";    // Laptop / Server IP (from server startup log)
const uint16_t WS_PORT = 5000;            // WebSocket port (from server startup log)
const char* WS_PATH = "/ws/ping";         // WebSocket endpoint (for legacy Arduino)

// ================= PIN CONFIG =================
#define VIBRATION_PIN 7
#define BUZZER_PIN    9

#define GREEN_LED_PIN 42   // Power indicator
#define BLUE_LED_PIN  39   // WiFi indicator

#define RED_LED_1 36
#define RED_LED_2 45
#define RED_LED_3 21

// ===============================================

WebSocketsClient webSocket;

// ------------------ HELPERS ------------------

void allOff() {
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(VIBRATION_PIN, LOW);

  digitalWrite(RED_LED_1, LOW);
  digitalWrite(RED_LED_2, LOW);
  digitalWrite(RED_LED_3, LOW);
}

void alarmSequence() {
  unsigned long startTime = millis();

  digitalWrite(BUZZER_PIN, HIGH);
  digitalWrite(VIBRATION_PIN, HIGH);

  while (millis() - startTime < 5000) {   // 5 seconds
    digitalWrite(RED_LED_1, HIGH);
    digitalWrite(RED_LED_2, HIGH);
    digitalWrite(RED_LED_3, HIGH);
    delay(300);

    digitalWrite(RED_LED_1, LOW);
    digitalWrite(RED_LED_2, LOW);
    digitalWrite(RED_LED_3, LOW);
    delay(300);
  }

  allOff();
}

// ------------------ WEBSOCKET EVENTS ------------------

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {

  switch (type) {

    case WStype_CONNECTED:
      Serial.println(" Connected to server");
      break;

    case WStype_DISCONNECTED:
      Serial.println(" Disconnected from server");
      digitalWrite(BLUE_LED_PIN, LOW);
      allOff();
      break;

    case WStype_TEXT: {
      String msg = String((char*)payload);
      Serial.print(" Received: ");
      Serial.println(msg);

      if (msg == "PING") {
        Serial.println("Alarm triggered");
        alarmSequence();
      }
      break;
    }

    default:
      break;
  }
}

// ------------------ SETUP ------------------

void setup() {
  Serial.begin(115200);

  pinMode(VIBRATION_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  pinMode(GREEN_LED_PIN, OUTPUT);
  pinMode(BLUE_LED_PIN, OUTPUT);

  pinMode(RED_LED_1, OUTPUT);
  pinMode(RED_LED_2, OUTPUT);
  pinMode(RED_LED_3, OUTPUT);

  // Power ON indicator
  digitalWrite(GREEN_LED_PIN, HIGH);
  digitalWrite(BLUE_LED_PIN, LOW);
  allOff();

  // -------- WIFI --------
  Serial.print("📡 Connecting to WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\n WiFi Connected");
  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());

  digitalWrite(BLUE_LED_PIN, HIGH); // WiFi connected

  // -------- WEBSOCKET --------
  webSocket.begin(WS_HOST, WS_PORT, WS_PATH);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
}

// ------------------ LOOP ------------------

void loop() {
  webSocket.loop();
}
