# Overlay-Vorschau und lokale Simulation (AP11)

Laufende Vorschau des ganzen HUDs mit derselben Laufzeit wie die Fahreransicht
(Laufzeitvertrag §7) und lokale Testwerte nach Overlay-Feature.md „Lokale
Simulation“. Simulation ist ausschließlich lokal: kein Telemetrie-Schreiben,
keine Änderung persönlicher Kanalauswahl, keine Steuerbefehle, kein Eintrag im
gemeinsamen Live-Wertebestand.

| Datei | Inhalt |
| --- | --- |
| `types.ts` | `SimulationSettings`, `ChannelOverride`, `Generator`, Qualitäten |
| `generators.ts` | Fester Wert, Regler, Rampe (Sägezahn/Dreieck), Sinus – reine Funktionen der Vorschauzeit |
| `lidar-synth.ts` | Synthetische Grundraster im Drahtformat (LiDAR §4, §5), dicht/dünn wie vereinbart |
| `preview-clock.ts` | `PreviewClock`: Pause, Schritt, Geschwindigkeit über einer Basisuhr |
| `preview-source.ts` | `PreviewSourceProvider`: kanalweise Overrides über der Live-Quelle (AP05) |
| `session.ts` | `PreviewSession`: Modus Gestaltung ↔ Vorschau, Einstellungen, Uhr |
| `simulation-panel.tsx`, `overlay-preview.tsx`, `editor-with-preview.tsx` | UI |
| `messages.ts` | Texte de/en (AP13 übernimmt sie zentral) |

## Verwendung

```tsx
<OverlayEditorWithPreview carId={id} persistence={p} hasControl locale="de"
  liveSource={provider}              // CarSourceProvider aus sharedSourceHub().acquire(id)
  videoLayer={(hud) => <MyVideo>{hud}</MyVideo>} />  // optional, AP13
```

Ohne Wrapper: `new PreviewSession({ live })`, `<SimulationPanel>` als Kind des
`OverlayEditor` und `<OverlayPreview>` als `stage`-Prop des `OverlayEditor`
(ersetzt die Gestaltungsfläche, solange die Vorschau läuft).

## Regeln

- **Overrides je Wert** (`tel:`, `out:`, `sig:` + Name). Nicht überschriebene
  Werte kommen aus der Live-Quelle. Der Testmodus `simulateAll` simuliert alle
  benötigten Werte mit Standardgeneratoren (LiDAR: zwei Hindernisse,
  `driverActive()` = wahr).
- **Bedarf:** Die Vorschau meldet bei der Live-Quelle nur die **nicht**
  simulierten Werte an (Konsument `preview:<id>`, D59 „Editor-Vorschau“).
  Simulierte Kanäle erzeugen keinen Übertragungsbedarf; simulierte
  `out()`/`sig()` kein `SetControlDisplayInterest`. Die persönliche Auswahl der
  Leiste (`SubscribeToChannel`) wird nie berührt.
- **Qualität:** Simulierte Telemetrie durchläuft dieselbe Bewertung wie echte
  Samples (`evaluateSample`, Telemetrievertrag §3): `valid`, `unchecked`,
  `missing` (NoData), `error` (Quellfehler), `stale` (Alter > Frist; Frist inkl.
  HUD-`staleAfterMs`). Ein festes Alter (`ageMs`) prüft Fristen; nicht
  parsbarer Text simuliert `parse`. Steuerwerte: zusätzlich `paused`.
- **Zeit:** Generatoren sind Funktionen der Vorschauzeit `t` (s, ab Eintritt in
  die Vorschau bzw. Neustart = neue Anzeigesitzung). Pause friert die Zeit ein,
  Live-Werte werden weiter angezeigt; Schritt = 1/30 s oder 1 s;
  Geschwindigkeit 0,1×–4×. Mit `TestClock` als Basisuhr sind Verläufe
  reproduzierbar.
- **Kein Dokumentinhalt:** Simulationseinstellungen sind Tab-Zustand, laufen
  nicht über Editor-Befehle, Undo, Autosave oder Paketexport.
- **Kein Gestalten in der Vorschau:** Die Gestaltungsfläche (Griffe,
  Drag-and-drop, Tastenkürzel der Fläche) ist während der Vorschau ersetzt.

## Tests

`npx vitest run src/components/overlay/preview` – `safety.test.ts` prüft gegen
den echten AP05-Provider auf einem protokollierenden `FakeHub` die Abnahme.
