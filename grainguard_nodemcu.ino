/*
  ================================================================
  GRAIN GUARD — NodeMCU (ESP8266) Sketch
  ================================================================
  What this does:
    - Reads 3 x DHT11 temperature/humidity sensors
    - Shows live readings on a 16x2 I2C LCD
    - Connects to your phone's Wi-Fi hotspot
    - Runs a small web server with GET /api/sensors (JSON, CORS-enabled)
    - The Grain Guard website (index.html) polls that endpoint

  PIN PLAN (do not change D1/D2 — they are reserved for the I2C LCD):
    I2C LCD   SDA = D2 (GPIO4)
    I2C LCD   SCL = D1 (GPIO5)
    DHT11 #1  DATA = D5 (GPIO14)   -> Front
    DHT11 #2  DATA = D6 (GPIO12)   -> Middle
    DHT11 #3  DATA = D7 (GPIO13)   -> Rear
    All three DHT11 sensors share the same 3.3V VCC and GND.
    (DHT11 runs fine on the NodeMCU's 3.3V pin — do not use 5V.)

  LIBRARIES NEEDED (install via Arduino IDE Library Manager):
    - ESP8266WiFi        (comes with the ESP8266 board package)
    - ESP8266WebServer    (comes with the ESP8266 board package)
    - DHT sensor library  by Adafruit
    - Adafruit Unified Sensor  (dependency of the DHT library)
    - LiquidCrystal I2C   by Frank de Brabander (or "LiquidCrystal_I2C")

  BOARD SETUP:
    Tools > Board > NodeMCU 1.0 (ESP-12E Module)

  ================================================================
*/

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>

// ========================================
// WI-FI CONFIGURATION — EDIT THESE TWO LINES
// ========================================
const char* WIFI_SSID     = "YOUR_PHONE_HOTSPOT";
const char* WIFI_PASSWORD = "YOUR_PASSWORD";

// ========================================
// I2C LCD CONFIGURATION
// ========================================
// Most 16x2 I2C backpacks use address 0x27. If your LCD shows nothing
// or garbage, try 0x3F instead — that is the other common address.
#define LCD_I2C_ADDRESS 0x27
LiquidCrystal_I2C lcd(LCD_I2C_ADDRESS, 16, 2);

// ========================================
// SENSOR PIN CONFIGURATION
// ========================================
#define DHT_TYPE DHT11
#define SENSOR1_PIN D5   // Front
#define SENSOR2_PIN D6   // Middle
#define SENSOR3_PIN D7   // Rear

DHT dht1(SENSOR1_PIN, DHT_TYPE);
DHT dht2(SENSOR2_PIN, DHT_TYPE);
DHT dht3(SENSOR3_PIN, DHT_TYPE);

// ========================================
// WEB SERVER
// ========================================
ESP8266WebServer server(80);

// ========================================
// LIVE SENSOR STATE
// ========================================
struct SensorReading {
  float temperature;
  float humidity;
  bool  valid;
};

SensorReading readingS1 = { NAN, NAN, false };
SensorReading readingS2 = { NAN, NAN, false };
SensorReading readingS3 = { NAN, NAN, false };

unsigned long lastSensorRead = 0;
const unsigned long SENSOR_READ_INTERVAL = 3000; // DHT11 should not be polled faster than ~1s; 3s is safe

unsigned long lastLcdSwitch = 0;
const unsigned long LCD_SCREEN_INTERVAL = 3000; // a bit longer since each screen now shows more data
int lcdScreen = 0;
const int LCD_SCREEN_COUNT = 3; // 0=status, 1=all temperatures, 2=all humidity

// ========================================
// SETUP
// ========================================
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("=== GRAIN GUARD — NodeMCU booting ===");

  Wire.begin(D2, D1); // SDA, SCL
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("GRAIN GUARD");
  lcd.setCursor(0, 1);
  lcd.print("Booting...");

  dht1.begin();
  dht2.begin();
  dht3.begin();

  connectWiFi();

  server.on("/api/sensors", HTTP_GET, handleGetSensors);
  server.onNotFound(handleNotFound);
  server.begin();
  Serial.println("HTTP server started on port 80");

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("GRAIN GUARD");
  lcd.setCursor(0, 1);
  lcd.print("System Online");
  lastLcdSwitch = millis();
}

// ========================================
// MAIN LOOP
// ========================================
void loop() {
  server.handleClient();

  unsigned long now = millis();

  if (now - lastSensorRead >= SENSOR_READ_INTERVAL) {
    lastSensorRead = now;
    readAllSensors();
  }

  if (now - lastLcdSwitch >= LCD_SCREEN_INTERVAL) {
    lastLcdSwitch = now;
    lcdScreen = (lcdScreen + 1) % LCD_SCREEN_COUNT;
    updateLcd();
  }

  // If Wi-Fi drops, try to quietly reconnect in the background.
  // The LCD and DHT11 readings keep working either way.
  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long lastRetry = 0;
    if (now - lastRetry > 10000) {
      lastRetry = now;
      Serial.println("Wi-Fi disconnected. Retrying...");
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
  }
}

