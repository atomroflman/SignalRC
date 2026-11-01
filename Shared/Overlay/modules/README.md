# Overlay-Module v1: Schnittstellen, Dateiverantwortung, Tests, Leistung

Status: **Entwurf**, Teil von AP00, noch nicht freigegeben. Ergänzt
[Overlay-Arbeitspakete.md](../../../Overlay-Arbeitspakete.md). Die Signaturen sind
verbindliche Rollen. Konkrete Hilfstypen darf das zuständige Paket ergänzen,
ohne die Rolle zu ändern.

## 1. Modulschnittstellen

Notation TypeScript; C#-Gegenstücke sind gleichnamig in PascalCase.

```ts
// AP01 – Dokumentauflösung (TS: Client; C#: Server, gleiche Fixtures)
interface DocumentResolver {
  validate(doc: unknown, ctx: ResolveContext): Diagnostic[];          // Schema + structure + publish
  resolve(doc: OverlayDocument, streamId: string, ctx: ResolveContext):
    { kind: "none"; reason: "noDocument" | "vehicleDisabled" | "variantDisabled" }
  | { kind: "hud"; config: EffectiveConfig; diagnostics: Diagnostic[] };
  deletionImpact(doc: OverlayDocument, elementIds: string[]): DeletionImpact;
}
interface ResolveContext {
  catalog: PropertyCatalog;
  streams: string[];                          // bekannte StreamIds (D53)
  sources: SourceCatalog;                     // tel-Kanäle mit DataType, out-Namen
  assets: Record<string, AssetMetadata>;
}

// AP06 – Ausdrücke (TS + C#, identische Semantik)
interface ExpressionEngine {
  analyze(expr: string, env: SourceCatalog & { signals: string[] }, expected: ExpectedKind): Analysis;
  evaluate(analysis: Analysis, src: ValueSource): RuntimeValue;     // nur TS
}

// AP05 – Telemetrie- und Steuerungsquellen (Client)
interface ValueSource {
  get(kind: "tel" | "out" | "sig", name: string): SourceValue;      // { state, paused, value, reason }
  driverActive(): SourceValue;
}
interface OverlaySourceProvider extends ValueSource {
  require(consumerId: string, deps: Dependency[]): { release(): void };
  metadata(name: string): ChannelMetadata | undefined;
  subscribe(listener: () => void): () => void;                      // Änderungs-Signal, kein Polling
}

// AP08 – Uhr und Renderer
interface Clock { now(): number; onFrame(cb: (t: number) => void): () => void; }
// React: <OverlayRenderer config assets source clock mode locale scrub? onDiagnostics? />
//   mode: "live" | "preview" | "design"; scrub: { clipId, tau } nur in "design"
// rein funktional für Tests: createRuntime(config, assets).step(t, source) → FrameResult

// AP09 – Editor-Kern
interface EditorStore {
  state: EditorState;                         // Dokument, Auswahl, aktive Variante, Speicherstatus
  dispatch(cmd: EditorCommand): void;         // einziger Änderungsweg, Undo-fähig
  undo(): void; redo(): void;
}
// EditorCommand (diskriminierte Union): setProperty, resetOverride, setAttribute,
// addElements, deleteElements, groupElements, ungroup, reparent, reorder,
// addClip, updateClip, removeClip, setKeyframes, setSignals, setSourceSettings,
// setWorkspace { mode: "areaOnly" | "fitContent" }, setVariant, removeVariant,
// reassignVariant, replaceDocument. Mehrteilige Interaktionen über
// beginTransaction()/commitTransaction() zu einem Undo-Schritt.

// AP02 (Server) / AP09 (Client-Adapter) – Persistenz
interface OverlayPersistence {
  getPublished(carId: number): Promise<Published | null>;
  getDraft(carId: number): Promise<Draft>;
  saveDraft(carId: number, doc: OverlayDocument, baseRevision: number): Promise<{ revision: number }>;
  publish(carId: number, baseRevision: number, note?: string): Promise<{ publicationId: number; number: number }>;
  listPublications(carId: number): Promise<PublicationInfo[]>;
  restore(carId: number, publicationId: number, baseRevision: number): Promise<{ revision: number }>;
  uploadAsset(carId: number, file: Blob): Promise<AssetUploadResult>;
  getAsset(carId: number, assetId: string): Promise<string>;
  onEvent(carId: number, cb: (e: OverlayEvent) => void): () => void;
}
```

```csharp
// AP07 – SVG (Server)
public interface ISvgAssetSanitizer { SvgSanitizeResult Sanitize(ReadOnlySpan<byte> raw); }

// AP04 – LiDAR (Onboard), rein funktional testbar
public static class LidarGridBuilder { public static LidarGrid Build(LidarScan raw, LidarGridOptions o); }

// AP03 – Qualität (Onboard)
// TelemetryReaderBase.ReadAllSamplesAsync(string channelKey) → IReadOnlyDictionary<string, TelemetrySample>?
```

Testdoubles: Jedes Paket liefert für seine Schnittstelle ein Testdouble im
eigenen Verzeichnis (`testing/`): `FakeValueSource`, `TestClock`,
`InMemoryOverlayPersistence`, `FakeSvgAssetSanitizer`, `FakeLidarSource`.

Diagnoseformat und Codes: Dokumentmodell §8, Ausdrücke §7, API §3, SVG §6.

## 2. Dateiverantwortung (bestätigte Pfade)

