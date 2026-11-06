import type { Locale } from "@/i18n/translations";

// Help texts of the flow nodes, shown by the info icon in the node title bar.
// Keys: function names of filterFunctionRegistry, plus "input" and "output"
// for gamepad and vehicle channel nodes. Texts follow what apply() really does
// (e.g. an unconnected input counts as 0, see recalculateNode).
export type FlowNodeDoc = {
  summary: string;
  details?: string[];
  example: string;
};

const de: Record<string, FlowNodeDoc> = {
  input: {
    summary: "Eingang: eine Achse oder ein Knopf deines Gamepads.",
    details: ["Achsen liefern −1 … 1, Knöpfe 0 (los) oder 1 (gedrückt), analoge Trigger 0 … 1."],
    example: "Achse 1 (Lenkung) → Rescale → Fahrzeugkanal steering",
  },
  output: {
    summary: "Ausgang: ein Kanal des Fahrzeugs. Der Wert am Eingang wird ans Fahrzeug gesendet.",
    details: ["Gesendet wird nur mit aktiver Steuerung und eingeschalteten Updates, nicht im pausierten Konfigurationsmodus."],
    example: "Toggle (Licht an/aus) → Fahrzeugkanal light",
  },
  Abs: {
    summary: "Betrag: entfernt das Vorzeichen.",
    example: "−0,7 → 0,7; 0,4 → 0,4",
  },
  Clamp: {
    summary: "Begrenzt den Eingang auf den Bereich min … max.",
    example: "min −0,5, max 0,5: 0,8 → 0,5; −0,2 → −0,2",
  },
  DeadZone: {
    summary: "Tote Zone: kleine Ausschläge um die Mitte werden zu 0, z. B. gegen Zittern einer Achse in Ruhelage.",
    details: [
      "deadzone: Größe der toten Zone, innerhalb von −deadzone … deadzone ist der Ausgang 0.",
      "rescale 1: der restliche Weg wird auf den vollen Bereich gestreckt, der Ausgang beginnt am Rand der Zone bei 0 und erreicht bei Vollausschlag ±1. rescale 0: außerhalb der Zone wird der Eingang unverändert durchgereicht (Sprung am Rand).",
    ],
    example: "deadzone 0,1, rescale 1: 0,05 → 0; 0,55 → 0,5; −1 → −1",
  },
  Reverse: {
    summary: "Kehrt das Vorzeichen um, z. B. für eine verkehrt herum eingebaute Lenkung.",
    example: "0,3 → −0,3; −1 → 1",
  },
  Add: {
    summary: "Addiert die Eingänge: a + b.",
    details: ["Ein nicht verbundener Eingang zählt als 0."],
    example: "Gas 0,6 + Trim 0,05 → 0,65",
  },
  Max: {
    summary: "Gibt den größeren der beiden Eingänge aus.",
    details: ["Ein nicht verbundener Eingang zählt als 0.", "Als „Oder“ für Tasten: ist eine der beiden 1, ist das Ergebnis 1."],
    example: "Controller-Taste 1, Web-Taste 0 → 1; Gas 0,4 und 0,7 → 0,7",
  },
  Min: {
    summary: "Gibt den kleineren der beiden Eingänge aus.",
    details: ["Ein nicht verbundener Eingang zählt als 0.", "Als „Und“ für Tasten: nur wenn beide 1 sind, ist das Ergebnis 1."],
    example: "Gas 0,9 und Begrenzung 0,5 → 0,5",
  },
  Subtract: {
    summary: "Subtrahiert: a − b.",
    details: ["Ein nicht verbundener Eingang zählt als 0."],
    example: "Gas-Trigger 0,8 − Brems-Trigger 0,3 → 0,5",
  },
  Multiply: {
    summary: "Multipliziert: a × b.",
    details: ["Ein nicht verbundener Eingang zählt als 0 – das Ergebnis ist dann 0."],
    example: "Gas 0,8 × Leistungsbegrenzung 0,5 (Float Value) → 0,4",
  },
  Divide: {
    summary: "Dividiert: a ÷ b.",
    details: ["Bei b = 0 ist das Ergebnis 0."],
    example: "Gang 3 ÷ 5 Gänge → 0,6",
  },
  Modulo: {
    summary: "Rest der Division: a mod b.",
    details: ["Bei b = 0 ist das Ergebnis 0."],
    example: "7 mod 3 → 1; 6 mod 3 → 0",
  },
  Power: {
    summary: "Potenz: base hoch exponent.",
    details: ["Ein nicht verbundener Eingang zählt als 0 (exponent 0 ergibt 1)."],
    example: "Exponentielle Lenkung: 0,5 hoch 2 → 0,25",
  },
  Log: {
    summary: "Logarithmus von value zur Basis base.",
    details: ["Bei value ≤ 0 oder ungültiger Basis (≤ 0 oder 1) ist das Ergebnis 0."],
    example: "value 100, base 10 → 2",
  },
  Iif: {
    summary: "Wenn-dann-sonst: vergleicht a mit b und gibt ifTrue oder ifFalse aus.",
    details: [
      "Operatoren: >, <, =, >=, <=, != (= und != mit kleiner Toleranz für Kommazahlen).",
      "Nicht verbundene Eingänge zählen als 0.",
      "Schalter „true → 1“ / „false → 1“ (true eintragen): der Zweig gibt 1 statt seines Eingangs aus – für einen reinen Vergleich braucht es dann nur a und b.",
    ],
    example: "a = Gas, b = 0, Operator >, true → 1 → 1 sobald Gas gegeben wird, sonst 0",
  },
  Toggle: {
    summary: "Schalter: jeder Druck (Wechsel von 0 auf 1) schaltet den Ausgang zwischen 0 und 1 um.",
    example: "Knopf drücken → Licht an, nochmal drücken → Licht aus",
  },
  TurnSignal: {
    summary: "Blinker: der Knopf an enable schaltet ein bzw. aus; zurückdrehen der Lenkung schaltet automatisch aus.",
    details: [
      "steps teilt den Lenkweg in Rasten; zurückgedreht wird gegenüber der weitesten Raste in Blinkrichtung.",
      "isLeftTurn wählt die Richtung (links / rechts).",
    ],
    example: "Knopf an enable, Lenkachse an steering → Ausgang an den Blinker-Kanal",
  },
  Rescale: {
    summary: "Rechnet den Bereich inMin … inMax linear auf outMin … outMax um (ohne Begrenzung).",
    example: "−1 … 1 auf 0 … 1: −1 → 0; 0 → 0,5; 1 → 1",
  },
  Gearbox: {
    summary: "Schaltung: shiftUp bzw. shiftDown schalten bei jedem Druck einen Gang hoch bzw. runter.",
    details: [
      "gearNames legt die Gänge fest, z. B. R,N,1,2,3; initialGear ist der Index des Startgangs (0 = erster Name).",
      "Ausgänge: currentGear (Index), gearValue (Index ÷ höchster Index, 0 … 1) und gearName (als Zahl weitergegeben, wenn der Name eine Zahl ist, sonst 0).",
    ],
    example: "R,N,1,2: Start N, zweimal hoch → 2 (currentGear 3, gearValue 1, gearName 2)",
  },
  FloatValue: {
    summary: "Fester Zahlenwert, per Knöpfe im Knoten einstellbar und auf min … max begrenzt.",
    details: ["step ist die Schrittweite der hervorgehobenen Knöpfe; digits rundet die Ausgabe."],
    example: "Leistungsbegrenzung 0,5 → Multiply mit dem Gas",
  },
  Smooth: {
    summary: "Glättet Sprünge: der Ausgang läuft schrittweise auf den Eingangswert zu.",
    details: [
      "speed (0,01 … 1): Anteil der Restdifferenz pro Schritt, 1 = sofort.",
      "threshold: ab dieser Restdifferenz springt der Ausgang aufs Ziel.",
      "fps: Schritte pro Sekunde.",
    ],
    example: "Gas springt von 0 auf 1, speed 0,1, 60 fps → nach etwa 0,5 s rund 0,95",
  },
  Sign: {
    summary: "Vorzeichen: −1 für negative, 0 für 0, 1 für positive Werte.",
    example: "−0,3 → −1; 0 → 0; 0,8 → 1",
  },
  HudSignal: {
    summary: "Zeigt einen Wert im HUD an, ohne etwas ans Fahrzeug zu senden.",
    details: [
      "signal ist der Name, im HUD-Editor als sig(\"Name\") verwendbar.",
      "Name: Buchstabe am Anfang, dann Buchstaben, Ziffern oder _ (max. 64); jeder Name nur einmal im Flow.",
    ],
    example: "Smooth (geglättetes Gas) → HUD-Signal \"gas\" → im HUD als Balken mit sig(\"gas\")",
  },
  HudInput: {
    summary: "Eingang aus dem HUD: liefert den Wert, den klickbare HUD-Elemente mit diesem Namen setzen.",
    details: [
      "input ist der Name; im HUD-Editor wählst du ihn unter \"Interaktion\" an einem Element oder SVG-Teil.",
      "Taster: Wert solange gedrückt, sonst 0. Schalter: wechselt zwischen 0 und Wert. Fester Wert: setzt den Wert. Regler: min … max per Ziehen.",
      "Gilt nur im Browser des Fahrers und startet nach einem Neuladen bei 0. Zuschauer können nur öffentliche Elemente bedienen.",
      "Für eine Rückmeldung im HUD (z. B. Schalter leuchtet) den Ausgang zusätzlich an ein HUD-Signal hängen.",
    ],
    example: "HUD-Eingabe \"light\" (Schalter) → Fahrzeugkanal light; parallel → HUD-Signal \"light\" für die Anzeige",
  },
  Telemetry: {
    summary: "Eingang vom Fahrzeug: liefert den aktuellen Wert eines Telemetrie-Kanals, z. B. einen GPIO-Eingang (1/0).",
    details: [
      "channel ist der Name des Telemetrie-Kanals. Zahlen kommen unverändert, true/false als 1/0.",
      "valid ist 1, solange der Wert frisch ist; bei veraltetem, fehlerhaftem oder fehlendem Wert ist valid 0 und value der fallback.",
      "Im Browser-Flow liegen Leseintervall und Netzwerk zwischen Pin und Reaktion. Im Fahrzeug-Flow liest der Knoten den Wert direkt auf dem Fahrzeug – dorthin gehören Endschalter oder Not-Aus.",
    ],
    example: "Telemetrie \"doorOpen\" → Iif → Fahrzeugkanal warnLight",
  },
  Active: {
    summary: "Aktiv?: 1, solange der Eingang bewegt wird (|Eingang| > threshold), und noch hold Sekunden danach; sonst 0.",
    details: [
      "Erkennt, ob eine Quelle gerade benutzt wird, z. B. der Controller am Fahrzeug.",
      "Zusammen mit Vorrang: Der lokale Controller übersteuert das Web, solange er bewegt wird.",
    ],
    example: "Controller-Lenkung → Aktiv? → Vorrang.aActive",
  },
  Priority: {
    summary: "Vorrang: gibt a weiter, solange aActive ≥ 0,5 ist, sonst b.",
    details: ["Web und Controller werden nur gemischt, wenn der Flow es so festlegt."],
    example: "Controller-Lenkung → a, Aktiv? → aActive, Übergabe Lenkung → b → Fahrzeugkanal steering",
  },
  TelemetryOut: {
    summary: "Telemetrie senden: Das Fahrzeug veröffentlicht den Eingang unter key. Ein Telemetrie-Kanal vom Typ FlowValueReader mit demselben Key sendet ihn wie jeden Telemetrie-Wert (HUD, Verlauf). Nur im Fahrzeug-Flow.",
    details: [
      "Den Kanal unter Kanäle → Telemetrie anlegen: Typ FlowValueReader, Option Key = key dieses Knotens.",
      "Ohne neuen Wert für StaleAfterMs (Standard 2 s), z. B. bei ausgeschaltetem Flow, gilt der Kanal als veraltet.",
      "Der Ausgang gibt den Wert unverändert weiter.",
    ],
    example: "Gearbox.gearValue → Telemetrie senden (key \"gear\") → Kanal \"Gang\" (FlowValueReader, Key gear) im HUD",
  },
  Pulse: {
    summary: "Pulsieren: schaltet mit rate Hz zwischen 1 und 0 hin und her. Nur im Fahrzeug-Flow.",
    details: [
      "rate ≤ 0 = aus (0); höchstens 25 Hz.",
      "duty: Anteil jeder Periode, in dem 1 ausgegeben wird (0…1, Standard 0,5).",
      "Ändert sich rate, läuft der Takt ohne Sprung schneller oder langsamer weiter – gut für eine Einparkhilfe.",
      "Ein Controller bekommt höchstens 10 Änderungen pro Sekunde: am Rütteln ist Pulsieren bis etwa 5 Hz zu spüren.",
    ],
    example: "Lidar Objekt.distance → Rescale (150 → 1, 20 → 5) → Pulsieren → Controller rütteln.strong",
  },
  LidarObject: {
    summary: "Lidar Objekt: Entfernung zum nächsten Objekt in einem Winkelbereich des Lidars. Nur im Fahrzeug-Flow.",
    details: [
      "from/to in Grad, 0° = geradeaus, wie lidarNearestAngle. from > to geht über 0° (z. B. 350 bis 10); negative Winkel zählen von 360 (−15 bis 15).",
      "Ein Objekt sind benachbarte Messpunkte (alle 0,25°), deren Entfernungen sich höchstens um maxJump cm unterscheiden; Punkte ohne Echo werden übersprungen.",
      "points: so viele Punkte braucht ein Objekt mindestens – einzelne Streupunkte zählen nicht.",
      "distance: nächster Punkt des nächsten Objekts in cm; none (Standard 9999), wenn keines da ist. angle: Winkel dieses Punktes. found: 1/0.",
      "ok ist 1, solange das Lidar frische Umläufe liefert (jünger als 1 s). Ohne Lidar: distance = none, found = 0, ok = 0 – für Bremsen also ok mit prüfen.",
      "Rechnet jeden Umlauf in voller Auflösung auf dem Fahrzeug.",
    ],
    example: "from 10, to 30, points 3 → distance < 50 (Iif, true → 1) → Gas begrenzen",
  },
  ControllerRumble: {
    summary: "Controller rütteln: lässt die passenden Controller vibrieren, strong = großer Motor, weak = kleiner Motor (je 0…1).",
    details: [
      "Im Fahrzeug-Flow rütteln die am Fahrzeug gekoppelten Controller, im Web-Flow die Gamepads am PC – dort nur, wenn der Browser es kann (z. B. Chrome, Edge).",
      "device grenzt ein: Teil des Namens oder die Bluetooth-Adresse; leer = alle.",
      "Fragt der Flow nicht mehr danach (Knoten gelöscht, Flow aus), hört das Rütteln nach kurzer Zeit auf.",
      "Am Fahrzeug: Stärke in 16 Stufen, höchstens 10 Änderungen pro Sekunde je Controller – mehr verträgt das Bluetooth des Raspberry Pi nicht.",
      "Der Ausgang gibt den stärkeren der beiden Motoren aus.",
    ],
    example: "Telemetrie Motorstrom → Rescale 0…1 → Controller rütteln.strong",
  },
  ControllerLight: {
    summary: "Controller Farbe: setzt die Farbe der Lichtleiste der Fahrzeug-Controller, red/green/blue je 0…1. Nur im Fahrzeug-Flow.",
    details: [
      "Für PS4- und PS5-Controller; Browser können die Farbe nicht setzen.",
      "device grenzt ein: Teil des Namens oder die Bluetooth-Adresse; leer = alle.",
      "Nicht verbundene Farben sind 0; alle drei 0 = aus.",
      "Der Ausgang gibt den hellsten Kanal aus.",
    ],
    example: "Iif (Akku < 20 %, true → 1) → Controller Farbe.red",
  },
  DisconnectController: {
    summary: "Controller trennen: Bei einer steigenden Flanke an trigger trennt das Fahrzeug seine Bluetooth-Controller. Nur im Fahrzeug-Flow.",
    details: [
      "device grenzt ein: Teil des Namens oder die Bluetooth-Adresse; leer trennt alle verbundenen Controller.",
      "Für Controller, die sich nicht ausschalten lassen (z. B. PS4). Nach dem Trennen sind ihre Knoten 0 und connected 0.",
      "triggered ist 1 in dem Takt, in dem getrennt wurde.",
    ],
    example: "Controller BTN_MODE (PS-Taste) → Controller trennen (device leer)",
  },
  vehicleInput: {
    summary: "Fahrzeug-Controller: eine Achse oder Taste eines Controllers, der direkt am Fahrzeug gekoppelt ist. Nur im Fahrzeug-Flow.",
    details: [
      "Achsen liefern −1 … 1, Trigger 0 … 1, Tasten 0 oder 1.",
      "connected ist 1, solange der Controller verbunden ist. Ohne Verbindung sind beide Ausgänge 0.",
    ],
    example: "Controller ABS_X → DeadZone → Fahrzeugkanal steering",
  },
  handoff: {
    summary: "Übergabe: reicht einen Wert vom Browser-Flow an den Fahrzeug-Flow weiter.",
    details: [
      "connected ist 1, solange Werte aus dem Browser ankommen. Bei abgekoppeltem Web oder ohne Server sind value und connected 0.",
      "Der Fahrzeug-Flow kann nie zurück in den Browser-Flow liefern.",
    ],
    example: "Gamepad-Lenkung → Rescale → Übergabe \"Lenkung\" → Vorrang.b",
  },
};

