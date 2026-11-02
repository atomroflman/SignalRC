# Overlay-Persistenz und API v1

Status: **freigegeben** (AP00, 2026-11-01), Vertrag v1.1 (Autosave als Differenz und Kompression, D63). Grundlage:
Produktplan (Berechtigungen, Entwurf, Veröffentlichung), D19, D25, D33–D35,
D47, D53–D55. Zuständig: AP02 (Server), AP09 (Client-Adapter), AP13 (Verdrahtung).

## 1. Berechtigungen

| Rolle | Prüfung | Darf |
| --- | --- | --- |
| Betrachter | `CanViewCarAsync(carId)`; heute wie Video: jeder Client | veröffentlichten Stand, dessen Assets, Ereignisse lesen |
| Verwalter | `RequireOverlayAdminAsync(carId)` | Entwurf, Verlauf, Speichern, Veröffentlichen, Wiederherstellen, Asset-Upload, LiDAR-Einrichtung |

Für Verwalter gelten drei Bedingungen, dieselben wie in
`EnsureDriverCanManageStreamAsync` (`CarConnectionHub.cs`):

1. regulärer Login (`LoginName` gesetzt),
2. Fahrzeugzugang (`UserSetups` für `carId`),
3. aktive Kontrolle (`User.ActiveVehicleId == carId`).

AP02 zieht beide Prüfungen in einen gemeinsamen Dienst
`Server/Overlay/OverlayAccess.cs`. Hub und Controller rufen ihn auf; die
bestehende Stream-Prüfung wird darauf umgestellt. Jede Verwaltungsanfrage wird
einzeln geprüft (keine Sitzungs-Caches).

## 2. Datenmodell (EF Core, PostgreSQL; nur AP02 schreibt Migrationen)

| Entität | Felder (Auszug) | Regeln |
| --- | --- | --- |
| `OverlayDraft` | `CarId` (unique), `Revision` (long), `DocumentJson` (text), `UpdatedAt`, `UpdatedByUserId` | genau ein Entwurf je Fahrzeug |
| `OverlayDraftRevision` | `CarId`, `Revision`, `DocumentJson`, `CreatedAt`, `UserId` | die letzten 50 je Fahrzeug (D35) |
| `OverlayPublication` | `Id`, `CarId`, `Number` (fortlaufend je Fahrzeug), `DocumentJson`, `SchemaVersion`, `PublishedAt`, `PublishedByUserId`, `Note` (≤ 500, D54), `SourceDraftRevision` | unveränderlich, unbegrenzt |
| `OverlayPublicationAsset` | `PublicationId`, `AssetId` | Asset-Menge der Veröffentlichung |
| `OverlayAsset` | `CarId`, `AssetId` (unique je Fahrzeug), `Svg` (text), `MetadataJson`, `Status` (`pending`/`active`), `CreatedAt`, `CreatedByUserId` | unveränderlich; Upload-Duplikate liefern das bestehende Asset |

Dokumente werden als `text` gespeichert, nicht als `jsonb`: `jsonb` ordnet
Schlüssel um, der Client vergleicht aber gegen das exakt gespeicherte Dokument
(PATCH, D63).

Der aktuell veröffentlichte Stand ist die `OverlayPublication` mit der höchsten
`Number`.

Asset-Aufräumen (täglicher Job und beim Speichern): `pending` älter als 24 h und
nirgends referenziert, sowie `active` ohne Referenz aus dem Entwurf, den
gehaltenen Revisionen oder einer Veröffentlichung, werden gelöscht.

## 3. REST (`[Route("api/cars/{carId:int}/overlay")]`, Stil wie `ChannelsController`)

| Methode | Pfad | Rolle | Ergebnis |
| --- | --- | --- | --- |
| GET | `published` | Betrachter | `200 { publicationId, number, publishedAt, document }` oder `204` |
| GET | `assets/{assetId}` | Betrachter* | `200 image/svg+xml` |
| GET | `draft` | Verwalter | `200 { revision, document, updatedAt, updatedBy }`; ohne Entwurf `revision: 0` und Startdokument (D22) |
| PUT | `draft` | Verwalter | Header `If-Match: "<revision>"`, Body Dokument → `200 { revision }` |
| PATCH | `draft` | Verwalter | Header `If-Match: "<revision>"`, Body `application/json-patch+json` (RFC 6902) → `200 { revision }` |
| GET | `publications` | Verwalter | `200 [{ id, number, publishedAt, publishedBy, note }]`, neueste zuerst |
| GET | `publications/{id}` | Verwalter | `200 { …, document }` |
| POST | `publications` | Verwalter | `{ baseRevision, note? }` → `201 { publicationId, number, warnings }` |
| POST | `draft/restore` | Verwalter | `{ publicationId, baseRevision }` → `200 { revision }` |
| POST | `assets` | Verwalter | `multipart/form-data` (`file`) → `200 { assetId, metadata, svg, report }` |
| GET | `dependencies?channel=<name>` | Verwalter | `200 { draft: Location[], published: Location[] }` für Warnungen der Kanalverwaltung; folgt mit AP06 (braucht die Abhängigkeitsanalyse der Formeln) |
| POST | `lidar-grid-source` | Verwalter | richtet den LiDAR-Rasterkanal ein (LiDAR-Vertrag §7): `200 { created: bool }`; Umsetzung in AP04 |