| Pfad | Paket |
| --- | --- |
| `Shared/Overlay/` (Verträge, Schema, Katalog, Fixtures) | AP00; Änderungen nur koordiniert |
| `Client/src/components/overlay/document/` | AP01 |
| `Server/Overlay/Documents/` | AP01 |
| `Server/Overlay/` (Persistenz, `OverlayAccess.cs`, `Controllers/OverlayController.cs`) | AP02 |
| `Server/Data/Overlay*.cs`, `Server/Data/EntityMapping/Overlay*Mapping.cs`, `Server/Migrations/*Overlay*` | AP02 (allein) |
| `Shared/Telemetry/` (Wire-DTOs `TelemetrySample`, `TelemetryBatch`, `ControlDisplay*`) | AP03 |
| `Onboard/Telemetry/TelemetryReaderBase.cs`, `TelemetryService.cs` und Reader-Qualität | AP03 |
| Telemetrie-/Steuerungsanzeige-Methoden im Hub | AP03 (als partielle Klasse `CarConnectionHub.Overlay.cs`) |
| `Onboard/Telemetry/LidarGrid/` | AP04 |
| `Shared/Channels/TelemetryDataType.cs` (`LidarGrid = 4`) | AP04 |
| `Client/src/components/telemetry-store.ts`, `Client/src/components/overlay/sources/` (inkl. LiDAR-Raster-Decoder) | AP05 |
| `Client/src/components/overlay/expression/` | AP06 |
| `Server/Overlay/Expressions/` | AP06 |
| `Server/Overlay/Assets/` | AP07 |
| `Client/src/components/overlay/runtime/` (inkl. LiDAR-Widget) | AP08 |
| `Client/src/components/overlay/editor/core/` | AP09 |
| `Client/src/components/overlay/editor/inspector/`, `…/timeline/` | AP10 |
| `Client/src/components/overlay/preview/` | AP11 |
| `Client/src/components/overlay/templates/`, `…/exchange/` | AP12 |
| `video-stream.tsx`, `car-video-panel.tsx`, `pages/car/[carId]/overlay.tsx`, `control-flow-store.ts`, Flow-Knoten „HUD-Signal“, Program-/Hub-Verdrahtung, Übersetzungen | AP13 |
| `Tests/`, `Client/e2e/`, CI | AP14 |

Hub-Erweiterungen erfolgen als partielle Klassen je Paket
(`CarConnectionHub.<Bereich>.cs`), damit nicht mehrere Pakete dieselbe große
Datei ändern. Dafür macht AP13 `CarConnectionHub` einmalig `partial` und
verdrahtet die Registrierungen zentral. Übersetzungstexte liefern die Pakete als
eigene Teildateien; AP13 bindet sie ein.

## 3. Testwerkzeuge

Im Repo gibt es heute weder Testprojekte noch CI. Festgelegt sind folgende
Entwicklungswerkzeuge; Laufzeitabhängigkeiten kommen nicht hinzu:

| Bereich | Werkzeug | Ort |
| --- | --- | --- |
| C#-Modultests | xUnit | `Tests/SignalRC.Overlay.Tests/` (referenziert Shared, Server, Onboard; in `SignalRC.sln`) |
| TS-Modultests | Vitest (jsdom, wo nötig) | `*.test.ts(x)` neben dem Code; `Client/vitest.config.ts` |
| Browser/Leistung | Playwright (Chromium) | `Client/e2e/` |
| Fixture-Konformität | je ein Test in C# und TS, der alle `Shared/Overlay/fixtures/**/cases.json` ausführt | jeweils im Paket der getesteten Schnittstelle |

**Erstes Teilpaket T0 von AP14**, Voraussetzung für M1:

- die drei Testgerüste mit je einem Beispieltest anlegen,
- Skripte `npm test` und `npm run e2e` sowie `dotnet test` bereitstellen.

Bis T0 vorliegt, implementieren andere Pakete gegen die Fixtures, ohne eigene
Testinfrastruktur anzulegen. CI wird erst nach gesonderter Abstimmung eingerichtet.

## 4. Leistungsprofil (D21, D42)

| Referenz-HUD | Inhalt | Ziel (Chromium, 4× CPU-Drosselung) |
| --- | --- | --- |
| R1 | `fixtures/documents/valid/m2-value-and-rotation.json` | Frame-Intervall p95 ≤ 33,4 ms |
| R2 | `fixtures/documents/valid/reference-r2-typical.json` (Kompass, Pitch/Roll, Kettenlauf, 2 Anzeigen, 4 Werte, Warn-Clip, LiDAR 8 Sektoren mit Sweep) | p95 ≤ 33,4 ms |
| R3 | wird zur Testzeit an den D33-Grenzen erzeugt (500 Elemente, 200 Clips, 300 Formeln, 2 Assets à 2000 Elemente, LiDAR 24 Sektoren) | p95 ≤ 50 ms; Video spielt weiter |

Messaufbau:

- Viewports 412 × 915 bei DPR 2,625 und 1920 × 1080.
- Testvideo mit 30 fps lokal; Quellen über `FakeValueSource`: 10 Hz je Kanal,
  LiDAR mit 5 Hz synthetisch.
- 5 s Aufwärmen, danach 60 s messen.

Zusätzlich geprüft:

- Bei verborgenem Tab und ausgeblendetem HUD laufen 0 HUD-Frames.
- Das JS-Heap-Wachstum über 10 min bleibt unter 10 MB.
- Die LiDAR-Kanalbandbreite liegt bei höchstens 8 kB/s (gemessen am Websocket).

Vor der Abnahme kommt ein manueller Lauf von R2 auf einem echten
Mittelklasse-Android-Gerät hinzu (D42), mit dokumentierter Gerätebezeichnung.
