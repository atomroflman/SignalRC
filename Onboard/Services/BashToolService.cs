using System.Diagnostics;
using System.Text;
using LteCar.Shared.HubClients;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Logging;

namespace LteCar.Onboard;

public class BashToolService
{
    private readonly ILogger<BashToolService> _logger;
    private Process? _currentProcess;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private HubConnection? _hubConnection;
    private bool _isEnabled = true;
    private string _workingDirectory;

    public BashToolService(ILogger<BashToolService> logger)
    {
        _logger = logger;
        _workingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    }

    public void SetEnabled(bool enabled)
    {
        _isEnabled = enabled;
        _logger.LogInformation("BashToolService enabled: {Enabled}", enabled);
    }

    public bool IsEnabled => _isEnabled;

    public async Task ConnectToServer(string serverUrl, string carIdentityKey)
    {
        if (!_isEnabled)
        {
            _logger.LogInformation("BashToolService is disabled, skipping connection");
            return;
        }

        try
        {
            var baseUri = new Uri(serverUrl.TrimEnd('/'));
            var hubUri = new Uri(baseUri, "hubs/carbash");

            _hubConnection = new HubConnectionBuilder()
                .WithUrl(hubUri)
                .WithAutomaticReconnect(Enumerable.Range(0, 10).Select(e => TimeSpan.FromSeconds(e + 1)).ToArray())
                .Build();

            _hubConnection.On<string>("ExecuteCommand", async (command) =>
            {
                await ExecuteCommandAndStreamOutput(command);
            });

            _hubConnection.On<string>("ChangeDirectory", async (dir) =>
            {
                ChangeDirectory(dir);
            });

            _hubConnection.On("SendPrompt", async () =>
            {
                await SendPrompt();
            });

            _hubConnection.On<string, string>("ResizeTerminal", (cols, rows) =>
            {
                // Handle terminal resize if needed
            });

            await _hubConnection.StartAsync();
            await _hubConnection.InvokeAsync("RegisterCar", carIdentityKey);
            
            _logger.LogInformation("BashToolService connected to server");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to connect BashToolService to server");
        }
    }

    public async Task Disconnect()
    {
        if (_hubConnection != null)
        {
            await _hubConnection.DisposeAsync();
            _hubConnection = null;
        }
        KillCurrentProcess();
    }

    private async Task ExecuteCommandAndStreamOutput(string command)
    {
        if (!_isEnabled)
        {
            await SendError("BashTool is disabled on this vehicle");
            return;
        }

        await _lock.WaitAsync();
        try
        {
            KillCurrentProcess();

            var parts = command.Split(' ', 2);
            var cmd = parts[0];
            var args = parts.Length > 1 ? parts[1] : "";

            var psi = new ProcessStartInfo
            {
                FileName = cmd,
                Arguments = args,
                WorkingDirectory = _workingDirectory,
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };

            _currentProcess = new Process { StartInfo = psi };
            _currentProcess.OutputDataReceived += async (s, e) =>
            {
                if (e.Data != null)
                    await SendOutput(e.Data + "\n");
            };
            _currentProcess.ErrorDataReceived += async (s, e) =>
            {
                if (e.Data != null)
                    await SendError(e.Data + "\n");
            };

            _currentProcess.Start();
            _currentProcess.BeginOutputReadLine();
            _currentProcess.BeginErrorReadLine();

            await _currentProcess.WaitForExitAsync();
            var exitCode = _currentProcess.ExitCode;
            _currentProcess.Dispose();
            _currentProcess = null;

            await SendExitCode(exitCode);
            await SendPrompt();
        }
        catch (Exception ex)
        {
            await SendError($"Error: {ex.Message}\n");
            await SendPrompt();
        }
        finally
        {
            _lock.Release();
        }
    }

    private void ChangeDirectory(string directory)
    {
        try
        {
            if (Directory.Exists(directory))
            {
                _workingDirectory = directory;
                _logger.LogInformation("Changed working directory to: {Dir}", directory);
            }
            else
            {
                _logger.LogWarning("Directory does not exist: {Dir}", directory);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to change directory to: {Dir}", directory);
        }
    }

    private async Task SendPrompt()
    {
        var prompt = $"{Environment.UserName}@{Environment.MachineName}:{_workingDirectory}$ ";
        await SendToClient(async client => await client.OnPrompt(prompt));
    }

    private async Task SendOutput(string output)
    {
        await SendToClient(async client => await client.OnOutput(output));
    }

    private async Task SendError(string error)
    {
        await SendToClient(async client => await client.OnError(error));
    }

    private async Task SendExitCode(int exitCode)
    {
        await SendToClient(async client => await client.OnExitCode(exitCode));
    }

    private async Task SendToClient(Func<ICarBashClient, Task> action)
    {
        if (_hubConnection != null && _hubConnection.State == HubConnectionState.Connected)
        {
            try
            {
                await _hubConnection.InvokeAsync("SendToClient", action);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send to client");
            }
        }
    }

    private void KillCurrentProcess()
    {
        if (_currentProcess != null && !_currentProcess.HasExited)
        {
            try
            {
                _currentProcess.Kill(true);
            }
            catch { }
            finally
            {
                _currentProcess.Dispose();
                _currentProcess = null;
            }
        }
    }
}
