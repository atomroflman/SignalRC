# Overlay-Paketaustausch (AP12)

Export und sicherer Import vollständiger HUD-Designs im Austauschpaket
(`Shared/Overlay/svg/README.md` §7, D19, D34). Kein eigener Dokumentzustand und
keine eigene Speicherung: der Import ändert den Entwurf ausschließlich über den
Editor-Befehl `replaceDocument` (ein Undo-Schritt), gespeichert wird vom
AP09-`SaveController` (nächstes Speichern per PUT). Veröffentlicht wird nie.

| Datei | Inhalt |
| --- | --- |
| `package.ts` | Paketformat, Grenzen (13 MB Datei, 2 MB Dokument, 10 MB Assets), `exportPackage`, `collectAssetTexts`, `parsePackage`, `packageSourceFor`. |
| `references.ts` | Referenzen eines Dokuments (Telemetrie, Ausgänge, Streams, Assets) und Umbenennung; Formeln über den AST (nur Textliteral-Argumente von `tel()`/`out()`). |
| `import.ts` | `prepareImport` (AP01-Strukturprüfung, Assets erneut über `POST …/overlay/assets`), `suggestMapping`, `evaluateImport` (Zuordnung, Diagnosen am Zielfahrzeug), `commitImport`. |
| `vehicle.ts` | `fetchVehicleSources`: Kanalkatalog `GET api/cars/{carId}/overlay/sources` (AP05) plus Streamliste des Hosts. |
| `package-exchange.tsx` | `PackageExchange` (Export-Schaltfläche, Dateiauswahl) und `ImportDialog` (Zuordnung, ungelöste Referenzen, Vorschau, Bestätigung). |

## Export

`exportPackage(doc, assetTexts, vehicle)` übernimmt Standard, Varianten,
Signale, Bindungen, Raten, Clips und alle referenzierten Assets. Fehlt ein
Asset-Text, wird nicht exportiert (`PKG_ASSETS_MISSING`); `collectAssetTexts`
lädt fehlende Texte nach. Der `source`-Block nennt nur referenzierte Streams,
Kanäle und Ausgänge mit Metadaten des Ausgangsfahrzeugs als Zuordnungshilfe.
Das Paket enthält keine Revision, Livewerte, Benutzer, Berechtigungen oder
persönlichen Einstellungen (die HUD-Sichtbarkeit liegt browserlokal, nicht im
Dokument). `locked`/`editorHidden` sind Gestaltungszustand des Dokuments und
bleiben erhalten.

## Import

1. `parsePackage(text)`: Größe, JSON, `format`/`formatVersion`/`kind`;
   ungültige Asset-Einträge werden ignoriert und gemeldet.
2. `prepareImport(pkg, upload)`: Strukturfehler (AP01) brechen ab, bevor etwas
   hochgeladen wird. Jedes **referenzierte** Asset geht erneut durch die
   normale Serverbereinigung; abweichende `assetId`s werden ersetzt
   (`data-part` bleibt Quell-ID, Teile bleiben stabil). Abgelehnte oder
   fehlende Assets bleiben ungelöste Referenzen (`OVL_REF_UNKNOWN_ASSET`).
3. `evaluateImport(prepared, mapping, vehicle)`: Umbenennung von Kanälen,
   Ausgängen und Variantenschlüsseln; Prüfung mit dem Kontext des
   Zielfahrzeugs (Quellen, Streams, Assets, AP06-Analyse). `blocking` sind die
   `publish`-Diagnosen – ungelöste aktive Referenzen blockieren die
   Veröffentlichung (Client `canPublish`, Server `PublishAsync`). In
   deaktivierten Teilen sind sie nur Warnungen; nicht zugeordnete Streams
   bleiben als verwaiste Varianten erhalten (D53).
4. `commitImport(store, evaluation)`: `replaceDocument` mit Grund `import`.
   Der Host übernimmt die neuen Assets über `onAssets` in seine Asset-Map.

Eine lokale Konfliktsicherung von AP09 (`kind: "backup"`, Download in
`SaveNotices`) hat dasselbe Format und lässt sich genauso als Entwurf
importieren.

## Tests

`npx vitest run src/components/overlay/exchange` – Rundlauf, Zuordnung,
Veröffentlichungssperre, Grenzen (`fixtures/exchange/roundtrip.json`).
Serverseite mit echter Bereinigung: `dotnet test Tests/SignalRC.Overlay.Tests
--filter FullyQualifiedName~Exchange` (SQLite, mit `SIGNALRC_TEST_POSTGRES`
zusätzlich PostgreSQL).
