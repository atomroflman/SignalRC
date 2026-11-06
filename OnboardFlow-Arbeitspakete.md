# Onboard-Flow und lokaler Controller: Plan und Arbeitspakete

Stand: 2026-11-06, Branch `feature/onboard-flow`. OF00–OF12 sind umgesetzt.
Bei OF13 sind die automatischen Tests fertig, die Hardware-Checkliste am Fahrzeug
ist noch offen. Benutzerdoku: [Docs/OnboardFlow.md](Docs/OnboardFlow.md).

„Umgesetzt“ heißt: implementiert, gebaut, mit Modultests geprüft und lokal
committet. Ein Rollout auf `lte-rc-server` oder ein Fahrzeug ist damit nicht
verbunden (siehe `AGENTS.md`).

## Ziel

Das Fahrzeug bekommt eine eigene, vollständige Flow-Engine. Ein Bluetooth-
Controller, der direkt am Fahrzeug gekoppelt ist, kann das Fahrzeug steuern,
ohne Umweg über den Server. Er wirkt gleichzeitig mit dem Web (Mischbetrieb)
oder allein, wenn das Web abgekoppelt ist. Hintergrund: Man muss das Fahrzeug
manchmal bewegen, ohne an einem PC zu sitzen.

## Festgelegte Entscheidungen

Vom User vorgegeben (Gespräch vom 2026-11-06):

| ID | Entscheidung |
| --- | --- |
| E01 | Das Onboard bekommt eine **komplette** Flow-Engine mit allen Funktionsknoten. |
| E02 | Browser- und Onboard-Teil sind **ein gemeinsamer Flow pro User und Fahrzeug**. Bearbeitet wird er in **einem** View. |
| E03 | **Nur von oben nach unten:** Der Browser-Flow übergibt an den Onboard-Flow oder direkt an die Hardware, wie bisher. Ein Hardware-Kanal wird **nie** von beiden Zonen getrieben. |
| E04 | Hat der Flow einen Onboard-Teil, wird dieser bei **jeder Kontrollübernahme** gepusht. Ohne Onboard-Teil bleibt alles wie heute. Der Push ist ein einfacher, vollständiger Schnappschuss. |
| E05 | Der Onboard-Flow liest lokale Telemetrie direkt. |
| E06 | Es gilt immer der Flow dessen, der die Session hält. |
| E07 | Kanäle, die der Browser direkt treibt, sind ohne Web neutral. Der Editor markiert sie als „lokal nicht verfügbar“. |
| E08 | Ohne Web liefern Übergabe-Knoten keinen Wert. Sie verhalten sich wie eine getrennte Steuerung (neutral). Fallback-Werte gibt es nicht. |
| E09 | Ändert sich der Onboard-Teil während einer Session, wird er **sofort** neu gepusht. Zustände wie der aktuelle Gang bleiben für Knoten erhalten, die es noch gibt. |
| E10 | Nach einem Neustart des Onboards ist „Web abkoppeln“ aus. |
| E11 | Die Controller sind primär Bluetooth-Geräte. Das **Pairing** läuft über das Frontend. |
| E12 | **Mischbetrieb:** Web und lokaler Controller wirken gleichzeitig. Wie gemischt wird, legt **nur der Flow** fest, mit den neuen Knoten „Aktiv?“ und „Vorrang“. Es gibt keine automatische Mischung. |
| E13 | Standard ist der Mischbetrieb. Der Schalter im Frontend heißt **„Web abkoppeln“**: Der Onboard-Flow läuft dann ohne Browser weiter. |
| E14 | Der BT-Controller **gehört dem Fahrzeug**. Jeder User kann seine Achsen im eigenen Flow verwenden. |
| E15 | Der lokale Controller wirkt auch unter der Session eines anderen Users, wenn dessen Flow ihn verwendet. |

Technische Festlegungen dieses Plans:

