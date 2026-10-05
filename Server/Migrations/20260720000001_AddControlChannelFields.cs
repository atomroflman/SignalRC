using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LteCar.Server.Migrations
{
    /// <inheritdoc />
    public partial class AddControlChannelFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Address",
                table: "CarChannels",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ControlType",
                table: "CarChannels",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OptionsJson",
                table: "CarChannels",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PinManager",
                table: "CarChannels",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "default");

            migrationBuilder.AddColumn<bool>(
                name: "TestDisabled",
                table: "CarChannels",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Address",
                table: "CarChannels");

            migrationBuilder.DropColumn(
                name: "ControlType",
                table: "CarChannels");

            migrationBuilder.DropColumn(
                name: "OptionsJson",
                table: "CarChannels");

            migrationBuilder.DropColumn(
                name: "PinManager",
                table: "CarChannels");

            migrationBuilder.DropColumn(
                name: "TestDisabled",
                table: "CarChannels");
        }
    }
}