using System;
using System.Collections.Generic;

namespace LteCar.Shared.Video;

public enum DiagnosticStatus
{
    Ok,
    Warning,
    Error,
    Info
}

public class DiagnosticCheck
{
    public string Step { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public DiagnosticStatus Status { get; set; }
    public string Message { get; set; } = string.Empty;
}

public class OnboardDiagnosticsReport
{
    public DateTime Timestamp { get; set; }
    public string StreamName { get; set; } = string.Empty;
    public List<DiagnosticCheck> Checks { get; set; } = new();
    public bool HasErrors { get; set; }
}
