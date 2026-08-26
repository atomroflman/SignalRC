using SignalRC.Onboard.Hardware;

namespace SignalRC.Onboard.Control.ControlTypes;

public interface IControlType
{
    public int? Address { get; set; }
    public string Name { get; set; }
    public bool TestDisabled { get; set; }
    public Dictionary<string, object> Options { get; set; }
    public IModuleManager PinManager { get; set; }

    public void Initialize();
    public Task RunTestAsync();
    public void OnControlRecived(decimal newValue);
    public void OnControlReleased();
}