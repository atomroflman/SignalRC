using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SignalRC.Server.Migrations
{
    /// <inheritdoc />
    public partial class AddVehicleKeys : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DeviceKeyFingerprint",
                table: "Cars",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DevicePublicKey",
                table: "Cars",
                type: "character varying(2048)",
                maxLength: 2048,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "OwnerKeyChangedAt",
                table: "Cars",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OwnerKeyFingerprint",
                table: "Cars",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OwnerPublicKey",
                table: "Cars",
                type: "character varying(2048)",
                maxLength: 2048,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DeviceKeyFingerprint",
                table: "Cars");

            migrationBuilder.DropColumn(
                name: "DevicePublicKey",
                table: "Cars");

            migrationBuilder.DropColumn(
                name: "OwnerKeyChangedAt",
                table: "Cars");

            migrationBuilder.DropColumn(
                name: "OwnerKeyFingerprint",
                table: "Cars");

            migrationBuilder.DropColumn(
                name: "OwnerPublicKey",
                table: "Cars");
        }
    }
}
