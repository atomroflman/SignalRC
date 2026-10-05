# Vehicle Templates

Dieses Verzeichnis enthält Fahrzeug-Vorlagen für das LteCar-System. Jede Vorlage ist in einem separaten Ordner organisiert und kann neben der Grundkonfiguration auch zusätzliche Dateien wie Skripte, 3D-Modelle und Dokumentation enthalten.

## 📁 Ordnerstruktur

Jede Vorlage folgt dieser standardisierten Struktur:

```
VehicleTemplates/
├── TemplateName/
│   ├── config.json          # Haupt-Konfigurationsdatei (erforderlich)
│   ├── README.md            # Template-spezifische Dokumentation
│   ├── scripts/             # Zusätzliche Setup- und Wartungsskripte
│   │   ├── setup.sh         # Fahrzeug-spezifisches Setup
│   │   ├── calibration.sh   # Kalibrierungsskripte
│   │   └── maintenance.sh   # Wartungsskripte
│   ├── models/              # 3D-Modelle und CAD-Dateien
│   │   ├── chassis.stl      # Chassis-Modell
│   │   ├── mounts.step      # Halterungen
│   │   └── assembly.obj     # Gesamtmodell
│   └── docs/                # Zusätzliche Dokumentation
│       ├── hardware.md      # Hardware-Spezifikationen
│       ├── wiring.md        # Verdrahtungsdiagramme
│       └── calibration.md   # Kalibrierungsanleitung
```

## 🚗 Verfügbare Templates

### PropagandaTruck
- **Beschreibung**: Fahrzeug mit Kamera-System und Audio-Setup
- **Hardware**: 4x Servo-Motoren, Pi Camera, GPS, IMU, Battery Monitor
- **Features**: Lenkung, Throttle, Camera Pan/Tilt, Video-Stream

## 🔧 Template erstellen

1. Erstelle einen neuen Ordner in `VehicleTemplates/`
2. Erstelle `config.json` mit der Fahrzeug-Konfiguration
3. Füge optional Skripte, Modelle und Dokumentation hinzu

## 📋 Template verwenden

Es gibt kein Kommandozeilen-Tool mehr, das Templates lädt/anwendet. Übernimm die gewünschte Konfiguration aus `config.json` manuell, bzw. konfiguriere und teste das Fahrzeug über die Web-UI.

## 📝 config.json Format

Die `config.json` Datei enthält die vollständige Fahrzeug-Konfiguration:

```json
{
  "name": "Template Name",
  "description": "Template Beschreibung",
  "version": "1.0",
  "author": "Autor",
  "created": "2025-09-28 10:30:00",
  "channelMap": {
    "pinManagers": [...],
    "controlChannels": [...],
    "telemetryChannels": [...],
    "videoStreams": [...]
  }
}
```

## 🛠️ Best Practices

### Template-Organisation:
- **Eindeutige Namen**: Verwende beschreibende Template-Namen
- **Versionierung**: Aktualisiere die Version bei Änderungen
- **Dokumentation**: Erstelle ausführliche README.md Dateien
- **Skripte**: Stelle Setup- und Kalibrierungsskripte bereit

### Datei-Konventionen:
- **config.json**: Haupt-Konfigurationsdatei (erforderlich)
- **README.md**: Template-Dokumentation (empfohlen)
- **scripts/setup.sh**: Fahrzeug-spezifisches Setup
- **docs/hardware.md**: Hardware-Spezifikationen
- **models/**: STL, STEP, OBJ Dateien für 3D-Modelle

### Hardware-Dokumentation:
- Verdrahtungsdiagramme in `docs/wiring.md`
- Kalibrierungsanleitung in `docs/calibration.md`
- Teileliste in `docs/parts.md`
- Fotos in `docs/images/`

## 🔄 Template-Verwaltung

Templates auflisten oder löschen erfolgt manuell im Dateisystem (`VehicleTemplates/<TemplateName>/` anzeigen bzw. löschen) — ein Verwaltungswerkzeug dafür gibt es nicht mehr.

### Template kopieren:
```bash
cp -r VehicleTemplates/PropagandaTruck VehicleTemplates/NewTemplate
# Passe config.json und README.md entsprechend an
```

## 🎯 Verwendungsbeispiele

### Entwicklung:
1. Entwickle eine neue Fahrzeug-Konfiguration
2. Teste ausgiebig mit dem Channel-Test-Tool
3. Speichere als Template für Wiederverwendung
4. Dokumentiere Hardware und Setup-Prozess

### Produktion:
1. Wähle passendes Template
2. Führe fahrzeug-spezifische Skripte aus
3. Kalibriere Hardware mit bereitgestellten Tools
4. Validiere Konfiguration mit Test-Tool

### Wartung:
1. Verwende Template-spezifische Wartungsskripte
2. Aktualisiere Template bei Hardware-Änderungen
3. Versioniere Templates für Rückverfolgbarkeit