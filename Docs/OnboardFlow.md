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

## Voraussetzungen auf dem Fahrzeug

`install.sh` richtet das bei Neuinstallationen ein. Bei bestehenden Fahrzeugen
einmal von Hand:

```bash
sudo apt-get install -y bluez
sudo usermod -aG input,bluetooth <service-user>
sudo systemctl enable --now bluetooth
sudo systemctl restart signalrc-onboard   # damit die Gruppen greifen
```

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
