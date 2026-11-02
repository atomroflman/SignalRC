using System.Runtime.CompilerServices;

// Lets the module tests build LidarScan instances (internal setters) without hardware.
[assembly: InternalsVisibleTo("SignalRC.Overlay.Tests")]
