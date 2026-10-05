# PropagandaTruck Template

## Beschreibung
Fahrzeug-Konfiguration für einen Propaganda-Truck mit Kamera-System und Lautsprecher-Setup.

## Konfiguration
- **Steering**: Servo an Pin 0 (PCA9685_0)
- **Throttle**: Servo an Pin 1 (PCA9685_0)  
- **Camera Pan**: Servo an Pin 2 (PCA9685_0)
- **Camera Tilt**: Servo an Pin 3 (PCA9685_0)
- **Front Camera**: Video-Stream auf Port 8080
- **GPS, IMU, Battery**: Telemetrie-Channels

## Dateien
- `config.json`: Haupt-Konfigurationsdatei
- `scripts/`: Zusätzliche Skripte für dieses Fahrzeug
- `models/`: 3D-Modelle und CAD-Dateien
- `docs/`: Zusätzliche Dokumentation

## Installation
Übernimm die Konfiguration aus `config.json` manuell (siehe [VehicleTemplates/README.md](../README.md)); es gibt kein Kommandozeilen-Tool mehr, das Templates lädt/anwendet. Konfiguration und Test des Fahrzeugs erfolgen anschließend über die Web-UI.

## Hardware-Anforderungen
- Raspberry Pi 4
- PCA9685 PWM-Controller
- 4x Servo-Motoren
- Pi Camera
- GPS-Module
- IMU-Sensor
- Battery Monitor