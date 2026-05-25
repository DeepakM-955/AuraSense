#include <Wire.h>
#include <MAX30105.h>
#include "spo2_algorithm.h"
#include <DHT.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Firebase_ESP_Client.h>
#include <LiquidCrystal_I2C.h> // Ensure you install this library

#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

// ------------------- CONFIGURATION -------------------
const char* ssid = "YOUR_ACTUAL_WIFI_NAME";       
const char* password = "YOUR_ACTUAL_WIFI_PASSWORD";
#define API_KEY "YOUR_ACTUAL_FIREBASE_API_KEY"
#define DATABASE_URL "https://YOUR_DATABASE.firebaseio.com"

const char* patientID = "Deeksha"; 
const char* guardianName = "Anu";
const char* guardianPhone = "1234567890";

#define BUTTON_PIN 13

// LCD & SENSOR OBJECTS
// Address 0x27 is standard. If it doesn't work, try 0x3F.
LiquidCrystal_I2C lcd(0x27, 16, 2); 
DHT dht(5, DHT11);
OneWire oneWire(4);
DallasTemperature sensors(&oneWire);
MAX30105 particleSensor;
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

// DATA BUFFERS & VALIDATION
uint32_t irBuffer[100]; 
uint32_t redBuffer[100];
int8_t validSPO2, validHeartRate;
int32_t spo2, heartRate;
int32_t lastStableBPM = 75; 
int32_t lastStableSPO2 = 98;
float lastTemp = 36.5;

// SOS & DISPLAY LOGIC
int buttonPushCounter = 0;
unsigned long firstClickTime = 0;
bool sosActive = false;
unsigned long lastFirebaseUpdate = 0;
unsigned long lastPageChange = 0;
int lcdPage = 0;
String globalCity = "Searching...";
String mapLink = "Waiting...";

void getIPLocation();

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // Initialize LCD
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("AuraSense Boot");

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { delay(500); }

  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;
  Firebase.signUp(&config, &auth, "", "");
  Firebase.begin(&config, &auth);
  
  getIPLocation();

  Wire.begin(21, 22); // Same pins for Sensor and LCD
  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) { while(1); }
  particleSensor.setup(60, 4, 2, 100, 411, 4096);
  dht.begin();
  sensors.begin();
}

void loop() {
  handleButton(); 

  // 1. FINGER DETECTION
  long irValue = particleSensor.getIR();
  if (irValue < 50000) {
    lcd.setCursor(0, 0);
    lcd.print("STATUS:NO FINGER");
    lcd.setCursor(0, 1);
    lcd.print("PLACE FINGER... ");
    if (millis() - lastFirebaseUpdate > 2000) {
       Firebase.RTDB.setString(&fbdo, "/Patients/" + String(patientID) + "/status", "Disconnected");
       lastFirebaseUpdate = millis();
    }
    return; 
  }

  // 2. DATA COLLECTION
  lcd.setCursor(0,0);
  lcd.print("SENSING...      ");
  for (byte i = 0; i < 100; i++) {
    while (!particleSensor.available()) particleSensor.check();
    redBuffer[i] = particleSensor.getRed();
    irBuffer[i] = particleSensor.getIR();
    particleSensor.nextSample();
    handleButton(); 
  }

  // 3. VALIDATION LOGIC
  maxim_heart_rate_and_oxygen_saturation(irBuffer, 100, redBuffer, &spo2, &validSPO2, &heartRate, &validHeartRate);
  if (validHeartRate && heartRate >= 40 && heartRate <= 200) {
    if (abs(heartRate - lastStableBPM) <= 20) {
      lastStableBPM = heartRate; 
    }
  }
  lastStableSPO2 = (validSPO2 && spo2 > 80 && spo2 <= 100) ? spo2 : lastStableSPO2;
  sensors.requestTemperatures();
  lastTemp = sensors.getTempCByIndex(0) + (0.65 * (sensors.getTempCByIndex(0) - 25.0));

  // 4. LCD MULTI-PAGE DISPLAY
  lcd.clear();
  if (sosActive) {
    lcd.setCursor(0, 0);
    lcd.print("!! SOS ALERT !!");
    lcd.setCursor(0, 1);
    lcd.print("HELP");
  } else {
    // Switch between BPM/SpO2 and Temp/Status
    if (millis() - lastPageChange > 3000) {
      lcdPage = !lcdPage;
      lastPageChange = millis();
    }

    if (lcdPage == 0) {
      lcd.setCursor(0, 0);
      lcd.print("BPM: "); lcd.print(lastStableBPM);
      lcd.setCursor(0, 1);
      lcd.print("SpO2: "); lcd.print(lastStableSPO2); lcd.print("%");
    } else {
      lcd.setCursor(0, 0);
      lcd.print("Temp: "); lcd.print(lastTemp); lcd.print(" C");
      lcd.setCursor(0, 1);
      lcd.print("Status: LIVE");
    }
  }

  // 5. FIREBASE UPDATE
  if (Firebase.ready()) {
    FirebaseJson json;
    json.set("bpm", lastStableBPM);
    json.set("spo2", lastStableSPO2);
    json.set("temp", lastTemp);
    json.set("status", "Live");
    if (sosActive) {
      json.set("emergency/active", true);
      json.set("emergency/guardian_name", guardianName);
      json.set("emergency/contact", guardianPhone);
    } else {
      json.set("emergency/active", false);
    }
    Firebase.RTDB.updateNode(&fbdo, "/Patients/" + String(patientID), &json);
  }
}

void handleButton() {
  if (digitalRead(BUTTON_PIN) == LOW) {
    delay(50); 
    if (buttonPushCounter == 0) firstClickTime = millis();
    buttonPushCounter++;
    while(digitalRead(BUTTON_PIN) == LOW); 
    if (buttonPushCounter >= 3) {
      sosActive = true;
      buttonPushCounter = 0;
      Firebase.RTDB.setBool(&fbdo, "/Patients/" + String(patientID) + "/emergency/active", true);
    }
  }
  if (sosActive && (millis() - firstClickTime > 60000)) sosActive = false;
  if (buttonPushCounter > 0 && (millis() - firstClickTime > 10000)) buttonPushCounter = 0;
}

void getIPLocation() {
  HTTPClient http;
  http.begin("http://ip-api.com/json/");
  if (http.GET() > 0) {
    StaticJsonDocument<512> doc;
    deserializeJson(doc, http.getString());
    globalCity = doc["city"].as<String>();
    mapLink = "http://googleusercontent.com/maps.google.com/search?q=" + String(doc["lat"].as<float>(), 6) + "," + String(doc["lon"].as<float>(), 6);
  }
  http.end();
}