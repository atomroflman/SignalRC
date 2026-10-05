using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LteCar.Server.Migrations
{
    /// <inheritdoc />
    public partial class FixUserSetupLinkCascade : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_UserSetupLink_UserSetupFlowNodes_UserSetupFromNodeId",
                table: "UserSetupLink");

            migrationBuilder.DropForeignKey(
                name: "FK_UserSetupLink_UserSetupFlowNodes_UserSetupToNodeId",
                table: "UserSetupLink");

            migrationBuilder.AddForeignKey(
                name: "FK_UserSetupLink_UserSetupFlowNodes_UserSetupFromNodeId",
                table: "UserSetupLink",
                column: "UserSetupFromNodeId",
                principalTable: "UserSetupFlowNodes",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_UserSetupLink_UserSetupFlowNodes_UserSetupToNodeId",
                table: "UserSetupLink",
                column: "UserSetupToNodeId",
                principalTable: "UserSetupFlowNodes",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_UserSetupLink_UserSetupFlowNodes_UserSetupFromNodeId",
                table: "UserSetupLink");

            migrationBuilder.DropForeignKey(
                name: "FK_UserSetupLink_UserSetupFlowNodes_UserSetupToNodeId",
                table: "UserSetupLink");

            migrationBuilder.AddForeignKey(
                name: "FK_UserSetupLink_UserSetupFlowNodes_UserSetupFromNodeId",
                table: "UserSetupLink",
                column: "UserSetupFromNodeId",
                principalTable: "UserSetupFlowNodes",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_UserSetupLink_UserSetupFlowNodes_UserSetupToNodeId",
                table: "UserSetupLink",
                column: "UserSetupToNodeId",
                principalTable: "UserSetupFlowNodes",
                principalColumn: "Id");
        }
    }
}
