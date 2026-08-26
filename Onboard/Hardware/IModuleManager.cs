namespace SignalRC.Onboard.Hardware
{
    public interface IModuleManager
    {
        public T GetModule<T>(int address) where T : class, IModule;
    }
}