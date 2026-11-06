# Fahrzeug-Flow und lokaler Controller

Stand: 2026-11-06. Plan und Arbeitspakete: [OnboardFlow-Arbeitspakete.md](../OnboardFlow-Arbeitspakete.md).
Branch: `feature/onboard-flow`. Nicht ausgerollt.

## Wozu

Ein Controller, der direkt am Fahrzeug gekoppelt ist (Bluetooth oder USB), steuert
das Fahrzeug ohne Umweg über den Server. Das funktioniert auch dann, wenn niemand
am PC sitzt.

Dafür hat das Fahrzeug eine eigene Flow-Engine. Der Flow eines Users besteht aus
zwei Teilen, die im selben Editor bearbeitet werden:

- **Browser-Teil**: läuft wie bisher im Browser des Fahrers.
- **Fahrzeug-Teil**: läuft auf dem Fahrzeug mit 50 Hz. Er liest die Controller am
  Fahrzeug und die lokale Telemetrie direkt.

## Regeln

- Werte fließen nur von oben nach unten: Browser → Browser, Browser → Übergabe →
  Fahrzeug, Fahrzeug → Fahrzeug. Der Server lehnt alles andere ab.
- Ein Fahrzeugkanal gehört genau einem Teil.
  - Gehört er dem Browser, kommt er wie bisher direkt vom Browser.
  - Gehört er dem Fahrzeug, ignoriert das Fahrzeug Werte aus dem Browser für diesen Kanal.
- Der Fahrzeug-Teil wird bei jeder Übernahme der Steuerung ans Fahrzeug geschickt,
  und nach jeder Änderung im Editor sofort noch einmal. Der aktuelle Gang und
  andere Zustände bleiben dabei erhalten.
- Gemischt wird nur, was der Flow festlegt. Typisch ist:
  `Controller-Lenkung → Aktiv?` → `Vorrang.aActive`,
  `Controller-Lenkung → Vorrang.a`, `Übergabe Lenkung → Vorrang.b`.
  Dann übersteuert der lokale Controller das Web, solange er bewegt wird, und
  noch zwei Sekunden danach.

## Betriebsarten

| Anzeige | Bedeutung |
| --- | --- |
| Browser → Hardware | Der Flow hat keinen Fahrzeug-Teil. Alles läuft wie bisher. |
| Browser → Fahrzeug-Flow (Mischbetrieb) | Web und lokaler Controller wirken gleichzeitig, so wie der Flow es festlegt. |
| Web abgekoppelt – Fahrzeug-Flow lokal | Nur der Fahrzeug-Teil läuft. Browser-Kanäle sind neutral, Übergaben liefern 0. |

- **„Web abkoppeln“** gibt es auf der Fahrseite und im Flow-Editor. Abkoppeln
  geht nur, wenn das Fahrzeug einen Fahrzeug-Teil geladen hat.
- **Fällt der Server aus:**
  - Im Mischbetrieb gehen die Browser-Kanäle auf neutral, der Fahrzeug-Teil läuft weiter.
  - Bei abgekoppeltem Web ändert sich nichts.
- **Neustart des Onboards:** Danach ist nichts abgekoppelt und kein Fahrzeug-Flow
  geladen, bis der nächste Fahrer die Steuerung übernimmt.
- **Session-Timeout:** Eingaben am lokalen Controller halten die Session aktiv.

## Live-Werte im Editor

Werte des Fahrzeug-Teils kommen vom Fahrzeug: bis zu 5-mal pro Sekunde, mit allen
Ausgängen eines Knotens, also auch `connected`, `valid` oder dem Gang. Das Fahrzeug
schickt sie **nur, solange irgendwo ein Flow-Editor für das Fahrzeug offen ist**. Beim
normalen Fahren kosten sie keine Bandbreite. Betriebsart, Übergabe- und Controller-
Status gehen immer mit, wenn sie sich ändern. Übergabe-Knoten zeigen den Wert, den
das Fahrzeug tatsächlich bekommt.

## Controller koppeln

Flow-Editor → „Fahrzeug-Controller“ → „Bluetooth“. Das braucht die aktive
Fahrzeugsteuerung.

1. Controller in den Kopplungsmodus bringen.
2. „Suchen“ drücken.
3. Beim Gerät „Koppeln“ drücken. Das koppelt, vertraut und verbindet in einem Schritt.

Danach meldet das Fahrzeug den Controller mit seinen Achsen und Tasten. Sie
erscheinen im Panel und können als Knoten in den Fahrzeug-Teil gelegt werden.
Der Controller gehört dem Fahrzeug, jeder Fahrer kann ihn in seinem Flow benutzen.

