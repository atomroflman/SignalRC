using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace SignalRC.Server.Migrations
{
    /// <inheritdoc />
    public partial class AddOnboardFlow : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Name",
                table: "UserSetupFlowNodes",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "VehicleInputChannelId",
                table: "UserSetupFlowNodes",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Zone",
                table: "UserSetupFlowNodes",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "VehicleInputDevices",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CarId = table.Column<int>(type: "integer", nullable: false),
                    DeviceKey = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    Name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    LastSeenUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VehicleInputDevices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VehicleInputDevices_Cars_CarId",
                        column: x => x.CarId,
                        principalTable: "Cars",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VehicleInputChannels",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    VehicleInputDeviceId = table.Column<int>(type: "integer", nullable: false),
                    Code = table.Column<int>(type: "integer", nullable: false),
                    IsAxis = table.Column<bool>(type: "boolean", nullable: false),
                    Name = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VehicleInputChannels", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VehicleInputChannels_VehicleInputDevices_VehicleInputDevice~",
                        column: x => x.VehicleInputDeviceId,
                        principalTable: "VehicleInputDevices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_UserSetupFlowNodes_VehicleInputChannelId",
                table: "UserSetupFlowNodes",
                column: "VehicleInputChannelId");

            migrationBuilder.CreateIndex(
                name: "IX_VehicleInputChannels_VehicleInputDeviceId_IsAxis_Code",
                table: "VehicleInputChannels",
                columns: new[] { "VehicleInputDeviceId", "IsAxis", "Code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_VehicleInputDevices_CarId_DeviceKey",
                table: "VehicleInputDevices",
                columns: new[] { "CarId", "DeviceKey" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_UserSetupFlowNodes_VehicleInputChannels_VehicleInputChannel~",
                table: "UserSetupFlowNodes",
                column: "VehicleInputChannelId",
                principalTable: "VehicleInputChannels",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_UserSetupFlowNodes_VehicleInputChannels_VehicleInputChannel~",
                table: "UserSetupFlowNodes");

            migrationBuilder.DropTable(
                name: "VehicleInputChannels");

            migrationBuilder.DropTable(
                name: "VehicleInputDevices");

            migrationBuilder.DropIndex(
                name: "IX_UserSetupFlowNodes_VehicleInputChannelId",
                table: "UserSetupFlowNodes");

            migrationBuilder.DropColumn(
                name: "Name",
                table: "UserSetupFlowNodes");

            migrationBuilder.DropColumn(
                name: "VehicleInputChannelId",
                table: "UserSetupFlowNodes");

            migrationBuilder.DropColumn(
                name: "Zone",
                table: "UserSetupFlowNodes");
        }
    }
}
