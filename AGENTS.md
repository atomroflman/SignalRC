# Agent Instructions for LteCar

## Deployment erfolgt auf Anweisung

Code-Änderungen werden lokal committed, aber **nicht** automatisch auf
`lte-rc-server` oder `lte-truck` ausgerollt. Vor Ort kann das Repo mit
`update.sh` aktualisiert werden: es erkennt Server- oder Onboard-Installation,
stoppt den Service, baut neu und startet wieder.

Erst wenn der User explizit "deploy", "update", "rollout" o. ä. sagt, wird der
Update-Skill `ltecar-update` benutzt (oder `dotnet run` / `npm run dev` auf dem
Server für die Dev-Iteration).

Bei destruktiven Aktionen (z. B. `docker compose down`, Factory-Reset,
Reboot) gilt weiterhin: **vorher fragen**.

## Build & Lint als Vor-Check

Vor dem Rollout kurz prüfen, dass der Code überhaupt baut:

- Client: `cd Client && Client/node_modules/.bin/tsc --noEmit -p Client/tsconfig.json`
- Server: `dotnet build Server/LteCar.Server.csproj -c Release`
- Onboard: `dotnet build Onboard/LteCar.Onboard.csproj -c Release`

Wenn einer der Schritte fehlschlägt: **nicht ausrollen**, User informieren.

## SSH-Aliase

`~/.ssh/config` muss `lte-truck` und `lte-rc-server` auflösen. Details im
Skill `ltecar-ssh`.