const en: Record<string, FlowNodeDoc> = {
  input: {
    summary: "Input: an axis or a button of your gamepad.",
    details: ["Axes give −1 … 1, buttons 0 (released) or 1 (pressed), analog triggers 0 … 1."],
    example: "Axis 1 (steering) → Rescale → vehicle channel steering",
  },
  output: {
    summary: "Output: a channel of the vehicle. The value at the input is sent to the vehicle.",
    details: ["It is only sent with active control and updates enabled, not in the paused configuration mode."],
    example: "Toggle (light on/off) → vehicle channel light",
  },
  Abs: {
    summary: "Absolute value: removes the sign.",
    example: "−0.7 → 0.7; 0.4 → 0.4",
  },
  Clamp: {
    summary: "Limits the input to the range min … max.",
    example: "min −0.5, max 0.5: 0.8 → 0.5; −0.2 → −0.2",
  },
  DeadZone: {
    summary: "Dead zone: small deflections around the centre become 0, e.g. against a jittering axis at rest.",
    details: [
      "deadzone: size of the dead zone; within −deadzone … deadzone the output is 0.",
      "rescale 1: the remaining travel is stretched to the full range, the output starts at 0 on the edge of the zone and reaches ±1 at full deflection. rescale 0: outside the zone the input passes unchanged (jump at the edge).",
    ],
    example: "deadzone 0.1, rescale 1: 0.05 → 0; 0.55 → 0.5; −1 → −1",
  },
  Reverse: {
    summary: "Inverts the sign, e.g. for a steering servo mounted the other way round.",
    example: "0.3 → −0.3; −1 → 1",
  },
  Add: {
    summary: "Adds the inputs: a + b.",
    details: ["An unconnected input counts as 0."],
    example: "Throttle 0.6 + trim 0.05 → 0.65",
  },
  Max: {
    summary: "Outputs the larger of the two inputs.",
    details: ["An unconnected input counts as 0.", "As an “or” for buttons: if either is 1, the result is 1."],
    example: "Controller button 1, web button 0 → 1; throttle 0.4 and 0.7 → 0.7",
  },
  Min: {
    summary: "Outputs the smaller of the two inputs.",
    details: ["An unconnected input counts as 0.", "As an “and” for buttons: the result is 1 only if both are 1."],
    example: "Throttle 0.9 and limit 0.5 → 0.5",
  },
  Subtract: {
    summary: "Subtracts: a − b.",
    details: ["An unconnected input counts as 0."],
    example: "Throttle trigger 0.8 − brake trigger 0.3 → 0.5",
  },
  Multiply: {
    summary: "Multiplies: a × b.",
    details: ["An unconnected input counts as 0 – the result is then 0."],
    example: "Throttle 0.8 × power limit 0.5 (Float Value) → 0.4",
  },
  Divide: {
    summary: "Divides: a ÷ b.",
    details: ["With b = 0 the result is 0."],
    example: "Gear 3 ÷ 5 gears → 0.6",
  },
  Modulo: {
    summary: "Remainder of the division: a mod b.",
    details: ["With b = 0 the result is 0."],
    example: "7 mod 3 → 1; 6 mod 3 → 0",
  },
  Power: {
    summary: "Power: base to the power of exponent.",
    details: ["An unconnected input counts as 0 (exponent 0 gives 1)."],
    example: "Exponential steering: 0.5 to the power of 2 → 0.25",
  },
  Log: {
    summary: "Logarithm of value to the base base.",
    details: ["With value ≤ 0 or an invalid base (≤ 0 or 1) the result is 0."],
    example: "value 100, base 10 → 2",
  },
  Iif: {
    summary: "If-then-else: compares a with b and outputs ifTrue or ifFalse.",
    details: [
      "Operators: >, <, =, >=, <=, != (= and != with a small tolerance for decimals).",
      "Unconnected inputs count as 0.",
      "Switches “true → 1” / “false → 1” (enter true): that branch outputs 1 instead of its input, so a plain comparison only needs a and b.",
    ],
    example: "a = throttle, b = 0, operator >, true → 1 → 1 as soon as you accelerate, otherwise 0",
  },
  Toggle: {
    summary: "Switch: every press (change from 0 to 1) flips the output between 0 and 1.",
    example: "Press the button → light on, press again → light off",
  },
  TurnSignal: {
    summary: "Turn signal: the button at enable switches it on or off; turning the steering back switches it off automatically.",
    details: [
      "steps divides the steering travel into notches; turning back is measured against the furthest notch in signal direction.",
      "isLeftTurn selects the direction (left / right).",
    ],
    example: "Button at enable, steering axis at steering → output to the indicator channel",
  },
  Rescale: {
    summary: "Maps the range inMin … inMax linearly onto outMin … outMax (without limiting).",
    example: "−1 … 1 onto 0 … 1: −1 → 0; 0 → 0.5; 1 → 1",
  },
  Gearbox: {
    summary: "Gearbox: every press of shiftUp or shiftDown shifts one gear up or down.",
    details: [
      "gearNames defines the gears, e.g. R,N,1,2,3; initialGear is the index of the starting gear (0 = first name).",
      "Outputs: currentGear (index), gearValue (index ÷ highest index, 0 … 1) and gearName (passed on as a number if the name is one, otherwise 0).",
    ],
    example: "R,N,1,2: start at N, shift up twice → 2 (currentGear 3, gearValue 1, gearName 2)",
  },
  FloatValue: {
    summary: "Fixed number, adjustable with the buttons in the node and limited to min … max.",
    details: ["step is the increment of the highlighted buttons; digits rounds the output."],
    example: "Power limit 0.5 → Multiply with the throttle",
  },
  Smooth: {
    summary: "Smooths jumps: the output moves towards the input value step by step.",
    details: [
      "speed (0.01 … 1): share of the remaining difference per step, 1 = immediately.",
      "threshold: below this remaining difference the output jumps to the target.",
      "fps: steps per second.",
    ],
    example: "Throttle jumps from 0 to 1, speed 0.1, 60 fps → about 0.95 after roughly 0.5 s",
  },
  Sign: {
    summary: "Sign: −1 for negative values, 0 for 0, 1 for positive values.",
    example: "−0.3 → −1; 0 → 0; 0.8 → 1",
  },
  HudSignal: {
    summary: "Shows a value in the HUD without sending anything to the vehicle.",
    details: [
      "signal is the name, usable in the HUD editor as sig(\"name\").",
      "Name: a letter first, then letters, digits or _ (max. 64); each name only once in the flow.",
    ],
    example: "Smooth (smoothed throttle) → HUD signal \"gas\" → in the HUD as a bar with sig(\"gas\")",
  },
  HudInput: {
    summary: "Input from the HUD: outputs the value that clickable HUD elements with this name set.",
    details: [
      "input is the name; in the HUD editor you pick it under \"Interaction\" on an element or SVG part.",
      "Button: value while pressed, else 0. Toggle: switches between 0 and value. Fixed value: sets the value. Slider: min … max by dragging.",
      "Only in the driver's browser and back at 0 after a reload. Viewers can only use public elements.",
      "For feedback in the HUD (e.g. a lit switch) also connect the output to a HUD signal.",
    ],
    example: "HUD input \"light\" (toggle) → vehicle channel light; in parallel → HUD signal \"light\" for the display",
  },
  Telemetry: {
    summary: "Input from the vehicle: outputs the current value of a telemetry channel, e.g. a GPIO input (1/0).",
    details: [
      "channel is the name of the telemetry channel. Numbers pass unchanged, true/false as 1/0.",
      "valid is 1 while the value is fresh; for a stale, failed or missing value valid is 0 and value is the fallback.",
      "In the browser flow, read interval and network lie between pin and reaction. In the vehicle flow the node reads the value on the vehicle itself – that is where end stops or an e-stop belong.",
    ],
    example: "Telemetry \"doorOpen\" → Iif → vehicle channel warnLight",
  },
  Active: {
    summary: "Active?: 1 while the input is moved (|input| > threshold) and for hold seconds after; otherwise 0.",
    details: [
      "Tells whether a source is being used, e.g. the controller on the vehicle.",
      "With Priority: the local controller overrides the web while it is moved.",
    ],
    example: "Controller steering → Active? → Priority.aActive",
  },
  Priority: {
    summary: "Priority: passes a while aActive ≥ 0.5, otherwise b.",
    details: ["Web and controller are only mixed where the flow says so."],
    example: "Controller steering → a, Active? → aActive, handoff steering → b → vehicle channel steering",
  },
  TelemetryOut: {
    summary: "Send telemetry: the vehicle publishes the input under key. A telemetry channel of type FlowValueReader with the same key sends it like any telemetry value (HUD, history). Vehicle flow only.",
    details: [
      "Create the channel under channels → telemetry: type FlowValueReader, option Key = this node's key.",
      "Without a new value for StaleAfterMs (default 2 s), e.g. with the flow off, the channel counts as stale.",
      "The output passes the value on unchanged.",
    ],
    example: "Gearbox.gearValue → Send telemetry (key \"gear\") → channel \"Gear\" (FlowValueReader, Key gear) in the HUD",
  },
  Pulse: {
    summary: "Pulse: switches between 1 and 0 at rate Hz. Vehicle flow only.",
    details: [
      "rate ≤ 0 = off (0); at most 25 Hz.",
      "duty: share of each period that outputs 1 (0…1, default 0.5).",
      "When rate changes, the pulse speeds up or slows down without a jump – good for a parking aid.",
      "A controller gets at most 10 changes a second: on the rumble, pulsing is felt up to about 5 Hz.",
    ],
    example: "Lidar object.distance → Rescale (150 → 1, 20 → 5) → Pulse → Rumble controller.strong",
  },
  LidarObject: {
    summary: "Lidar object: distance to the nearest object in an angle range of the lidar. Vehicle flow only.",
    details: [
      "from/to in degrees, 0° = straight ahead, as lidarNearestAngle. from > to wraps over 0° (e.g. 350 to 10); negative angles count from 360 (−15 to 15).",
      "An object is neighbouring points (every 0.25°) whose distances differ by at most maxJump cm; points without a return are skipped.",
      "points: an object needs at least this many points – single stray returns do not count.",
      "distance: nearest point of the nearest object in cm; none (default 9999) if there is none. angle: angle of that point. found: 1/0.",
      "ok is 1 while the lidar delivers fresh revolutions (younger than 1 s). Without a lidar: distance = none, found = 0, ok = 0 – check ok too when braking on it.",
      "Computed on the vehicle from every revolution at full resolution.",
    ],
    example: "from 10, to 30, points 3 → distance < 50 (Iif, true → 1) → limit throttle",
  },
  ControllerRumble: {
    summary: "Rumble controller: makes the matching controllers vibrate, strong = big motor, weak = small motor (0…1 each).",
    details: [
      "In the vehicle flow the controllers paired with the vehicle rumble, in the web flow the gamepads at the PC – there only if the browser supports it (e.g. Chrome, Edge).",
      "device narrows it down: part of the name or the Bluetooth address; empty = all.",
      "When the flow no longer asks for it (node deleted, flow off), the rumble stops shortly after.",
      "On the vehicle: strength in 16 steps, at most 10 changes a second per controller – the Raspberry Pi's Bluetooth cannot take more.",
      "The output is the stronger of the two motors.",
    ],
    example: "Telemetry motor current → Rescale 0…1 → Rumble controller.strong",
  },
  ControllerLight: {
    summary: "Controller colour: sets the light bar colour of the vehicle's controllers, red/green/blue 0…1 each. Vehicle flow only.",
    details: [
      "For PS4 and PS5 controllers; browsers cannot set the colour.",
      "device narrows it down: part of the name or the Bluetooth address; empty = all.",
      "Unconnected colours are 0; all three 0 = off.",
      "The output is the brightest channel.",
    ],
    example: "Iif (battery < 20 %, true → 1) → Controller colour.red",
  },
  DisconnectController: {
    summary: "Disconnect controller: on a rising edge at trigger the vehicle disconnects its Bluetooth controllers. Vehicle flow only.",
    details: [
      "device narrows it down: part of the name or the Bluetooth address; empty disconnects every connected controller.",
      "For controllers that cannot be switched off (e.g. PS4). Afterwards their nodes are 0 and connected is 0.",
      "triggered is 1 in the tick that disconnected.",
    ],
    example: "Controller BTN_MODE (PS button) → Disconnect controller (device empty)",
  },
  vehicleInput: {
    summary: "Vehicle controller: an axis or button of a controller paired with the vehicle. Vehicle flow only.",
    details: [
      "Axes give −1 … 1, triggers 0 … 1, buttons 0 or 1.",
      "connected is 1 while the controller is connected. Without a connection both outputs are 0.",
    ],
    example: "Controller ABS_X → DeadZone → vehicle channel steering",
  },
  handoff: {
    summary: "Handoff: passes a value from the browser flow to the vehicle flow.",
    details: [
      "connected is 1 while values arrive from the browser. With the web detached or without the server, value and connected are 0.",
      "The vehicle flow can never feed back into the browser flow.",
    ],
    example: "Gamepad steering → Rescale → handoff \"steering\" → Priority.b",
  },
};

export const flowNodeDocs: Record<Locale, Record<string, FlowNodeDoc>> = { de, en };