| ID | Festlegung |
| --- | --- |
| T01 | Jeder Flow-Knoten hat eine **Zone**: `Browser` (0, Standard für alle bestehenden Knoten) oder `Onboard` (1). |
| T02 | Die Grenze bildet ein neuer **Übergabe-Knoten** (`UserSetupHandoffNode`, Zone `Onboard`). Er hat den Eingang `in` für die Browser-Seite und die Ausgänge `value` und `connected` für die Onboard-Seite. |
| T03 | **Kantenregeln:** Browser → Browser, Browser → Übergabe, Übergabe → Onboard, Onboard → Onboard. Alles andere lehnt der Server ab. In der Onboard-Zone sind Zyklen verboten. |
| T04 | Ein Fahrzeugkanal (`CarChannel`) darf in einem Setup nur in **einer** Zone als Ausgang vorkommen. Der Server prüft das beim Anlegen des Knotens. |
| T05 | Browser-Gamepad-Kanäle (`UserChannel`) gibt es nur in der Browser-Zone, Fahrzeug-Controller-Kanäle (`VehicleInputChannel`) nur in der Onboard-Zone. `HudInput` und `HudSignal` gibt es nur im Browser. Alle anderen Funktionen gibt es in beiden Zonen. |
| T06 | Der Push ist ein vollständiges `OnboardFlowDefinition` mit SHA-256-Hash. Der Server pusht bei `AquireCarControl` und nach jeder Flow-Änderung des Session-Inhabers. Mehrere Änderungen in kurzer Folge fasst er zusammen (Entprellung 250 ms). Das Onboard tauscht in einem Schritt. Ohne Onboard-Teil wird `null` gepusht, und der Onboard-Flow ist aus. |
| T07 | Die Onboard-Engine rechnet taktweise mit **50 Hz** in topologischer Reihenfolge. Ein Kanal wird gesendet, wenn sich der Wert ändert, und zusätzlich spätestens nach dem halben `MaxResendInterval` des Kanals (Standard 200 ms). |
| T08 | Übergabewerte schickt der Browser über `UpdateFlowHandoff(carId, sessionId, nodeId, value)`, bei Änderung und als Wiederholung alle 500 ms. Das Onboard setzt `connected = 0` und den Wert 0, wenn 1500 ms nichts kommt, das Web abgekoppelt ist oder der Server weg ist. |
| T09 | **Serververlust im Mischbetrieb:** Browser-Kanäle gehen auf neutral, Übergaben werden getrennt, der Onboard-Flow läuft weiter. **Abgekoppelt:** Der Serververlust ändert nichts am Fahrbetrieb. |
| T10 | Eine Eingabe am lokalen Controller zählt als Aktivität der Session (`HasLiveSession`). Wer vor Ort fährt, verhindert so eine Übernahme durch einen anderen nach 30 s Leerlauf und verzögert das automatische Update. |
| T11 | Fahrzeug-Controller laufen über Linux evdev (`/dev/input/event*`). Achsen werden auf −1…1 normiert, Trigger (`ABS_Z`, `ABS_RZ`, `ABS_GAS`, `ABS_BRAKE` mit Minimum ≥ 0) auf 0…1, Tasten auf 0/1. Ein Eingangsknoten liefert `value` und `connected`. |
| T12 | Das Onboard meldet seine Controller mit Kanälen beim Server an (`ReportVehicleInputDevices`). Der Server speichert sie als `VehicleInputDevice`/`VehicleInputChannel` am Fahrzeug. |
| T13 | Status: Das Onboard sendet `OnboardFlowStatus` (Hash, Betriebsart, Übergabe verbunden, Controller verbunden, Knotenwerte) bei jeder Änderung des Zustands und höchstens 5× pro Sekunde für die Werte. Der Server leitet an die Gruppe `flow-status-{carId}` weiter. |
| T14 | Das Pairing nutzt `bluetoothctl`. Scannen, Koppeln, Vertrauen, Verbinden und Entfernen erfordern die aktive Kontroll-Session, wie Dateiübertragung und Bash. |
| T15 | Die Funktionen sind in TS und C# doppelt implementiert. Gemeinsame Referenzfälle in `Shared/FlowParity/cases.json` laufen in vitest **und** xunit. Jede neue Funktion braucht dort einen Fall. |

## Ablauf im Überblick

```
Browser:  Gamepad ─► Browser-Knoten ─┬─► Fahrzeugkanal (Zone Browser) ──UpdateChannel──► Onboard
                                     └─► Übergabe ──UpdateFlowHandoff──► Onboard-Flow
Onboard:  BT-Controller (evdev) ─┐
          Übergabe-Werte ────────┼─► Onboard-Flow (50 Hz) ─► Fahrzeugkanal (Zone Onboard) ─► Hardware
          Lokale Telemetrie ─────┘
Server:   AquireCarControl / Flow-Änderung ─► OnboardFlowBuilder ─► ApplyOnboardFlow(session, def)
          Onboard ─► ReportOnboardFlowStatus ─► Gruppe flow-status-{carId} ─► Editor/Fahrseite
```

## Arbeitspakete