// ========================================
// WI-FI CONNECTION
// ========================================
void connectWiFi() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("WiFi Connecting");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(WIFI_SSID);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connected. IP address: ");
    Serial.println(WiFi.localIP());
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi Online");
    lcd.setCursor(0, 1);
    lcd.print(WiFi.localIP());
    delay(2000);
  } else {
    Serial.println("WiFi connection failed — will keep retrying in the background.");
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi Offline");
    lcd.setCursor(0, 1);
    lcd.print("Retrying...");
    delay(1500);
  }
}

// ========================================
// SENSOR READING
// ========================================
void readAllSensors() {
  readOneSensor(dht1, readingS1, "Sensor 1 (Front)");
  readOneSensor(dht2, readingS2, "Sensor 2 (Middle)");
  readOneSensor(dht3, readingS3, "Sensor 3 (Rear)");
}

void readOneSensor(DHT &sensor, SensorReading &reading, const char* label) {
  float h = sensor.readHumidity();
  float t = sensor.readTemperature(); // Celsius

  if (isnan(h) || isnan(t)) {
    reading.valid = false;
    reading.temperature = NAN;
    reading.humidity = NAN;
    Serial.print(label);
    Serial.println(": READ ERROR (check wiring)");
  } else {
    reading.valid = true;
    reading.temperature = t;
    reading.humidity = h;
    Serial.print(label);
    Serial.print(": ");
    Serial.print(t);
    Serial.print(" C, ");
    Serial.print(h);
    Serial.println(" %RH");
  }
}

// ========================================
// LCD DISPLAY — all sensors shown together on each screen
// ========================================
// Screen 0: status   Screen 1: all 3 temperatures + average
// Screen 2: all 3 humidity values + average
void updateLcd() {
  lcd.clear();
  switch (lcdScreen) {
    case 0:
      lcd.setCursor(0, 0);
      lcd.print("GRAIN GUARD");
      lcd.setCursor(0, 1);
      lcd.print(WiFi.status() == WL_CONNECTED ? "System Online" : "WiFi Offline");
      break;

    case 1: {
      lcd.setCursor(0, 0);
      lcd.print(buildTempLine());
      lcd.setCursor(0, 1);
      float avgT;
      if (averageTemperature(avgT)) {
        lcd.print("AVG T:");
        lcd.print(avgT, 1);
        lcd.print("C");
      } else {
        lcd.print("AVG T:--");
      }
      break;
    }

    case 2: {
      lcd.setCursor(0, 0);
      lcd.print(buildHumLine());
      lcd.setCursor(0, 1);
      float avgH;
      if (averageHumidity(avgH)) {
        lcd.print("AVG H:");
        lcd.print(avgH, 1);
        lcd.print("%");
      } else {
        lcd.print("AVG H:--");
      }
      break;
    }
  }
}

// Builds a single compact line with all three sensors' temperatures, e.g.:
// "1:27 2:28 3:ERR" (a failed sensor shows ERR instead of a number)
String buildTempLine() {
  String line = "1:" + tempSlot(readingS1) + " 2:" + tempSlot(readingS2) + " 3:" + tempSlot(readingS3) + "C";
  return line;
}

// Builds a single compact line with all three sensors' humidity, e.g.:
// "1:61 2:60 3:63%"
String buildHumLine() {
  String line = "1:" + humSlot(readingS1) + " 2:" + humSlot(readingS2) + " 3:" + humSlot(readingS3) + "%";
  return line;
}

String tempSlot(SensorReading &r) {
  if (!r.valid) return "ERR";
  return String((int)round(r.temperature));
}

String humSlot(SensorReading &r) {
  if (!r.valid) return "ERR";
  return String((int)round(r.humidity));
}

// ========================================
// AVERAGES (only valid when all three sensors report)
// ========================================
bool averageTemperature(float &outAvg) {
  if (!readingS1.valid || !readingS2.valid || !readingS3.valid) return false;
  outAvg = (readingS1.temperature + readingS2.temperature + readingS3.temperature) / 3.0;
  return true;
}

bool averageHumidity(float &outAvg) {
  if (!readingS1.valid || !readingS2.valid || !readingS3.valid) return false;
  outAvg = (readingS1.humidity + readingS2.humidity + readingS3.humidity) / 3.0;
  return true;
}

// ========================================
// HTTP HANDLERS
// ========================================
void handleGetSensors() {
  // CORS — allows the locally hosted dashboard (any origin) to read this.
  // No API key is used or required; this endpoint is read-only sensor data.
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET");

  String json = "{";
  json += sensorJson("sensor1", readingS1) + ",";
  json += sensorJson("sensor2", readingS2) + ",";
  json += sensorJson("sensor3", readingS3);
  json += "}";

  server.send(200, "application/json", json);
}

String sensorJson(const char* key, SensorReading &r) {
  String out = "\"";
  out += key;
  out += "\":{";
  if (r.valid) {
    out += "\"temperature\":" + String(r.temperature, 1) + ",";
    out += "\"humidity\":" + String(r.humidity, 1);
  } else {
    out += "\"temperature\":null,\"humidity\":null";
  }
  out += "}";
  return out;
}

void handleNotFound() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(404, "text/plain", "Not found");
}
