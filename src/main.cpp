/*
  ================================================================
  GRAIN GUARD — NodeMCU (ESP8266) Sketch
  ================================================================
  Reads 3 x DHT11 sensors, shows readings on a 16x2 I2C LCD,
  connects to the phone hotspot, and serves /api/sensors.
*/

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>

const char* WIFI_SSID     = "HOME2";
const char* WIFI_PASSWORD = "09876532";

#define LCD_I2C_ADDRESS 0x27
LiquidCrystal_I2C lcd(LCD_I2C_ADDRESS, 16, 2);

#define DHT_TYPE DHT11
#define SENSOR1_PIN D5
#define SENSOR2_PIN D6
#define SENSOR3_PIN D7

DHT dht1(SENSOR1_PIN, DHT_TYPE);
DHT dht2(SENSOR2_PIN, DHT_TYPE);
DHT dht3(SENSOR3_PIN, DHT_TYPE);

ESP8266WebServer server(80);

struct SensorReading {
  float temperature;
  float humidity;
  bool valid;
};

SensorReading readingS1 = { NAN, NAN, false };
SensorReading readingS2 = { NAN, NAN, false };
SensorReading readingS3 = { NAN, NAN, false };

unsigned long lastSensorRead = 0;
const unsigned long SENSOR_READ_INTERVAL = 3000;

unsigned long lastLcdSwitch = 0;
const unsigned long LCD_SCREEN_INTERVAL = 3000;
int lcdScreen = 0;
const int LCD_SCREEN_COUNT = 3;

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("=== GRAIN GUARD — NodeMCU booting ===");

  Wire.begin(D2, D1);
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

  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long lastRetry = 0;
    if (now - lastRetry > 10000) {
      lastRetry = now;
      Serial.println("Wi-Fi disconnected. Retrying...");
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
  }
}

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

void readAllSensors() {
  readOneSensor(dht1, readingS1, "Sensor 1 (Front)");
  readOneSensor(dht2, readingS2, "Sensor 2 (Middle)");
  readOneSensor(dht3, readingS3, "Sensor 3 (Rear)");
}

void readOneSensor(DHT &sensor, SensorReading &reading, const char* label) {
  float h = sensor.readHumidity();
  float t = sensor.readTemperature();

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

String buildTempLine() {
  return "1:" + tempSlot(readingS1) + " 2:" + tempSlot(readingS2) + " 3:" + tempSlot(readingS3) + "C";
}

String buildHumLine() {
  return "1:" + humSlot(readingS1) + " 2:" + humSlot(readingS2) + " 3:" + humSlot(readingS3) + "%";
}

String tempSlot(SensorReading &r) {
  if (!r.valid) return "ERR";
  return String((int)round(r.temperature));
}

String humSlot(SensorReading &r) {
  if (!r.valid) return "ERR";
  return String((int)round(r.humidity));
}

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

void handleGetSensors() {
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
