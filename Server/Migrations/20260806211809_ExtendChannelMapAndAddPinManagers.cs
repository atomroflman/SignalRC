using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace LteCar.Server.Migrations
{
    /// <inheritdoc />
    public partial class ExtendChannelMapAndAddPinManagers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_CarTelemetry_CarId",
                table: "CarTelemetry");

            migrationBuilder.AddColumn<string>(
                name: "CameraDevice",
                table: "CarVideoStreams",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OptionsJson",
                table: "CarVideoStreams",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "RpiCamId",
                table: "CarVideoStreams",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ServerId",
                table: "CarVideoStreams",
                type: "integer",
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Unit",
                table: "CarTelemetry",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "TelemetryType",
                table: "CarTelemetry",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "ChannelName",
                table: "CarTelemetry",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AddColumn<int>(
                name: "Address",
                table: "CarTelemetry",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OptionsJson",
                table: "CarTelemetry",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PinManager",
                table: "CarTelemetry",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "ServerId",
                table: "CarTelemetry",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ServerId",
                table: "CarChannels",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CarPinManagers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    OptionsJson = table.Column<string>(type: "text", nullable: true),
                    ModifiedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CarId = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CarPinManagers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CarPinManagers_Cars_CarId",
                        column: x => x.CarId,
                        principalTable: "Cars",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CarTelemetry_CarId_ChannelName",
                table: "CarTelemetry",
                columns: new[] { "CarId", "ChannelName" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CarPinManagers_CarId_Name",
                table: "CarPinManagers",
                columns: new[] { "CarId", "Name" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CarPinManagers");

            migrationBuilder.DropIndex(
                name: "IX_CarTelemetry_CarId_ChannelName",
                table: "CarTelemetry");

            migrationBuilder.DropColumn(
                name: "CameraDevice",
                table: "CarVideoStreams");

            migrationBuilder.DropColumn(
                name: "OptionsJson",
                table: "CarVideoStreams");

            migrationBuilder.DropColumn(
                name: "RpiCamId",
                table: "CarVideoStreams");

            migrationBuilder.DropColumn(
                name: "ServerId",
                table: "CarVideoStreams");

            migrationBuilder.DropColumn(
                name: "Address",
                table: "CarTelemetry");

            migrationBuilder.DropColumn(
                name: "OptionsJson",
                table: "CarTelemetry");

            migrationBuilder.DropColumn(
                name: "PinManager",
                table: "CarTelemetry");

            migrationBuilder.DropColumn(
                name: "ServerId",
                table: "CarTelemetry");

            migrationBuilder.DropColumn(
                name: "ServerId",
                table: "CarChannels");

            migrationBuilder.AlterColumn<string>(
                name: "Unit",
                table: "CarTelemetry",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "TelemetryType",
                table: "CarTelemetry",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64);

            migrationBuilder.AlterColumn<string>(
                name: "ChannelName",
                table: "CarTelemetry",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64);

            migrationBuilder.CreateIndex(
                name: "IX_CarTelemetry_CarId",
                table: "CarTelemetry",
                column: "CarId");
        }
    }
}
