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
| `inspector/` | AP10: Eigenschaftsinspektor, Steuerungsmodi, Kanalbindungen, Formelfeld (AP06), LiDAR-Widgetparameter. |
| `timeline/` | AP10: Clips, Spuren, Keyframes, Auslöser und Scrubbing im Gestaltungsmodus. |
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
IndexedDB `signalrc-overlay`/`backups`, ≤ 1 Schreibung/s, 5 je Fahrzeug;
`getState().backups` bietet sie nach dem Laden an (`continueFromBackup` nur bei
gleicher Basisrevision).

Andere Pakete rufen nie selbst `saveDraft`/`patchDraft` auf; sie ändern den
Store, der `SaveController` speichert.

## Eigenschaften und Bindungen (`inspector/`, AP10)

Reine Logik in `model.ts`, `formula.ts`, `channels.ts`; React in
`property-inspector.tsx` und `formula-field.tsx`. Kein eigener Dokumentzustand:
Zeilen werden aus `store.effective()`/`store.diagnostics()` abgeleitet, Änderungen
sind Befehle des Kerns (`setProperty`, `resetOverride`, `setAttribute`,
`setKeyframes`, `addClip`).

- `inspectElement(store, id, part?)` liefert je Katalogeigenschaft eine Zeile:
  Modus (`static|binding|rate|clip`), erlaubte Modi (Katalog), Grundwert,
  Herkunft (`default|standard|variant`), `inherited`/`overridden`/`resettable`,
  Clips mit Spur, `conflict` (mehrere Treiber) und zugehörige Diagnosen.
- `applyMode(store, row, mode, { clip? })` macht genau einen Modus zum Treiber
  (D12) – **ein** Undo-Schritt: zuerst Spuren anderer Clips bzw. Bindung/Rate
  entfernen, dann den neuen Treiber setzen; ohne Clip wird ein neuer Auto-Clip
  angelegt. Ausdruck bleibt beim Wechsel Bindung ↔ Rate erhalten.
- Einzelbefehle: `staticCommand` (setzt bei Treibern nur `base`), `resetCommand`
  (Variante → geerbter Wert, sonst Katalog-Default), `bindingCommand`,
  `exprCommand`, `smoothingCommand` (τ in (0, 60]), `rateCommand`, `wrapCommand`,
  `lidarSourceCommand`. Tippen fasst `mergeKey(row, feld)` zusammen.
- Grundwerte sind immer gültige Literale (`baseLiteral`): Defaults wie
  `center`, `fromSource`, `fromAsset` fallen auf einen neutralen Wert der Art
  zurück (Farbe `#ffffff`, Zahl 0 bzw. Minimum).
- Einfache Bindung ohne eigene Formel: `ChannelPicker` erzeugt `tel("…")`,
  `out("…")` oder `sig("…")` (`sourceExpr`/`simpleSource`), Auswahl passend
  zum Ergebnistyp (`bindableSources`). `valueText` übernimmt Einheit und
  Dezimalstellen wie die Laufzeit aus der ersten Abhängigkeit
  (`valueTextSourceDefaults`); Überschreiben über `unit`/`decimals`.
- Formelfeld: Live-Analyse des getippten Textes über AP06 `analyze` (eine
  Diagnose mit Offset), Übernahme bei Blur/Enter, Entwurf darf unvollständig
  sein. Live-Wert über AP06 `evaluate` gegen die Editor-Quelle (`source` des
  `OverlayEditor`), auch im Gestaltungsmodus; bei einem AP05-Provider werden die
  Abhängigkeiten nur angefordert, solange das Feld sichtbar ist.
  Nicht darstellbare Werte zeigen `OVL_RUNTIME_INVALID_VALUE`.
- Kanalliste: `ChannelDirectory` aus `OverlayEditor.channels`, sonst
  `source.channels()` (AP05-Provider) bzw. `resolveContext.sources`;
  `loadChannelDirectory(carId, fetchJson)` liest `GET api/cars/{carId}/overlay/sources`.
- LiDAR: Widgetparameter (Sektoren, Farben, Nahzone, Blinkfrequenzen,
  Nachleuchten, Sweep) sind normale Katalogeigenschaften im Abschnitt
  „Widget-Parameter“; Quelle ist das Attribut `source`. Zonengrenzen der Quelle
  werden nur angezeigt – quellseitige Parameter bleiben in der Kanalverwaltung (AP04).

## Zeitachse (`timeline/`, AP10)

Reine Logik in `timeline/model.ts`, React in `timeline-panel.tsx`.

- `listClips`/`clipInfo`: effektive Clips der aktiven Sicht mit `inherited`,
  `overridden` (Variantenfelder) und Diagnosen; `resetFieldCommand` setzt ein
  Variantenfeld zurück. Geerbte Clips werden in der Variante deaktiviert statt gelöscht.
- Einstellungen per `updateClip`: `durationCommand` (`scale` streckt Keyframes,
  `trim` schneidet ab und setzt den Wert am neuen Ende), `repeatCommand`
  (1–10000 oder `infinite`), `triggerModeCommand` (Bedingung bleibt erhalten),
  `conditionCommand`, `onDeactivateCommand` (D23), `retriggerCommand` (D11),
  `endState`, `disabled`, `name` über `settingsCommand`.
- Spuren: `trackCandidates` zeigt animierbare Eigenschaften samt aktuellem
  Treiber; `addTrack` übernimmt die Eigenschaft in einem Schritt (entfernt
  Bindung/Rate/fremde Spur, D12). Keyframe-Listen: `setKeyframeAt`,
  `moveKeyframe` (keine gleichen Zeiten, innerhalb `[0, durationS]`),
  `removeKeyframe` (letzter entfernt die Spur), `setKeyframeValue`,
  `setKeyframeEasing`; geschrieben wird mit `setKeyframes`. Ziehen eines
  Keyframes ist eine Transaktion (Escape bricht ab).
- Scrubbing (runtime §7): `scrubTo(store, clip, τ)` setzt `store.setScrub` für
  genau einen Clip (geklemmt); die Gestaltungsfläche rendert über AP08
  `baseFrame(scrub)`. Nicht undo-fähig, kein Dokumentinhalt. `pruneScrub`
  entfernt ihn, wenn der Clip verschwindet; „Grundwerte zeigen“ beendet ihn.

`OverlayEditor` bindet `PropertyInspector` (rechte Spalte) und `TimelinePanel`
(unter der Fläche) ein; der in der Zeitachse gewählte Clip ist Ziel des
Modus „Clip“ im Inspektor.

## Tests

`npx vitest run src/components/overlay/editor`. Live-Test des HTTP-Ports:
`SIGNALRC_LIVE_URL=http://127.0.0.1:<port> SIGNALRC_TEST_POSTGRES=… npx vitest run src/components/overlay/editor/persistence/live-server.test.ts`.
