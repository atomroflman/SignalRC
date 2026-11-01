# Overlay-Ausdruckssprache v1

Status: **freigegeben** (AP00, 2026-11-01), Vertrag v1. Grundlage: D06–D09,
D20, D26–D31, D33, D36, D46, D48–D51 in
[Overlay-AP00-Vertraege.md](../../../Overlay-AP00-Vertraege.md).
Referenzfälle: [`../fixtures/expressions/cases.json`](../fixtures/expressions/cases.json).

Die Sprache ist ein begrenzter, typisierter, reiner Ausdruck: keine Variablen,
keine Zuweisungen, keine Schleifen, keine Zeitfunktion (D51), kein Zugriff auf
Plattform-APIs. Implementierungen dürfen weder `eval` noch den
`Function`-Konstruktor oder dynamisch erzeugten Code verwenden.

## 1. Lexik

| Token | Regel |
| --- | --- |
| Leerraum | Leerzeichen, Tab, CR, LF – ohne Bedeutung |
| Zahl | `[0-9]+ ("." [0-9]+)? ([eE] [+-]? [0-9]+)?` – muss endlich sein; kein Vorzeichen (das ist Unär-Minus) |
| Text | `"` … `"`, Escapes nur `\"` und `\\`; kein Zeilenumbruch im Literal |
| Bezeichner | `[A-Za-z_][A-Za-z0-9_]*` – nur Funktionsnamen sowie `true`/`false` |
| Operatoren | `+ - * / ! && \|\| == != < <= > >= ( ) ,` |

