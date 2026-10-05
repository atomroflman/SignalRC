git pull

SCRIPT_DIR="$(realpath "$(dirname "$0")")"
dotnet build -c=Release $SCRIPT_DIR/../src/LteCar.Server.csproj
systemctl restart ltecar-server.service
systemctl restart ltecar-client.service
sleep 5
systemctl status ltecar-server.service --no-pager -l
systemctl status ltecar-client.service --no-pager -l