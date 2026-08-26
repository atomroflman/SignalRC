using SignalRC.Onboard.Hardware;

public interface IModuleManagerFactory
{
    IModuleManager Create(string name);
}

