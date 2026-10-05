using Microsoft.Extensions.Logging;

namespace LteCar.Onboard.Control.ControlTypes;

[ControlType("LoggingOnly")]
public class LoggingOnlyControl : ControlTypeBase
{
    private readonly ILogger<LoggingOnlyControl> _logger;

    public LoggingOnlyControl(ILogger<LoggingOnlyControl> logger)
    {
        _logger = logger;
    }

    public override string ToString() => $"LoggingOnly@{Address}";

    public override void OnControlRecived(decimal newValue)
    {
        _logger.LogInformation("Received control value for {Channel}: {Value}", Name, newValue);
    }

    public override void OnControlReleased()
    {
    }
}
