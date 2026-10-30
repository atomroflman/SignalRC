# TrackedVehicle

Kettenfahrzeug mit zwei Hoverboard-Nabenmotoren. Jeder Motor hängt an einem
eigenen MKS XDrive Mini, weil das Board nur einen Motorausgang hat. Der
Raspberry Pi steuert beide über CAN.

Treiberdokumentation: [Docs/CanTrackDrive.md](../../Docs/CanTrackDrive.md).

## Hardware

| | |
|---|---|
| Antrieb | 2 x Hoverboard-Nabenmotor, 15 Polpaare, Hall-Sensoren |
| Regler | 2 x MKS XDrive Mini V1.0, SimpleFOC-Firmware |
| Bus | CAN, 500 kbit/s, Standard-IDs |
| Besonderheit | Der Motor **ist** das Kettenritzel, gedrucktes PETG-Ritzel statt Laufrad. Kein Getriebe, keine freie Welle. |

Jedes Board trägt eine eigene Firmware, `pio run -e left` bzw. `-e right`. Die
Knoten-ID steckt im Build, nicht in einem Strap-Pin — die Pins sind am
eingebauten Board nicht erreichbar.

## Vor der ersten Fahrt

**1. CAN-Interface hochfahren.** Gehört in ein systemd-Unit oder in
`/etc/network/interfaces`, sonst ist es nach jedem Neustart weg:

```bash
sudo ip link set can0 up type can bitrate 500000 restart-ms 100
candump -tz can0
```

`restart-ms 100` ist nicht optional: ohne das holt Linux die Schnittstelle nach
einem Bus-Off nie zurueck.

`berr-reporting on` waere zusaetzlich nuetzlich, **kann der Adapter aber
nicht** - die candleLight-Firmware auf `gs_usb` antwortet mit
`requested control mode BERR-REPORTING not supported`. Zustandswechsel meldet
der Kernel ohnehin, nur Einzelfehler je Rahmen fehlen.

Erwartet: `0x181` alle 50 ms, `0x182` alle 200 ms, `0x183` jede Sekunde, und
dasselbe auf `0x191`/`0x192`/`0x193` vom zweiten Knoten.

**2. Drehrichtung klären — aufgebockt.** Die beiden Nabenmotoren sind
spiegelbildlich montiert und laufen mit derselben Kalibrierung. Gleiches
Vorzeichen dreht sie also gleichsinnig im Motorkoordinatensystem, und das
Fahrzeug führe im Kreis statt geradeaus.

In dieser Vorlage stehen beide Umkehrflags auf `false`. **Normalerweise muss
genau eine Seite auf `true`.** Welche, entscheidet der Versuch und nicht der
Schaltplan: ein Board mit vertauschten Phasen dreht schon von sich aus
andersherum.

Fahrzeug aufbocken, langsam Gas geben, zusehen. Laufen beide Ketten in
Fahrtrichtung, passt es. Laufen sie gegeneinander, `invertRight` auf `true` —
und erneut prüfen.

**Das vor dem Absetzen auf den Boden erledigen.** Falsch herum wird aus dem
ersten Gasbefehl eine Pirouette.

## Werte in dieser Vorlage

| Option | Wert | |
|---|---|---|
| `maxSpeedRadPerSecond` | 20 | Vollausschlag. Gemessen gehalten bis 30 rad/s. |
| `steeringGain` | 1.0 | Erlaubt Drehen auf der Stelle bei vollem Ausschlag |
| `expectedNodes` | 2 | Auf 1 setzen, wenn nur ein Board am Bus hängt |
| `controlTimeoutMs` | 500 | Keine Fahreingabe so lange: Fahrt gesperrt |
| `maxResendInterval` | 300 | Browser wiederholt den letzten Wert alle 150 ms |

Die beiden letzten gehören zusammen. Ohne `maxResendInterval` sendet der
Browser nur bei Änderung — Stick ruhig halten erzeugt dann keinen Verkehr, und
der Watchdog löst auf einer gesunden Strecke aus. 300 gegen 500 lässt eine
ausgefallene Wiederholung durchgehen und greift bei der zweiten.

## Sicherheitsverhalten

Die Fahrt ist gesperrt, solange nicht alles stimmt. Statt der kommandierten
Drehzahl geht dann Modus `Stop` mit Sollwert null hinaus:

- CAN-Interface offen
- beide Knoten haben innerhalb von 250 ms gemeldet
- kein Knoten im verriegelten Fehler
- Fahreingabe nicht älter als 500 ms

Der Grund steht im Klartext im Telemetriefeld `inhibit`. Bei „fährt nicht" ist
das die erste Stelle zum Nachsehen, `controlAge` die zweite.

Ein verriegelter Fehler auf **einem** Knoten schaltet über den Not-Aus-Broadcast
`0x010` **beide** ab. Ein Antrieb, der bei blockierter Kette weiterläuft,
während der andere steht, reißt das Fahrzeug herum.

Entriegelt wird nur vom Master, über den Kanal `faultReset`.

## Kanaltests

`throttle` und `steer` stehen auf `testDisabled`. Ihr Test ist bewusst zahm,
20 Prozent für je eine Sekunde in beide Richtungen — aber er dreht trotzdem
beide Ketten. Nur aufgebockt freigeben.

`faultReset` und `emergencyStop` sind vom Test dauerhaft ausgenommen.
