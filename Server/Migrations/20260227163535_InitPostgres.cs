using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace LteCar.Server.Migrations
{
    /// <inheritdoc />
    public partial class InitPostgres : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateSequence(
                name: "UserSessionSeq");

            migrationBuilder.CreateTable(
                name: "Cars",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    CarIdentityKey = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ChannelMapHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    LastSeen = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Cars", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "SetupFilterTypes",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TypeName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Name = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Description = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SetupFilterTypes", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "CarChannels",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    DisplayName = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    ChannelName = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    IsEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    RequiresAxis = table.Column<bool>(type: "boolean", nullable: false),
                    MaxResendInterval = table.Column<int>(type: "integer", nullable: true),
                    CarId = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CarChannels", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CarChannels_Cars_CarId",
                        column: x => x.CarId,
                        principalTable: "Cars",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "CarTelemetry",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ChannelName = table.Column<string>(type: "text", nullable: false),
                    CarId = table.Column<int>(type: "integer", nullable: false),
                    ReadIntervalTicks = table.Column<int>(type: "integer", nullable: false),
                    TelemetryType = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CarTelemetry", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CarTelemetry_Cars_CarId",
                        column: x => x.CarId,
                        principalTable: "Cars",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "CarVideoStreams",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    StreamId = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CarId = table.Column<int>(type: "integer", nullable: false),
                    Protocol = table.Column<int>(type: "integer", maxLength: 10, nullable: false),
                    Port = table.Column<int>(type: "integer", nullable: false),
                    JanusPort = table.Column<int>(type: "integer", nullable: true),
                    StartTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EndTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    ProcessArguments = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    StreamPurpose = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Type = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Location = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    Priority = table.Column<int>(type: "integer", nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    LastStatusUpdate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Height = table.Column<int>(type: "integer", nullable: false),
                    Width = table.Column<int>(type: "integer", nullable: false),
                    BitrateKbps = table.Column<int>(type: "integer", nullable: false),
                    Framerate = table.Column<int>(type: "integer", nullable: false),
                    Brightness = table.Column<float>(type: "real", nullable: false),
                    JanusId = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CarVideoStreams", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CarVideoStreams_Cars_CarId",
                        column: x => x.CarId,
                        principalTable: "Cars",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    ActiveVehicleId = table.Column<int>(type: "integer", nullable: true),
                    LastSeen = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    TransferCode = table.Column<long>(type: "bigint", maxLength: 6, nullable: true),
                    SessionId = table.Column<long>(type: "bigint", nullable: false),
                    TransferCodeExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Users_Cars_ActiveVehicleId",
                        column: x => x.ActiveVehicleId,
                        principalTable: "Cars",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "UserChannelDevice",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    DeviceName = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserChannelDevice", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserChannelDevice_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "UserSetups",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    CarId = table.Column<int>(type: "integer", nullable: false),
                    CarSecret = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserSetups", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserSetups_Cars_CarId",
                        column: x => x.CarId,
                        principalTable: "Cars",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_UserSetups_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "UserChannel",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserChannelDeviceId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    ChannelId = table.Column<int>(type: "integer", nullable: false),
                    IsAxis = table.Column<bool>(type: "boolean", nullable: false),
                    Accuracy = table.Column<int>(type: "integer", nullable: false),
                    CalibrationMin = table.Column<float>(type: "real", nullable: true),
                    CalibrationMax = table.Column<float>(type: "real", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserChannel", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserChannel_UserChannelDevice_UserChannelDeviceId",
                        column: x => x.UserChannelDeviceId,
                        principalTable: "UserChannelDevice",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "UserSetupTelemetries",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CarTelemetryId = table.Column<int>(type: "integer", nullable: false),
                    UserSetupId = table.Column<int>(type: "integer", nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    OverrideTicks = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserSetupTelemetries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserSetupTelemetries_CarTelemetry_CarTelemetryId",
                        column: x => x.CarTelemetryId,
                        principalTable: "CarTelemetry",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_UserSetupTelemetries_UserSetups_UserSetupId",
                        column: x => x.UserSetupId,
                        principalTable: "UserSetups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "UserSetupFlowNodes",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserSetupId = table.Column<int>(type: "integer", nullable: false),
                    PositionX = table.Column<float>(type: "real", nullable: false),
                    PositionY = table.Column<float>(type: "real", nullable: false),
                    NodeType = table.Column<string>(type: "character varying(34)", maxLength: 34, nullable: false),
                    CarChannelId = table.Column<int>(type: "integer", nullable: true),
                    SetupFunctionName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    TelemetryId = table.Column<int>(type: "integer", nullable: true),
                    UserChannelId = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserSetupFlowNodes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserSetupFlowNodes_CarChannels_CarChannelId",
                        column: x => x.CarChannelId,
                        principalTable: "CarChannels",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_UserSetupFlowNodes_CarTelemetry_TelemetryId",
                        column: x => x.TelemetryId,
                        principalTable: "CarTelemetry",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_UserSetupFlowNodes_UserChannel_UserChannelId",
                        column: x => x.UserChannelId,
                        principalTable: "UserChannel",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_UserSetupFlowNodes_UserSetups_UserSetupId",
                        column: x => x.UserSetupId,
                        principalTable: "UserSetups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "UserSetupFunctionNodeParameter",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ParameterName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ParameterValue = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    NodeId = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserSetupFunctionNodeParameter", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserSetupFunctionNodeParameter_UserSetupFlowNodes_NodeId",
                        column: x => x.NodeId,
                        principalTable: "UserSetupFlowNodes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "UserSetupLink",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserSetupFromNodeId = table.Column<int>(type: "integer", nullable: false),
                    UserSetupToNodeId = table.Column<int>(type: "integer", nullable: false),
                    SourcePort = table.Column<string>(type: "text", nullable: true),
                    TargetPort = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserSetupLink", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserSetupLink_UserSetupFlowNodes_UserSetupFromNodeId",
                        column: x => x.UserSetupFromNodeId,
                        principalTable: "UserSetupFlowNodes",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_UserSetupLink_UserSetupFlowNodes_UserSetupToNodeId",
                        column: x => x.UserSetupToNodeId,
                        principalTable: "UserSetupFlowNodes",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_CarChannels_CarId",
                table: "CarChannels",
                column: "CarId");

            migrationBuilder.CreateIndex(
                name: "IX_Cars_CarIdentityKey",
                table: "Cars",
                column: "CarIdentityKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CarTelemetry_CarId",
                table: "CarTelemetry",
                column: "CarId");

            migrationBuilder.CreateIndex(
                name: "IX_CarVideoStreams_CarId_StreamId",
                table: "CarVideoStreams",
                columns: new[] { "CarId", "StreamId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CarVideoStreams_Port",
                table: "CarVideoStreams",
                column: "Port");

            migrationBuilder.CreateIndex(
                name: "IX_UserChannel_UserChannelDeviceId_IsAxis_ChannelId",
                table: "UserChannel",
                columns: new[] { "UserChannelDeviceId", "IsAxis", "ChannelId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UserChannelDevice_UserId_DeviceName",
                table: "UserChannelDevice",
                columns: new[] { "UserId", "DeviceName" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_ActiveVehicleId",
                table: "Users",
                column: "ActiveVehicleId");

            migrationBuilder.CreateIndex(
                name: "IX_Users_SessionId",
                table: "Users",
                column: "SessionId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_TransferCode",
                table: "Users",
                column: "TransferCode",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UserSetupFlowNodes_CarChannelId",
                table: "UserSetupFlowNodes",
                column: "CarChannelId");

            migrationBuilder.CreateIndex(
                name: "IX_UserSetupFlowNodes_TelemetryId",
                table: "UserSetupFlowNodes",
                column: "TelemetryId");

            migrationBuilder.CreateIndex(
                name: "IX_UserSetupFlowNodes_UserChannelId",
                table: "UserSetupFlowNodes",
                column: "UserChannelId");

            migrationBuilder.CreateIndex(
                name: "IX_UserSetupFlowNodes_UserSetupId",
                table: "UserSetupFlowNodes",
                column: "UserSetupId");

            migrationBuilder.CreateIndex(
                name: "IX_UserSetupFunctionNodeParameter_NodeId_ParameterName",
                table: "UserSetupFunctionNodeParameter",
                columns: new[] { "NodeId", "ParameterName" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UserSetupLink_UserSetupFromNodeId",
                table: "UserSetupLink",
                column: "UserSetupFromNodeId");

            migrationBuilder.CreateIndex(
                name: "IX_UserSetupLink_UserSetupToNodeId",
                table: "UserSetupLink",
                column: "UserSetupToNodeId");

            migrationBuilder.CreateIndex(
                name: "IX_UserSetups_CarId",
                table: "UserSetups",
                column: "CarId");

            migrationBuilder.CreateIndex(
                name: "IX_UserSetups_UserId",
                table: "UserSetups",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_UserSetupTelemetries_CarTelemetryId",
                table: "UserSetupTelemetries",
                column: "CarTelemetryId");

            migrationBuilder.CreateIndex(
                name: "IX_UserSetupTelemetries_UserSetupId",
                table: "UserSetupTelemetries",
                column: "UserSetupId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CarVideoStreams");

            migrationBuilder.DropTable(
                name: "SetupFilterTypes");

            migrationBuilder.DropTable(
                name: "UserSetupFunctionNodeParameter");

            migrationBuilder.DropTable(
                name: "UserSetupLink");

            migrationBuilder.DropTable(
                name: "UserSetupTelemetries");

            migrationBuilder.DropTable(
                name: "UserSetupFlowNodes");

            migrationBuilder.DropTable(
                name: "CarChannels");

            migrationBuilder.DropTable(
                name: "CarTelemetry");

            migrationBuilder.DropTable(
                name: "UserChannel");

            migrationBuilder.DropTable(
                name: "UserSetups");

            migrationBuilder.DropTable(
                name: "UserChannelDevice");

            migrationBuilder.DropTable(
                name: "Users");

            migrationBuilder.DropTable(
                name: "Cars");

            migrationBuilder.DropSequence(
                name: "UserSessionSeq");
        }
    }
}