| ID | Status | Inhalt |
| --- | --- | --- |
| OF00 | ✅ | Verträge in `Shared/Flow`: Flow-Definition, Status, Controller- und Bluetooth-DTOs, Hub-Methoden |
| OF01 | ✅ | C#-Flow-Engine (`Onboard/Flow`): alle Funktionen, Topologie, Takt, Erhalt der Knotenzustände, Paritätstests |
| OF02 | ✅ | Neue Knoten „Aktiv?“ (`Active`) und „Vorrang“ (`Priority`) in TS und C# |
| OF03 | ✅ | Datenmodell und Migration: Zone, Übergabe-Knoten, Fahrzeug-Controller, Controller-Eingangsknoten |
| OF04 | ✅ | Server-Regeln: Knoten anlegen mit Zone, Kantenprüfung, exklusive Kanäle, Zyklen, Vorlagen und Kopieren |
| OF05 | ✅ | Push und Hub: `OnboardFlowBuilder`, Push bei Übernahme und Änderung, Übergabe-Relay, Abkoppeln, Status-Relay |
| OF06 | ✅ | Onboard-Integration: `OnboardFlowService`, Session-Regeln, Kanalbesitz, Serververlust, lokale Telemetrie |
| OF07 | ✅ | Onboard-Eingabe: evdev-Leser, Hotplug, Normierung, Anmeldung der Controller beim Server |
| OF08 | ✅ | Bluetooth-Pairing: `bluetoothctl`-Wrapper, Hub-Relay, UI |
| OF09 | ✅ | Client-Engine: Auswertung nur der Browser-Zone, Übergabe-Senden, Live-Werte des Onboard-Flows |
| OF10 | ✅ | Editor: Zonen, Palette, Verbindungsprüfung, Statusbanner, Controller-Panel |
| OF11 | ✅ | Fahrseite: Schalter „Web abkoppeln“ und Status |
| OF12 | ✅ | Installation: bluez, Gruppen `input`/`bluetooth`, Doku |
| OF13 | ◐ | Abnahme: automatische Tests ✅, Hardware-Checkliste am Fahrzeug offen |

### OF00 – Verträge

- `Shared/Flow/OnboardFlowDefinition.cs`: `OnboardFlowDefinition` (Hash, SetupId, UserId, Nodes, Links), `OnboardFlowNode` (Id, Kind, Function, Params, ChannelName, ResendIntervalMs, InputDeviceKey, InputCode, IsAxis), `OnboardFlowLink`. Alles MessagePack- und JSON-fähig.
- `Shared/Flow/OnboardFlowStatus.cs`: Hash, `Mode` (`off` | `mixed` | `detached`), `HandoffConnected`, Controller mit `connected`, Knotenwerte.
- `Shared/Flow/VehicleInputDevices.cs`: angemeldete Controller mit Kanälen.
- `Shared/Flow/BluetoothDevices.cs`: Scan-Ergebnis und Ergebnis einer Aktion.
- Hub-Methoden in `IControlClient` (Server → Onboard): `ApplyOnboardFlow`, `UpdateFlowHandoff`, `SetWebDetached`, Bluetooth-Aktionen.
- Hub-Methoden in `IConnectionHubServer`: vom Onboard `ReportOnboardFlowStatus` und `ReportVehicleInputDevices`; vom Browser `UpdateFlowHandoff`, `SetWebDetached`, `SubscribeToFlowStatus`/`UnsubscribeFromFlowStatus` und die Bluetooth-Aktionen.

### OF01 – C#-Flow-Engine

- `Onboard/Flow/Functions/*`: alle 22 bestehenden Funktionen mit demselben Verhalten wie in TS. Zustandsbehaftete Funktionen (`Toggle`, `Gearbox`, `TurnSignal`, `Smooth`) halten ihren Zustand pro Knoten. `Smooth` rechnet zeitbasiert über den Takt, statt eigene Timer zu starten.
- `Onboard/Flow/FlowEngine.cs`: Laden, topologische Ordnung, Takt, Kantenwerte (Textausgaben wie bei `edgeValue`: Zahl oder 0), Ausgänge an eine Senke.
- Beim neuen Laden bleibt der Zustand eines Knotens erhalten, wenn Id und Funktion gleich bleiben (E09).
- Tests: `Tests/SignalRC.Overlay.Tests/Flow/*`, plus die Referenzfälle aus T15.

### OF02 – „Aktiv?“ und „Vorrang“

