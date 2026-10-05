# LteCar Dokumentation (Deutsche Übersicht)

*Diese Seite ist eine deutschsprachige Zusammenfassung. Die vollständige, laufend gepflegte Dokumentation ist Englisch – siehe [README.md](README.md) und die verlinkten Detail-Dokumente.*

## Schnellzugriff (englische Detail-Dokumente)

- [Installation Guide](INSTALLATION.md) – Server- und Onboard-Setup
- [Features](FEATURES.md) – Feature-Übersicht
- [Configuration Reference](CONFIGURATION.md) – vollständige Konfigurationsreferenz
- [Concepts](CONCEPTS.md) – kompakte Architektur-/Implementierungsreferenz
- [Architecture](Architecture.md) – ausführliche Architekturbeschreibung
- [Video Stack Troubleshooting](VideoStackTroubleshooting.md) – Schritt-für-Schritt-Diagnose der Videokette

## Systemüberblick

LteCar ist ein System zum Bau und Betrieb ferngesteuerter Fahrzeuge über LTE/Internet.

### Kernfunktionen

- **Quasi unbegrenzte Steuerkanäle** (Lenkung, Gas, Licht, Sensoren)
- **Echtzeit-Videostreaming** vom Fahrzeug zur Weboberfläche
- **Reaktionsschnelle Fernsteuerung** über das Internet
- **Mehrere Fahrzeuge pro Server** – mehrere Fahrzeuge gleichzeitig verwalten und steuern
- **Bidirektionaler Audio-Chat** zwischen Fahrer und Fahrzeug
- **Web-Oberfläche** für Steuerung, Video, Audio-Chat und Konfiguration
- **Fahrzeug-Templates** zum Teilen von Konfigurationen

### Architektur

```
┌──────────────┐     WebRTC      ┌──────────────┐
│   Browser    │◄──────────────►│    Server    │
│   (Client)   │    SignalR     │  (ASP.NET)   │
└──────────────┘                └──────┬───────┘
                                       │
                              SignalR  │  WebRTC
                                       │
┌──────────────────────────────────────▼───────────────┐
│                    Onboard (Raspberry Pi)             │
│  ┌────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │  Vehicle   │  │   Video    │  │    Audio    │  │
│  │ Connection │  │  Service   │  │    Chat     │  │
│  │  Manager   │  │            │  │             │  │
│  └────────────┘  └────────────┘  └─────────────┘  │
└────────────────────────────────────────────────────┘
```

## Wichtige Hinweise

### LTE-Konnektivität

> Der Onboard-Client initiiert eine **rein ausgehende Verbindung** zum Server. Das Fahrzeug ist **nicht direkt aus dem Internet erreichbar** – jede Kommunikation wird vom Fahrzeug angestoßen. Das funktioniert durch NAT und die meisten Firewall-Konfigurationen hindurch.

### Datenbankänderungen

> **Niemals die Datenbank manuell ändern.** Immer EF Core Migrations verwenden.

### Onboard-Client

> Der Onboard-Client ist wegen der rein ausgehenden LTE-Verbindung **nicht aus dem Web erreichbar**. Alle Features (Bash-Tool, Channel-Tester usw.) funktionieren dadurch, dass sich Fahrzeug und Web-Client mit demselben Server verbinden.

## Erste Schritte

1. [Server installieren](INSTALLATION.md#server-installation) – Ein-Zeilen-Installer, oder über die Web-UI sobald ein Server existiert
2. [Onboard-Software installieren](INSTALLATION.md#onboard-vehicle-installation) – über den Install-Button der Server-Web-UI, oder direkt per Installer
3. Fahrzeug (Kanäle, Name, Hardware) über den Web-Client unter `/car/[carId]` konfigurieren und testen
4. [Gewünschte Features aktivieren](FEATURES.md#feature-flags-summary)

## Feature Flags

`appSettings.json` kennt fünf Feature Flags – aktuell wirkt sich aber nur eines davon tatsächlich auf das Laufzeitverhalten aus:

| Feature | Tatsächlich wirksam? |
|---------|-------------|
| `webSetup` | Nein – es gibt noch keine webbasierte Setup-Oberfläche; der Schalter ist wirkungslos |
| `bashTool` | **Ja** – schaltet das Bash-Relay zum Server frei; Standard ist aus, wenn nicht gesetzt |
| `channelTester` | Nein – wirkungslos |
| `audio` | Nein – `CarAudioHub` existiert im Code, ist aber noch nicht registriert/erreichbar |
| `video` | Nein – Video-Streaming läuft ohnehin immer, unabhängig von diesem Flag |

Details siehe [Configuration Reference](CONFIGURATION.md#feature-flags) (Englisch).

## Verzeichnisse

| Verzeichnis | Zweck |
|-----------|---------|
| `Server/` | ASP.NET-Core-Serveranwendung |
| `Onboard/` | Raspberry-Pi-Fahrzeugsoftware |
| `Client/` | Web-Client-Anwendung |
| `Shared/` | Gemeinsame Bibliotheken und SignalR-Contracts |
| `Docs/` | Dokumentation |
| `vehicleTemplates/` | Fahrzeugkonfigurationsvorlagen |
