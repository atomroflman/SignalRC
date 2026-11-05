using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace SignalRC.Server.Migrations
{
    /// <inheritdoc />
    public partial class AddTelemetryHistory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "Record",
                table: "CarTelemetry",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "TelemetryRetentionDays",
                table: "Cars",
                type: "integer",
                nullable: false,
                defaultValue: 7);

            migrationBuilder.CreateTable(
                name: "CarTelemetryDashboards",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CarId = table.Column<int>(type: "integer", nullable: false),
                    LayoutJson = table.Column<string>(type: "text", nullable: false),
                    ModifiedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CarTelemetryDashboards", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CarTelemetryDashboards_Cars_CarId",
                        column: x => x.CarId,
                        principalTable: "Cars",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TelemetrySessions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CarId = table.Column<int>(type: "integer", nullable: false),
                    StartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EndedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastSampleAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ChannelsJson = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TelemetrySessions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TelemetrySessions_Cars_CarId",
                        column: x => x.CarId,
                        principalTable: "Cars",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TelemetrySamples",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    SessionId = table.Column<int>(type: "integer", nullable: false),
                    ChannelId = table.Column<int>(type: "integer", nullable: false),
                    Time = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Value = table.Column<double>(type: "double precision", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TelemetrySamples", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TelemetrySamples_TelemetrySessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "TelemetrySessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CarTelemetryDashboards_CarId",
                table: "CarTelemetryDashboards",
                column: "CarId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TelemetrySamples_SessionId_ChannelId_Time",
                table: "TelemetrySamples",
                columns: new[] { "SessionId", "ChannelId", "Time" });

            migrationBuilder.CreateIndex(
                name: "IX_TelemetrySessions_CarId_StartedAt",
                table: "TelemetrySessions",
                columns: new[] { "CarId", "StartedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CarTelemetryDashboards");

            migrationBuilder.DropTable(
                name: "TelemetrySamples");

            migrationBuilder.DropTable(
                name: "TelemetrySessions");

            migrationBuilder.DropColumn(
                name: "Record",
                table: "CarTelemetry");

            migrationBuilder.DropColumn(
                name: "TelemetryRetentionDays",
                table: "Cars");
        }
    }
}