- `Active`: Eingang `input`, Parameter `threshold` (0,05) und `hold` (2 s). Die Ausgabe `active` ist 1, solange |input| > threshold ist, und noch `hold` Sekunden danach. Im Browser sorgt ein Timer dafür, dass der Wert nach Ablauf zurückfällt.
- `Priority`: Eingänge `a`, `aActive`, `b`. Ausgabe `aActive ≥ 0,5 ? a : b`.
- Beispiel „lokal übersteuert Web für 2 s“: Controller-Lenkung → `Active` → `Priority.aActive`; Controller-Lenkung → `Priority.a`; Übergabe Lenkung → `Priority.b`.

### OF03 – Datenmodell

- `UserSetupFlowNodeBase.Zone` (int, Standard 0).
- `UserSetupHandoffNode` (Diskriminator `H`, Feld `Name`).
- `VehicleInputDevice` (CarId, DeviceKey, Name, LastSeenUtc) und `VehicleInputChannel` (DeviceId, Code, IsAxis, Name).
- `UserSetupVehicleInputNode` (Diskriminator `V`, `VehicleInputChannelId`).
- EF-Migration `AddOnboardFlow`.

### OF04 – Server-Regeln

- `FlowController.AddNode`: Zone im Request; neue Knotentypen `handoff` und `vehicleinput`; Regeln aus T04 und T05.
- `FlowController.LinkNode`: Regeln aus T03, inklusive Zyklenprüfung in der Onboard-Zone.
- `GetFlow`: liefert `zone`, die neuen Knotentypen und `onboardChannelIds` für die Markierung aus E07.
- `SetupTemplateController` (Vorlagen, Kopieren): Zone und neue Knoten werden mitgenommen. Fahrzeug-Controller werden über Gerätename und Code zugeordnet.

### OF05 – Push und Hub

- `OnboardFlowBuilder`: baut aus dem Setup die Definition und den Hash.
- `OnboardFlowPublisher` (Singleton): merkt sich pro Fahrzeug den Session-Inhaber (UserId), pusht bei `AquireCarControl` sofort und nach jeder Flow-Änderung entprellt.
- `FlowController` meldet jede Änderung an den Publisher.
- Relay-Methoden aus OF00; Status landet in `CarConnectionInfo.FlowStatus` (für spätere Abonnenten) und geht an die Gruppe.
- Controller-Anmeldung speichert Geräte und Kanäle am Fahrzeug.

### OF06 – Onboard-Integration

- `OnboardFlowService`: hält die Definition, startet und stoppt den 50-Hz-Takt, liefert der Engine die Eingänge (Übergaben, Controller, Telemetrie) und schreibt die Ausgänge über `ControlExecutionService.SetControl`.
- `ControlService`:
  - `UpdateChannel` ignoriert Kanäle des Onboard-Flows; abgekoppelt ignoriert es alles.
  - `ReleaseCarControl` und eine neue Session leeren den Onboard-Flow.
  - `OnClosed`/`OnReconnecting` setzen nur die Browser-Kanäle neutral, und das auch nur, wenn nicht abgekoppelt.
  - `LockForUpdate` stoppt auch den Onboard-Flow.
- `TelemetryService` legt die zuletzt gelesenen Werte pro Kanalname in einem `LiveTelemetrySnapshot` ab.

### OF07 – Onboard-Eingabe

- `Onboard/Input/EvdevDevice.cs`: Geräte erkennen über `/sys/class/input/event*/device` (Name, Vendor, Product, `uniq`), Achsenbereiche per `EVIOCGABS`, Ereignisse lesen (64-/32-Bit-Layout).
- `Onboard/Input/VehicleInputService.cs`: Hotplug-Abfrage alle 2 s. Bei Verbindungsverlust gehen die Werte auf 0 und `connected` auf 0. Jede Eingabe zählt als Session-Aktivität (T10). Neue Geräte werden beim Server angemeldet.
- Geräteschlüssel: `uniq` (BT-Adresse), sonst `vendor:product:name`.

### OF08 – Bluetooth-Pairing

- `Onboard/Input/BluetoothService.cs`: `bluetoothctl` mit Agent `NoInputNoOutput`; Scan (10 s), Liste bekannter Geräte, Koppeln + Vertrauen + Verbinden, Trennen, Entfernen.
- Hub-Relay mit Session-Prüfung (T14).
- UI: Panel „Fahrzeug-Controller“ im Flow-Editor. Es zeigt gekoppelte Geräte mit Verbindungsstatus und hat Knöpfe zum Scannen, Koppeln und Entfernen.

