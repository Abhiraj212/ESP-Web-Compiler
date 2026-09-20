/*
  NEO-6M Wi-Fi GPS Dashboard
  NodeMCU ESP8266 + NEO-6M

  NEO-6M TX -> NodeMCU D5 (GPIO14)
  NEO-6M GND -> NodeMCU GND

  Wi-Fi AP:
    SSID: NEO6M-GPS
    Password: gps12345
    Dashboard: http://192.168.4.1

  Note: HDOP is dilution of precision, not a guaranteed error radius.
*/

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <SoftwareSerial.h>
#include <TinyGPS++.h>

const char* AP_SSID = "NEO6M-GPS";
const char* AP_PASSWORD = "gps12345";

static const uint8_t GPS_RX_PIN = D5; // ESP RX <- NEO-6M TX
static const uint8_t GPS_TX_PIN = D6; // unused, kept for SoftwareSerial
static const uint32_t GPS_BAUD = 9600;

SoftwareSerial gpsSerial(GPS_RX_PIN, GPS_TX_PIN);
TinyGPSPlus gps;
ESP8266WebServer server(80);

const char PAGE[] PROGMEM = R"HTML(
<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NEO-6M GPS</title><style>
body{margin:0;background:#0b1020;color:#eef2ff;font-family:system-ui,sans-serif}main{max-width:720px;margin:auto;padding:24px}
h1{font-size:28px}.sub{color:#9aa6c5}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.card{background:#151c31;border:1px solid #27314e;border-radius:18px;padding:18px}.v{font-size:26px;font-weight:700;margin-top:7px}
.good{color:#72e6a1}.bad{color:#ff8a8a}a{color:#8ab4ff}small{color:#9aa6c5}@media(max-width:520px){.grid{grid-template-columns:1fr}}
</style></head><body><main><h1>🛰️ NEO-6M GPS</h1><p class="sub">Live data from NodeMCU ESP8266</p>
<div class="grid">
<div class="card">GPS Fix<div class="v" id="fix">...</div></div>
<div class="card">Satellites<div class="v" id="sat">--</div></div>
<div class="card">Latitude<div class="v" id="lat">--</div></div>
<div class="card">Longitude<div class="v" id="lng">--</div></div>
<div class="card">HDOP<div class="v" id="hdop">--</div><small>Lower is generally better; not metres.</small></div>
<div class="card">Altitude<div class="v" id="alt">--</div></div>
<div class="card">Speed<div class="v" id="spd">--</div></div>
<div class="card">GPS data age<div class="v" id="age">--</div></div>
</div><p id="map"></p>
<script>
async function update(){
 try{
  const r=await fetch('/api/gps',{cache:'no-store'}),d=await r.json();
  const f=document.getElementById('fix'); f.textContent=d.fix?'FIXED':'NO FIX'; f.className='v '+(d.fix?'good':'bad');
  sat.textContent=d.satellites??'--'; lat.textContent=d.latitude??'--'; lng.textContent=d.longitude??'--';
  hdop.textContent=d.hdop??'--'; alt.textContent=d.altitude_m==null?'--':d.altitude_m+' m';
  spd.textContent=d.speed_kmph==null?'--':d.speed_kmph+' km/h'; age.textContent=d.age_ms==null?'--':d.age_ms+' ms';
  map.innerHTML=d.fix?'<a target="_blank" href="https://www.google.com/maps?q='+d.latitude+','+d.longitude+'">Open coordinates in Maps ↗</a>':'Waiting for satellite fix...';
 }catch(e){document.getElementById('fix').textContent='OFFLINE'}
}
update();setInterval(update,1000);
</script></main></body></html>
)HTML";

void sendGpsJson() {
  const bool fix = gps.location.isValid() && gps.location.age() < 5000;
  String j = "{";
  j += "\"fix\":" + String(fix ? "true" : "false");
  j += ",\"satellites\":" + String(gps.satellites.isValid() ? String(gps.satellites.value()) : "null");
  j += ",\"latitude\":" + String(fix ? String(gps.location.lat(), 6) : "null");
  j += ",\"longitude\":" + String(fix ? String(gps.location.lng(), 6) : "null");
  j += ",\"hdop\":" + String(gps.hdop.isValid() ? String(gps.hdop.hdop(), 2) : "null");
  j += ",\"altitude_m\":" + String(gps.altitude.isValid() ? String(gps.altitude.meters(), 1) : "null");
  j += ",\"speed_kmph\":" + String(gps.speed.isValid() ? String(gps.speed.kmph(), 1) : "null");
  j += ",\"age_ms\":" + String(gps.location.isValid() ? String(gps.location.age()) : "null");
  j += "}";
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", j);
}

void setup() {
  Serial.begin(115200);
  gpsSerial.begin(GPS_BAUD);
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASSWORD);

  server.on("/", [](){ server.send_P(200, "text/html", PAGE); });
  server.on("/api/gps", HTTP_GET, sendGpsJson);
  server.begin();

  Serial.println();
  Serial.println("NEO-6M GPS dashboard ready");
  Serial.print("Wi-Fi: "); Serial.println(AP_SSID);
  Serial.print("Open: http://"); Serial.println(WiFi.softAPIP());
}

void loop() {
  while (gpsSerial.available()) gps.encode(gpsSerial.read());
  server.handleClient();
}
