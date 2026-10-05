using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SignalRC.Server.Migrations
{
    /// <inheritdoc />
    public partial class AddAudioDevices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
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

            migrationBuilder.AddColumn<string>(
                name: "AudioOutputDevice",
                table: "Cars",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AudioDenoise",
                table: "CarVideoStreams");

            migrationBuilder.DropColumn(
                name: "AudioDevice",
                table: "CarVideoStreams");

            migrationBuilder.DropColumn(
                name: "AudioOutputDevice",
                table: "Cars");
        }
    }
}
