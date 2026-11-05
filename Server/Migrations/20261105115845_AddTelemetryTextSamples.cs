using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace SignalRC.Server.Migrations
{
    /// <inheritdoc />
    public partial class AddTelemetryTextSamples : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TelemetryTextSamples",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    SessionId = table.Column<int>(type: "integer", nullable: false),
                    ChannelId = table.Column<int>(type: "integer", nullable: false),
                    Time = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Value = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TelemetryTextSamples", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TelemetryTextSamples_TelemetrySessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "TelemetrySessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TelemetryTextSamples_SessionId_ChannelId_Time",
                table: "TelemetryTextSamples",
                columns: new[] { "SessionId", "ChannelId", "Time" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TelemetryTextSamples");
        }
    }
}
