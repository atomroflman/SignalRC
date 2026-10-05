namespace LteCar.Shared.HubClients;

public interface ICarBashClient
{
    Task OnPrompt(string prompt);
    Task OnOutput(string output);
    Task OnError(string error);
    Task OnExitCode(int exitCode);

    Task OnExecuteCommand(string command);
    Task OnChangeDirectory(string directory);
    Task OnSendPrompt();
}