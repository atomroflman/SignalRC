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
  Reverse: {
    summary: "Kehrt das Vorzeichen um, z. B. für eine verkehrt herum eingebaute Lenkung.",
    example: "0,3 → −0,3; −1 → 1",
  },
  Add: {
    summary: "Addiert die Eingänge: a + b.",
    details: ["Ein nicht verbundener Eingang zählt als 0."],
    example: "Gas 0,6 + Trim 0,05 → 0,65",
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
    ],
    example: "a = Gas, b = 0, Operator >, ifTrue = 1, ifFalse = 0 → Bremslicht aus, sobald Gas gegeben wird",
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
      "Läuft im Browser des Fahrers: zwischen Pin und Reaktion liegen Leseintervall und Netzwerk. Endschalter oder Not-Aus gehören aufs Fahrzeug.",
    ],
    example: "Telemetrie \"doorOpen\" → Iif → Fahrzeugkanal warnLight",
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
  Reverse: {
    summary: "Inverts the sign, e.g. for a steering servo mounted the other way round.",
    example: "0.3 → −0.3; −1 → 1",
  },
  Add: {
    summary: "Adds the inputs: a + b.",
    details: ["An unconnected input counts as 0."],
    example: "Throttle 0.6 + trim 0.05 → 0.65",
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
    ],
    example: "a = throttle, b = 0, operator >, ifTrue = 1, ifFalse = 0 → brake light off as soon as you accelerate",
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
      "Runs in the driver's browser: read interval and network lie between pin and reaction. End stops or an e-stop belong on the vehicle.",
    ],
    example: "Telemetry \"doorOpen\" → Iif → vehicle channel warnLight",
  },
};

export const flowNodeDocs: Record<Locale, Record<string, FlowNodeDoc>> = { de, en };