\* Ein Asset ist für Betrachter nur lesbar, wenn eine Veröffentlichung des
Fahrzeugs es referenziert; Verwalter lesen jedes Asset des Fahrzeugs. Asset-Antworten:

- `Cache-Control: public, max-age=31536000, immutable`,
- `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`,
- `X-Content-Type-Options: nosniff`.

**Kompression (D63):** Der Server komprimiert Antworten dieser Endpunkte mit
Brotli oder gzip (`application/json`, `application/problem+json`, `image/svg+xml`).
Anfragen mit `Content-Encoding: gzip` werden für `PUT`/`PATCH draft` und den
Asset-Upload angenommen. Websocket-Nachrichten bleiben unkomprimiert; dort sorgt
das kompakte Format des Telemetrievertrags für kleine Mengen.

**Speichern (PUT draft):**

1. Prüfung der Verwalterrolle.
2. Größe ≤ 2 MB (sonst `413`).
3. Schema und `structure`-Diagnosen. `publish`-Diagnosen sind erlaubt
   (Produktplan).
4. `If-Match` = aktuelle Revision, sonst `409`.
5. Speichern mit `Revision + 1`, Revisionshistorie fortschreiben, Ereignis senden.

Ein fehlendes `If-Match` ist `428`.

**Speichern als Differenz (PATCH draft, D63):**

- Der Client sendet nur die JSON-Patch-Operationen zwischen dem zuletzt
  bestätigten Stand und dem aktuellen Entwurf. Erlaubt sind `add`, `remove`
  und `replace`; Arrays werden als Ganzes ersetzt.
- Der Server wendet sie auf das Dokument der Revision `If-Match` an und prüft
  das Ergebnis wie bei `PUT`. Danach speichert er das vollständige Dokument;
  Historie und Veröffentlichungen enthalten immer ganze Dokumente.
- Lässt sich ein Patch nicht anwenden, antwortet der Server mit `422`
  `OVL_API_PATCH_FAILED`. Der Client sendet dann einmal per `PUT` das ganze
  Dokument.
- Der Client verwendet `PUT` statt `PATCH`, wenn der Patch größer als die
  Hälfte des Dokuments ist, sowie beim ersten Speichern nach Laden,
  Wiederherstellung oder Import.

**Veröffentlichen:**

1. `baseRevision` muss der aktuellen Revision entsprechen (sonst `409`).
2. Volle Prüfung (Resolver, Ausdrücke, Assets vorhanden). `publish`-Fehler in
   aktiven Teilen führen zu `422` mit Diagnosen.
3. Die Veröffentlichung entsteht atomar in einer Transaktion. Dokument und
   Asset-Menge werden kopiert; referenzierte Assets werden `active`.
4. Ereignis senden.

**Wiederherstellen:** Ersetzt den Entwurf durch das Dokument der gewählten
Veröffentlichung (neue Revision). Das aktuell angezeigte HUD bleibt unverändert.

**Fehlerformat:** `application/problem+json`

```
{ type, title, status, code, diagnostics?, currentRevision? }
```

| Code | Status |
| --- | --- |
| `OVL_API_LOGIN_REQUIRED` | 401 |
| `OVL_API_NO_CAR_ACCESS` | 403 |
| `OVL_API_NOT_DRIVER` | 403 |
| `OVL_API_PRECONDITION_REQUIRED` | 428 |
| `OVL_API_REVISION_CONFLICT` | 409, mit `currentRevision` |
| `OVL_API_INVALID_DOCUMENT` | 422, mit `structure`-Diagnosen |
| `OVL_API_SCHEMA_UNSUPPORTED` | 422 |
| `OVL_API_PUBLISH_BLOCKED` | 422, mit Diagnosen |
| `OVL_API_TOO_LARGE` | 413 |
| `OVL_API_ASSET_REJECTED` | 422, mit SVG-Bericht |
| `OVL_API_NOT_FOUND` | 404 |
| `OVL_API_PATCH_FAILED` | 422 |
| `OVL_API_INVALID_REQUEST` | 400 (z. B. Notiz zu lang, Datei fehlt) |
| `OVL_API_NOT_AVAILABLE` | 501 (SVG-Import ohne Bereinigung, D67) |

