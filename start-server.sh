cd "$(dirname "$0")/SignalRC.Server/bin/Release/net8.0"
echo "Starting SignalRC Server"
echo "$(dirname "$0")/SignalRC.Server/bin/Release/net8.0/SignalRC.Server"
dotnet SignalRC.Server.dll --urls=https://0.0.0.0:5000
