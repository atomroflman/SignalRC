using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LteCar.Server.Migrations
{
    /// <inheritdoc />
    public partial class AddCameraParametersToVideoStream : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<float>(
                name: "Contrast",
                table: "CarVideoStreams",
                type: "real",
                nullable: true);

            migrationBuilder.AddColumn<float>(
                name: "EV",
                table: "CarVideoStreams",
                type: "real",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Exposure",
                table: "CarVideoStreams",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<float>(
                name: "Gain",
                table: "CarVideoStreams",
                type: "real",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Shutter",
                table: "CarVideoStreams",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Contrast",
                table: "CarVideoStreams");

            migrationBuilder.DropColumn(
                name: "EV",
                table: "CarVideoStreams");

            migrationBuilder.DropColumn(
                name: "Exposure",
                table: "CarVideoStreams");

            migrationBuilder.DropColumn(
                name: "Gain",
                table: "CarVideoStreams");

            migrationBuilder.DropColumn(
                name: "Shutter",
                table: "CarVideoStreams");
        }
    }
}
