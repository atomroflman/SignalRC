using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LteCar.Server.Migrations
{
    /// <inheritdoc />
    public partial class TelemetryFormatColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DataType",
                table: "CarTelemetry",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<byte>(
                name: "Decimals",
                table: "CarTelemetry",
                type: "smallint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Unit",
                table: "CarTelemetry",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DataType",
                table: "CarTelemetry");

            migrationBuilder.DropColumn(
                name: "Decimals",
                table: "CarTelemetry");

            migrationBuilder.DropColumn(
                name: "Unit",
                table: "CarTelemetry");
        }
    }
}
