using SignalRC.Onboard.Hardware;

public interface IModuleManagerFactory
{
    IModuleManager Create(string name);

    /// <summary>Drops (and disposes) the instance built for this name, so the next Create builds it from the current ChannelMap.</summary>
    void Invalidate(string name) { }
}