### OF09 – Client-Engine

- `control-flow-store`: Knoten mit Zone `Onboard` werden nicht im Browser gerechnet. Kanten in einen Übergabe-Knoten senden per `UpdateFlowHandoff`, mit Wiederholung alle 500 ms.
- Der Store abonniert `OnboardFlowStatus` und zeigt die Werte der Onboard-Knoten.

### OF10 – Editor

- Knoten zeigen ihre Zone (Farbe und Kennzeichnung „Fahrzeug“).
- Die Palette hat einen Zonen-Umschalter; neue Funktionsknoten entstehen in der gewählten Zone.
- `isValidConnection` prüft die Kantenregeln schon beim Ziehen.
- Statusbanner: „Browser → Hardware“, „Browser → Fahrzeug-Flow (Mischbetrieb)“ oder „Web abgekoppelt – Fahrzeug-Flow lokal“, dazu der Verbindungsstatus der Controller.
- Panel mit den Achsen und Tasten der Fahrzeug-Controller zum Anlegen von Eingangsknoten.
- Browser-Ausgänge bekommen den Hinweis „lokal nicht verfügbar“ (E07).

### OF11 – Fahrseite

- Schalter „Web abkoppeln“ für den Session-Inhaber. Abgekoppelt sendet der Browser nichts; der Status ist sichtbar.
- Neu ankoppeln über denselben Schalter.

### OF12 – Installation

- `install.sh`: `bluez` installieren, den Service-User in die Gruppen `input` und `bluetooth` aufnehmen.
- Kurzdoku in `Docs/OnboardFlow.md`.

### OF13 – Abnahme

Automatisch:
- Paritätsfälle (vitest + xunit)
- Engine-Tests
- Server-Regeln
- Builder und Hash
- evdev-Parser
- Onboard-Modusregeln

Manuell am Fahrzeug:
1. Controller koppeln (Frontend), Achsen erscheinen im Editor.
2. Onboard-Kanal nur über den Controller steuern; Browser-Kanal ist ausgegraut.
3. Mischbetrieb mit „Vorrang“: Web lenkt, lokale Bewegung übersteuert 2 s.
4. Web abkoppeln → Browser-Kanäle neutral, lokal fahrbar; Server stoppen → weiter fahrbar.
5. Controller ausschalten → Onboard-Kanäle neutral (bei entsprechendem Flow).
6. Flow im Editor ändern → wirkt sofort, der Gang bleibt erhalten.
7. Onboard neu starten → nicht abgekoppelt, kein Onboard-Flow bis zur nächsten Übernahme.

## Umsetzung

Teststand am 2026-11-06:

- .NET: 820 Tests grün, 78 übersprungen; davon 76 im Bereich Flow (Parität, Engine, Zonenregeln,
  Builder, Modusregeln des `OnboardFlowService`, evdev).
- Client: 919 vitest-Tests grün; neu sind Parität und Zonenregeln.
- Client-Typecheck, Server-Build und Onboard-Build ohne Fehler und Warnungen.

Abweichungen vom Plan:

- **T11/T12 Geräteschlüssel:** `uniq/Name`, ohne `uniq` `vendor:product/Name`. So
  unterscheiden sich Gamepad- und Bewegungssensor-Knoten desselben Controllers.
- **Knotentyp:** Controller-Knoten liefern im Client den Typ `vehicleInput`, nicht
  `input`. Ihre Id ist eine `VehicleInputChannel`-Id und darf nicht mit den
  Browser-Gamepads verwechselt werden.
- **TurnSignal (Browser):** Die Parameter `steps` und `isLeftTurn` werden jetzt aus
  dem gespeicherten Text gelesen. Bisher galten im Browser immer 5 und links. Das
  war nötig, damit die Referenzfälle in beiden Engines gleich laufen.
- **Testbarkeit:** `OnboardFlowService` schreibt über `IControlSink`. Der
  `ControlExecutionService` implementiert diese Schnittstelle.
- **Neue Endpunkte über den Plan hinaus:** Zone eines Knotens ändern
  (`POST api/flow/{id}/zone`) und Übergabe umbenennen (`POST api/flow/{id}/name`).

Offen:

- Hardware-Checkliste (OF13, Punkte 1–7) am Fahrzeug.
- Bestehende Fahrzeuge brauchen einmalig bluez und die Gruppen `input`/`bluetooth`,
  siehe Docs/OnboardFlow.md.
- Nicht ausgerollt.
