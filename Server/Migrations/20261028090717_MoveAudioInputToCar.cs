using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SignalRC.Server.Migrations
{
    /// <inheritdoc />
    public partial class MoveAudioInputToCar : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "AudioBitrateKbps",
                table: "Cars",
                type: "integer",
                nullable: false,
                defaultValue: 32);

            migrationBuilder.AddColumn<bool>(
                name: "AudioDenoise",
                table: "Cars",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "AudioInputChannel",
                table: "Cars",
                type: "character varying(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "mix");

            migrationBuilder.AddColumn<string>(
                name: "AudioInputDevice",
                table: "Cars",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<float>(
                name: "AudioInputGain",
                table: "Cars",
                type: "real",
                nullable: false,
                defaultValue: 1f);

            migrationBuilder.AddColumn<bool>(
                name: "AudioMuteInputWhileTalking",
                table: "Cars",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<float>(
                name: "AudioOutputVolume",
                table: "Cars",
                type: "real",
                nullable: false,
                defaultValue: 1f);

            // The microphone moves from the video stream to the car: keep the first configured one
            // (by stream priority) so existing vehicles keep their audio.
            migrationBuilder.Sql("""
                UPDATE "Cars" AS c
                SET "AudioInputDevice" = s."AudioDevice", "AudioDenoise" = s."AudioDenoise"
                FROM (
                    SELECT DISTINCT ON ("CarId") "CarId", "AudioDevice", "AudioDenoise"
                    FROM "CarVideoStreams"
                    WHERE "AudioDevice" IS NOT NULL AND "AudioDevice" <> ''
                    ORDER BY "CarId", "Priority", "Id"
                ) AS s
                WHERE c."Id" = s."CarId";
                """);

            migrationBuilder.DropColumn(
                name: "AudioDenoise",
                table: "CarVideoStreams");

            migrationBuilder.DropColumn(
                name: "AudioDevice",
                table: "CarVideoStreams");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "AudioDenoise",
                table: "CarVideoStreams",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "AudioDevice",
                table: "CarVideoStreams",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.DropColumn(
                name: "AudioBitrateKbps",
                table: "Cars");

            migrationBuilder.DropColumn(
                name: "AudioDenoise",
                table: "Cars");

            migrationBuilder.DropColumn(
                name: "AudioInputChannel",
                table: "Cars");

            migrationBuilder.DropColumn(
                name: "AudioInputDevice",
                table: "Cars");

            migrationBuilder.DropColumn(
                name: "AudioInputGain",
                table: "Cars");

            migrationBuilder.DropColumn(
                name: "AudioMuteInputWhileTalking",
                table: "Cars");

            migrationBuilder.DropColumn(
                name: "AudioOutputVolume",
                table: "Cars");
        }
    }
}
