git pull

SCRIPT_DIR="$(realpath "$(dirname "$0")")"
dotnet build -c=Release $SCRIPT_DIR/../src/SignalRC.Server.csproj
systemctl restart signalrc-server.service
systemctl restart signalrc-client.service
sleep 5
systemctl status signalrc-server.service --no-pager -l
systemctl status signalrc-client.service --no-pager -l