## 4. Ereignisse (CarConnectionHub)

| Aufruf/Nachricht | Gruppe | Inhalt |
| --- | --- | --- |
| `SubscribeToOverlay(carId)` | tritt `overlay:{carId}` bei | `CanViewCarAsync` |
| `OverlayPublished` | `overlay:{carId}` | `{ carId, publicationId, number }` |
| `OverlayDraftChanged` | `overlay:{carId}` | `{ carId, revision }` (keine Inhalte, keine Benutzerdaten) |

- Clients laden nach `OverlayPublished` den Stand per `GET published` und
  übernehmen ihn als Ganzes. Assets werden vor der Übernahme geladen; erst
  danach wird umgeschaltet. Es gibt keine Mischstände.
- Nach SignalR-Reconnect: erneut beitreten, `GET published`; wenn sich
  `publicationId` unterscheidet, übernehmen.
- Ist das neue Dokument nicht verwendbar (unbekannte Schema-Version, Fehler),
  läuft der bisherige Stand mit Fehlerhinweis weiter. Ohne verwendbaren Stand
  bleibt das HUD aus.
- Editor-Tabs vergleichen `OverlayDraftChanged.revision` mit ihrer Basis. Bei
  Abweichung gehen sie sofort in den Konfliktzustand, nicht erst beim nächsten
  Speichern.

## 5. Client-Speicherverhalten (AP09)

- **Autosave (D25):** 2 s nach der letzten Änderung, spätestens 30 s bei
  andauernder Bearbeitung. Es läuft höchstens eine Anfrage gleichzeitig.
  Übertragen wird per `PATCH` nur die Differenz (D63); ohne Änderung seit dem
  letzten bestätigten Stand wird nichts gesendet.
  Statusanzeige: `ungespeichert`, `speichert`, `gespeichert`, `fehler`,
  `konflikt`, `nur lokal` (ohne Kontrolle).
- **Lokale Sicherung:**
  - IndexedDB-Datenbank `signalrc-overlay`, Store `backups`, Schlüssel
    `[carId, savedAt]`.
  - Eintrag im Format des Austauschpakets mit `kind: "backup"`, `baseRevision`
    und den Texten der referenzierten Assets.
  - Geschrieben bei jeder Änderung, gedrosselt auf höchstens eine Schreibung je
    Sekunde. Je Fahrzeug bleiben die letzten 5 erhalten.
- **Wiederherstellung nach Neuladen:**
  - Weiterarbeiten wird nur angeboten, wenn `baseRevision` gleich der aktuellen
    Serverrevision ist.
  - Sonst ist die Sicherung nur als Download verfügbar.
  - Sicherungen werden nie stillschweigend gelöscht; nur die Rotation auf 5
    verwirft die älteste.
- **Konflikt (`409` oder `OverlayDraftChanged` mit fremder Revision):**
  1. Autosave pausiert; der Serverstand hat Vorrang.
  2. Angeboten werden der Download des lokalen Stands und das Laden des
     Serverstands.
  3. Es gibt kein automatisches Zusammenführen.
- **Kontrollverlust** (`403 OVL_API_NOT_DRIVER`, `CarStateUpdated` mit anderem
  Fahrer):
  - Es wird nicht mehr auf den Server geschrieben; lokal wird weitergearbeitet.
  - Nach erneuter Kontrolle wird zuerst `GET draft` geprüft: Bei gleicher
    Revision geht es weiter, sonst gilt der Konfliktablauf.
- **Undo/Redo (D55):** 200 Schritte, im Speicher des Tabs. Speichern ändert den
  Undo-Stapel nicht.

## 6. Steuerungspause im Editor (AP13)

- Beim Öffnen der Editorroute `/car/[carId]/overlay` wird
  `setUpdatesEnabled(false)` gesetzt, inklusive Löschen der Resend-Timer.
- Beim Verlassen wird **nicht** reaktiviert. Das gilt auch dann, wenn die
  bestehende Konfigurationsseite `setConfigMode(false)` aufruft; der Editor
  verwendet `setConfigMode` nicht.
- Live-Test-Freigabe nur über eine ausdrückliche Schaltfläche mit deutlicher
  Statusanzeige.
- Tastatureingaben in Editorfeldern werden nicht an die
  Gamepad-/Tastatursteuerung weitergereicht.