Positionen in Diagnosen sind UTF-16-Code-Unit-Offsets (identisch in C# und JS).

## 2. Grammatik (EBNF)

```
expr        = or ;
or          = and { "||" and } ;
and         = equality { "&&" equality } ;
equality    = comparison [ ( "==" | "!=" ) comparison ] ;     (* nicht assoziativ *)
comparison  = additive [ ( "<" | "<=" | ">" | ">=" ) additive ] ;  (* nicht assoziativ *)
additive    = multiplicative { ( "+" | "-" ) multiplicative } ;
multiplicative = unary { ( "*" | "/" ) unary } ;
unary       = ( "-" | "!" ) unary | primary ;
primary     = number | text | "true" | "false" | call | "(" expr ")" ;
call        = identifier "(" [ expr { "," expr } ] ")" ;
```

`a < b < c` und `a == b == c` sind Syntaxfehler. Es gibt keinen `?:`-Operator
(D20), keinen Potenz- und keinen Modulo-Operator (`pow()`, `mod()`).

## 3. Typen

Statische Typen: `number` (IEEE-754 double), `bool`, `text`. Jeder Ausdruck hat
genau einen statischen Typ. Es gibt keine impliziten Umwandlungen (D29).

| Quelle | Typ |
| --- | --- |
| `tel("k")` | aus `TelemetryDataType` des Kanals: `Integer`/`Number` → `number`, `Boolean` → `bool`, `String` → `text` |
| `out("k")` | `number` |
| `sig("k")` | `number` (D36) |
| `driverActive()` | `bool` |

Quellfunktionen verlangen ein **Textliteral** als Argument, damit Abhängigkeiten
statisch feststehen. Ist die Quelle unbekannt, meldet die Prüfung
`OVL_REF_UNKNOWN_SOURCE` und rechnet mit dem Typ `unknown` weiter. `unknown`
erzeugt keine Folgetypfehler.

Erwarteter Ergebnistyp je Property-`kind` (Katalog):

| kind | Typ |
| --- | --- |
| `number`, `length`, `angle`, `factor`, `opacity` | `number` |
| `integer` | `number`, kaufmännisch auf ganze Zahl gerundet |
| `bool` | `bool` |
| `text` | `text` |
| `color` | `text`, zur Laufzeit als Farbliteral geprüft |
| `any` | beliebig |
| Clip-Bedingung | `bool` |
| Raten-Ausdruck | `number` |

Abweichung: `OVL_EXPR_RESULT_TYPE`.

Typregeln der Operatoren:

- `+ - * /` und unäres `-`: `number × number → number`. `+` verbindet keinen Text.
- `< <= > >=`: `number × number → bool`.
- `== !=`: gleiche Typen → `bool`. Zahlen werden exakt verglichen, Text ordinal
  über die kanonische Form (siehe §6).
- `! && ||`: `bool → bool`.

## 4. Laufzeitwerte, Qualität und Fehlerfortpflanzung

Ein Laufzeitwert ist `{ typ, zustand, paused, wert }` mit
`zustand ∈ { valid, unchecked, invalid }`.

- Quellwerte übernehmen den Zustand aus dem Telemetrie-/Signalvertrag
  (fehlend, veraltet, Quellfehler → `invalid`; Alt-Onboard → `unchecked`).
- Telemetrietexte werden kulturunabhängig geparst (`.` als Dezimalpunkt). Ein
  leerer oder nicht parsbarer Text ergibt `invalid` mit Laufzeitdiagnose
  `OVL_EXPR_SOURCE_PARSE`. Für `Boolean` gelten `1/0/true/false`
  (ohne Groß-/Kleinschreibung).
- `paused` ist gesetzt, wenn ein ausgewerteter `out()`/`sig()`-Wert aus einer
  pausierten Steuerung stammt (D09, D30). Er sperrt keine Bewegung, sondern
  löst nur die Pausenanzeige aus.

**Strikte Auswertung** (alle Operatoren und Funktionen außer den unten
genannten): Ist ein Argument `invalid`, ist das Ergebnis `invalid`, ohne zu
rechnen. Sonst ist der Zustand der schlechteste der Argumente
(`unchecked` vor `valid`), und `paused` ist das ODER der Argumente.

**Bedarfsauswertung** (nur ausgewertete Teile zählen, D20/D27):

- `if(c, a, b)`: `c` invalid → invalid. Sonst wird nur der gewählte Zweig
  ausgewertet; Zustand/paused = schlechtester aus `c` und Zweig.
- `a && b`, `a || b`: `a` invalid → invalid. Bestimmt `a` das Ergebnis
  (`false &&`, `true ||`), wird `b` nicht ausgewertet und das Ergebnis trägt den
  Zustand von `a`. Sonst Ergebnis = `b`, Zustand = schlechtester aus `a`, `b`.
- `fallback(x, y)`: `x` nicht invalid → `x`; sonst wird `y` ausgewertet und
  geliefert.
- `valid(x)`: `true`, wenn `x` `valid` oder `unchecked` ist, sonst `false`;
  das Ergebnis ist immer `valid` und nicht `paused`.

**Numerische Fehler** ergeben `invalid` plus Laufzeitdiagnose. Sie brechen nie den
Renderer ab:

- Division durch 0 → `OVL_EXPR_DIV_ZERO`
- nicht endliches Ergebnis (Überlauf) → `OVL_EXPR_NOT_FINITE`
- Definitionsbereich verletzt (z. B. `sqrt(-1)`, `asin(2)`, `clamp` mit
  `lo > hi`, `wrap` mit `hi ≤ lo`, `map` mit `inMin == inMax`) → `OVL_EXPR_DOMAIN`

Es gibt kein implizites Null (D27).

## 5. Funktionskatalog

| Funktion | Signatur | Bemerkung |
| --- | --- | --- |
| `tel(k)` / `out(k)` / `sig(k)` | Textliteral → s. §3 | Quellen (D46) |
| `driverActive()` | → bool | D30 |
| `if(c, a, b)` | bool, T, T → T | Bedarfsauswertung |
| `valid(x)` | T → bool | D27 |
| `fallback(x, y)` | T, T → T | D27 |
| `abs(x)`, `sign(x)` | number → number | `sign` liefert −1/0/1 |
| `min(a, b, …)`, `max(a, b, …)` | 2–16 × number → number | |
| `clamp(x, lo, hi)` | number³ → number | |
| `map(x, inMin, inMax, outMin, outMax)` | number⁵ → number | linear, **ohne** Begrenzung (D49) |
| `mapClamped(x, inMin, inMax, outMin, outMax)` | number⁵ → number | auf `[min(outMin,outMax), max(…)]` begrenzt |
| `round(x)`, `floor(x)`, `ceil(x)` | number → number | `round`: kaufmännisch (0,5 von null weg) |
| `mod(a, b)` | number² → number | Ergebnis hat das Vorzeichen von `b` (floored) |
| `wrap(x, lo, hi)` | number³ → number | Ergebnis in `[lo, hi)`, z. B. Winkel |
| `sqrt(x)`, `pow(b, e)`, `hypot(a, b)` | number → number | |
| `sin`, `cos`, `tan` | number (rad) → number | |
| `asin`, `acos`, `atan` | number → number (rad) | |
| `atan2(y, x)` | number² → number (rad) | |
| `rad(deg)`, `deg(rad)` | number → number | D26 |
| `pi()` | → number | |
| `format(x, d)` | number, Ganzzahl-Literal 0–6 → text | s. §6 |
| `concat(a, b, …)` | 2–16 × text → text | Zahlen nur über `format()` |

Unbekannte Funktion: `OVL_EXPR_UNKNOWN_FUNCTION`. Falsche Argumentanzahl:
`OVL_EXPR_ARITY`. Kein Literal, wo eines verlangt ist: `OVL_EXPR_LITERAL_REQUIRED`.
Literal außerhalb des erlaubten Bereichs (z. B. `format(x, 7)`):
`OVL_EXPR_ARGUMENT_RANGE`.

## 6. Text und Zahlenformat (D48)

Ein Textwert besteht intern aus Segmenten: Literaltext und formatierte Zahl
(Wert + Dezimalstellen). `concat` hängt Segmente aneinander.

- **Rundung in `format(x, d)`**: `x` wird zuerst in die kürzeste
  Round-Trip-Dezimaldarstellung umgewandelt (JS `String(x)`, .NET `"R"`). Danach
  wird **dezimal** auf `d` Stellen gerundet, 0,5 von null weg, und auf genau
  `d` Nachkommastellen aufgefüllt. Damit ergibt `format(1.005, 2)` in beiden
  Implementierungen `1.01`. Ist das gerundete Ergebnis null, entfällt ein
  Minuszeichen.
- **Kanonische Form**: Zahlsegmente mit `.` als Dezimalpunkt, ohne
  Tausendertrennung. Sie dient für Gleichheitsvergleiche und Tests und ist
  sprachunabhängig.
- **Anzeige**: Der Renderer lokalisiert nur die Zahlsegmente nach der Sprache
  des Betrachters (de → `,`, en → `.`), ebenfalls ohne Tausendertrennung. Gleiches
  gilt für `valueText`.
- Telemetrietexte (`tel` mit Typ `String`) sind reiner Literaltext und werden
  nicht lokalisiert.

## 7. Statische Analyse und Grenzen

Die Analyse liefert: AST, statischen Typ, Abhängigkeitsliste
`[{ kind: tel|out|sig|driver, name }]` (alle Referenzen, auch in nicht gewählten
Zweigen) und Diagnosen.

| Prüfung | Code | Kategorie |
| --- | --- | --- |
| leerer Ausdruck | `OVL_EXPR_EMPTY` | publish |
| Syntax | `OVL_EXPR_SYNTAX` (mit Offset) | publish |
| Typ | `OVL_EXPR_TYPE`, `OVL_EXPR_RESULT_TYPE` | publish |
| Funktion/Arity/Literal/Bereich | s. §5 | publish |
| unbekannte Quelle | `OVL_REF_UNKNOWN_SOURCE` | publish |
| > 1000 Zeichen, AST-Tiefe > 32 | `OVL_LIMIT_EXCEEDED` | structure |

Diagnose-Offsets: Syntaxfehler zeigen auf das unerwartete Token. Funktions-,
Quell- und Arity-Fehler zeigen auf den Beginn des Aufrufs. Argumentfehler
(Literal, Bereich, Typ) zeigen auf den Beginn des ersten unpassenden
Operanden bzw. Arguments. Leer-, Ergebnistyp- und Grenzfehler haben Offset 0.
Bei mehreren Fehlern meldet die Analyse den ersten in Quelltextreihenfolge;
ein Syntaxfehler beendet die Analyse.

`publish`-Fehler in deaktivierten Teilen sind Warnungen (Produktplan). Die
AST-Tiefe zählt jede Operator- und Funktionsebene; ein einzelnes Literal hat
Tiefe 1. Zusätzlich gilt die Gesamtzahl von 300 Formeln je Dokument (D33).
Jedes nicht leere `expr`-Feld und jede Clip-Bedingung zählt als eine Formel.

## 8. Übereinstimmung Client/Server

Client (Liveprüfung, Laufzeit) und Server (Veröffentlichungsprüfung) müssen für
alle Fälle in `cases.json` identische Typen, Abhängigkeiten, Diagnosecodes und
Offsets liefern. Bei Laufzeitwerten gilt für trigonometrische und
Potenzfunktionen eine relative Toleranz von 1e-9; alle anderen Ergebnisse
müssen exakt übereinstimmen.
