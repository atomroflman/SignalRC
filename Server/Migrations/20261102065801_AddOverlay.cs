using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace SignalRC.Server.Migrations
{
    /// <inheritdoc />
    public partial class AddOverlay : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "OverlayAssets",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CarId = table.Column<int>(type: "integer", nullable: false),
                    AssetId = table.Column<string>(type: "character varying(71)", maxLength: 71, nullable: false),
                    Svg = table.Column<string>(type: "text", nullable: false),
                    MetadataJson = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedByUserId = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OverlayAssets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OverlayAssets_Cars_CarId",
                        column: x => x.CarId,
                        principalTable: "Cars",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "OverlayDraftRevisions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CarId = table.Column<int>(type: "integer", nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    DocumentJson = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OverlayDraftRevisions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OverlayDraftRevisions_Cars_CarId",
                        column: x => x.CarId,
                        principalTable: "Cars",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "OverlayDrafts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CarId = table.Column<int>(type: "integer", nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    DocumentJson = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedByUserId = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OverlayDrafts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OverlayDrafts_Cars_CarId",
                        column: x => x.CarId,
                        principalTable: "Cars",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "OverlayPublications",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CarId = table.Column<int>(type: "integer", nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    SchemaVersion = table.Column<int>(type: "integer", nullable: false),
                    DocumentJson = table.Column<string>(type: "text", nullable: false),
                    PublishedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PublishedByUserId = table.Column<int>(type: "integer", nullable: true),
                    PublishedByName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    SourceDraftRevision = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OverlayPublications", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OverlayPublications_Cars_CarId",
                        column: x => x.CarId,
                        principalTable: "Cars",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "OverlayPublicationAssets",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PublicationId = table.Column<int>(type: "integer", nullable: false),
                    AssetId = table.Column<string>(type: "character varying(71)", maxLength: 71, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OverlayPublicationAssets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OverlayPublicationAssets_OverlayPublications_PublicationId",
                        column: x => x.PublicationId,
                        principalTable: "OverlayPublications",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OverlayAssets_CarId_AssetId",
                table: "OverlayAssets",
                columns: new[] { "CarId", "AssetId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OverlayDraftRevisions_CarId_Revision",
                table: "OverlayDraftRevisions",
                columns: new[] { "CarId", "Revision" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OverlayDrafts_CarId",
                table: "OverlayDrafts",
                column: "CarId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OverlayPublicationAssets_PublicationId_AssetId",
                table: "OverlayPublicationAssets",
                columns: new[] { "PublicationId", "AssetId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OverlayPublications_CarId_Number",
                table: "OverlayPublications",
                columns: new[] { "CarId", "Number" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "OverlayAssets");

            migrationBuilder.DropTable(
                name: "OverlayDraftRevisions");

            migrationBuilder.DropTable(
                name: "OverlayDrafts");

            migrationBuilder.DropTable(
                name: "OverlayPublicationAssets");

            migrationBuilder.DropTable(
                name: "OverlayPublications");
        }
    }
}
