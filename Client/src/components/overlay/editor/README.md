# Overlay-Editor – Grundlage (AP09)

Gemeinsamer Editorzustand, Befehle, Undo/Redo, Gestaltungsfläche und
Speicherung. AP10–AP12 bauen hierauf auf und führen **keinen** eigenen
Dokumentzustand und **keine** eigene Speicherlogik.

| Verzeichnis | Inhalt |
| --- | --- |
| `core/` | Reiner Kern ohne React: `EditorStore`, Befehle (`commands.ts`), Geometrie, Werkzeuge, JSON-Patch. |
| `persistence/` | Persistenz-Port (HTTP gegen AP02), `SaveController` (Autosave, Konflikt, Kontrollverlust), lokale Sicherungen (IndexedDB). |
| `canvas/` | React-Bausteine: Gestaltungsfläche, Ebenen, Transformation, Varianten, Status/Dialoge, Texte (`messages.ts`). |
| `testing/` | `InMemoryOverlayServer`/`InMemoryOverlayPersistence`, `MemoryBackupStore`. |
| `overlay-editor.tsx` | Einbettbare Komponente `OverlayEditor` (ohne Route, Navigation, Steuerungspause – AP13). |

## Zustand lesen

```ts
const store = new EditorStore({ carId, document });
store.getState();     // { document, activeVariant, selection, scrub, view, history, version, lastError }
store.subscribe(fn);  // Änderungssignal; React: useEditorState(store) aus canvas/hooks.ts
store.effective();    // EffectiveConfig der aktiven Sicht (AP01-Resolver, gecacht je Dokument)
store.diagnostics();  // validate() mit setResolveContext({ sources, streams, assets, expressions })
```

`activeVariant` ist `null` (Standard) oder eine `StreamId`. Die Auswahl gilt
für die aktive Sicht, Reihenfolge unten → oben. Auswahl, Sicht, Zoom/Pan,
Raster und `scrub` (Gestaltungsmodus, AP10-Zeitachse über `setScrub`) sind
Editorzustand und nicht undo-fähig.

## Ändern: nur über Befehle

```ts
store.dispatch({ type: "setProperty", element: "e_x", property: "rotation", value: 45 });
// → { ok: true } | { ok: false, error: CommandError }  (auch in state.lastError)
```

- Ohne `variant` wirkt ein Befehl in der aktiven Sicht; der Store hält die
  konkrete Sicht im Verlauf fest. In einer Variante schreiben Befehle nur
  Abweichungen: Überschreibungen geerbter Elemente/Clips, `addedElements`,
  `structure.parents/order`, `addedClips`.
- `name`, `source`, `assetId` sind nicht variantenfähig und ändern immer das
  Element selbst. `value: undefined` entfernt einen Wert (Katalog-Default bzw.
  geerbter Wert); `resetOverride`/`resetStructure` setzen Variantenabweichungen zurück.
- Dynamische Eigenschaften: `withBase(current, wert)` ersetzt nur `base` und
  behält den Treiber.
- Der Store lehnt Befehle ab, die **neue** `structure`-Diagnosen erzeugen
  (Fehlercode der Diagnose in `lastError`). `publish`-Fehler (z. B.
  unvollständige Formeln) sind im Entwurf erlaubt.
- Befehlsliste: `types.ts` (`EditorCommand`). Löschen im Standard nutzt AP01
  `deleteElements`; in einer Variante sind nur eigene Elemente löschbar,
  geerbte werden dort deaktiviert (`canvas/actions.ts` `planDelete`).

## Undo/Redo und Gruppierung

- Jeder Befehl ist ein Schritt, höchstens 200 (D55), nur im Speicher des Tabs.
- Mehrteilige Interaktionen: `beginTransaction(label)` … `commitTransaction()`
  ergeben genau einen Schritt (Drag, Werkzeuge mit mehreren Befehlen,
  `dispatchAll`); `cancelTransaction()` verwirft (Escape). Verschachtelbar.
- Tippen in Zahlenfeldern: `dispatch(cmd, { mergeKey })` fasst Befehle mit
  gleichem Schlüssel innerhalb von 1 s zusammen.
- Undo stellt Auswahl und Sicht des Schritts wieder her. `store.load(doc)` ersetzt
  ohne Schritt und leert den Verlauf (Laden vom Server); `replaceDocument`
  (Import AP12, Sicherung) ist ein Schritt und erzwingt das nächste Speichern per PUT.

## Werkzeuge (`core/tools.ts`)

Reine Funktionen, die Befehle berechnen: `moveCommands`, `resizeCommand`
(Rechteck/Ellipse/Balken über Breite/Höhe, sonst Skalierung, Gegenseite bleibt
stehen), `rotateCommand`, `alignCommands`, `distributeCommands`,
`arrangeCommand`, `groupCommand` (fester Pivot in der Mitte), `duplicateCommand`
(kopiert die effektiven Werte; in einer Variante als eigene Elemente),
`newElement`, `newElementId`/`newClipId` (`e_`/`c_` + 10 Zeichen). Geometrie
(`core/geometry.ts`): `layout`, `hitTest`, `marqueeSelect`, `decompose` – gleiche
Boxregeln wie die AP08-Szene; SVG-Assets brauchen `setGeometryContext({ assets })`.

## Speichern (`persistence/`)

`SaveController({ store, persistence, backups })`, `open()` lädt den Entwurf.
Status nach api/README §5: `unsaved`, `saving`, `saved`, `error`, `conflict`,
`localOnly` (plus `loading`). Autosave 2 s nach der letzten, spätestens 30 s
nach der ersten ungespeicherten Änderung; PATCH mit der Differenz, PUT beim
ersten Speichern nach Laden/Ersetzen, bei großem Patch und einmal nach
`OVL_API_PATCH_FAILED`. Konflikt (409, fremdes `OverlayDraftChanged`, andere
Revision nach Reconnect/Kontrollrückkehr): Autosave pausiert, Sicherung wird
geschrieben, `backupPackage()` zum Download, `loadServerState()` (Server gewinnt).
Kontrolle: `setControl(bool)` aus der Anwendung (AP13, `CarStateUpdated`) oder
`403 OVL_API_NOT_DRIVER` – danach keine Serverzugriffe. Lokale Sicherungen:
IndexedDB `signalrc-overlay`/`backups`, ≤ 1 Schreibung/s; je Sitzung wird
die eigene Sicherung überschrieben, Konfliktsicherungen bleiben getrennt
erhalten, aufbewahrt werden die letzten 5 Sitzungen je Fahrzeug (D72);
`getState().backups` bietet sie nach dem Laden an (`continueFromBackup` nur bei
gleicher Basisrevision).

Andere Pakete rufen nie selbst `saveDraft`/`patchDraft` auf; sie ändern den
Store, der `SaveController` speichert.

## Tests

`npx vitest run src/components/overlay/editor`. Live-Test des HTTP-Ports:
`SIGNALRC_LIVE_URL=http://127.0.0.1:<port> SIGNALRC_TEST_POSTGRES=… npx vitest run src/components/overlay/editor/persistence/live-server.test.ts`.