Wertebereiche:
- Achsen: −1 … 1
- Trigger: 0 … 1
- Tasten: 0 oder 1

Jeder Controller-Knoten hat zusätzlich den Ausgang `connected`.

Trennen lässt sich ein Bluetooth-Controller, etwa ein PS4-Controller, der sich nicht
ausschalten lässt, auf zwei Wegen:

- im Panel „Fahrzeug-Controller“ über „Trennen“ beim verbundenen Gerät; dafür ist die
  aktive Steuerung nötig;
- im Fahrzeug-Teil des Flows mit der Funktion „Controller trennen“
  (`DisconnectController`). Bei einer steigenden Flanke an `trigger` werden die
  Controller getrennt, die zu `device` passen (Namensteil oder Adresse; leer = alle).
  Beispiel: `BTN_MODE` (PS-Taste) → Controller trennen. Das funktioniert auch bei
  abgekoppeltem Web.

Für HUD und Telemetrie gibt es den Telemetrie-Typ `VehicleControllerReader`. Er
liefert `1`/`0`, ob ein Controller verbunden ist. Mit `Device` lässt er sich auf
einen Controller eingrenzen, über einen Namensteil oder die Bluetooth-Adresse.
Mit `report=Count` liefert er die Anzahl der verbundenen Controller.

## Voraussetzungen auf dem Fahrzeug

`scripts/onboard-setup-bluetooth.sh` richtet alles ein. `install.sh` und
`sudo ./update.sh` rufen es bei jedem Lauf auf einer Onboard-Installation auf:

- bluez installieren, falls es fehlt
- den Service-User in die Gruppen `input` und `bluetooth` aufnehmen; das wirkt ab dem
  Neustart des Dienstes, den `update.sh` danach ohnehin macht
- die rfkill-Sperre für Bluetooth aufheben
- `bluetooth.service` aktivieren und den Adapter einschalten

Das Skript lässt sich mehrfach ausführen und bricht weder Installation noch Update
ab. Von Hand:

```bash
sudo bash scripts/onboard-setup-bluetooth.sh <service-user>
sudo systemctl restart signalrc-onboard
```

Die aufgehobene Sperre hält über Neustarts: `systemd-rfkill` speichert den
Zustand unter `/var/lib/systemd/rfkill/` und stellt ihn beim Booten wieder her.
Das Self-Update des Onboards (Docs/OnboardAutoUpdate.md) läuft ohne root und
führt das Skript nicht aus.

Ist der Adapter per rfkill gesperrt (`bluetoothctl show` zeigt `PowerState: off-blocked`),
meldet das Bluetooth-Panel genau das. Auf Raspberry Pi OS passiert das, solange kein
WLAN-Land gesetzt ist. Das Onboard läuft nicht als root und kann die Sperre deshalb
nicht selbst aufheben.

Der Server braucht die Migration `AddOnboardFlow`. Sie läuft beim Start mit.

## Technik

| Teil | Ort |
| --- | --- |
| Verträge | `Shared/Flow/*`, Hub-Methoden in `IControlClient` / `IConnectionHubServer` |
| Engine | `Onboard/Flow/FlowEngine.cs`, Funktionen in `Onboard/Flow/FlowFunctions.cs` |
| Laufzeit | `Onboard/Flow/OnboardFlowService.cs` (Takt, Übergaben, Abkoppeln, Status) |
| Controller | `Onboard/Input/Evdev.cs`, `Onboard/Input/VehicleInputService.cs` |
| Bluetooth | `Onboard/Input/BluetoothService.cs` (`bluetoothctl`) |
| Server | `FlowZoneRules`, `OnboardFlowBuilder`, `OnboardFlowPublisher`, `CarConnectionHub.OnboardFlow.cs` |
| Client | `control-flow-store.ts`, `onboard-flow-status.tsx`, `vehicle-inputs-view.tsx`, `bluetooth-panel.tsx`, `flow-zone-rules.ts` |

Die Funktionen gibt es in TS und C#. `Shared/FlowParity/cases.json` hält
gemeinsame Referenzfälle, die vitest **und** xunit prüfen. Für jede neue Funktion
gehört dort ein Fall dazu.

Abweichung vom Plan (T11/T12): Der Geräteschlüssel besteht aus `uniq`
(BT-Adresse) **plus Gerätename**, ohne `uniq` aus `vendor:product/Name`. So
unterscheiden sich der Gamepad- und der Bewegungssensor-Knoten desselben
Controllers.

Funktionsänderung nebenbei: Der Browser liest die Parameter `steps` und
`isLeftTurn` von `TurnSignal` jetzt aus dem gespeicherten Text. Bisher galten dort
immer 5 und „links“.
