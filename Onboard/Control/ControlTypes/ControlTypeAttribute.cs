namespace SignalRC.Onboard.Control.ControlTypes;

public class ControlTypeAttribute : Attribute
{
    public string TypeName { get; }
    
    public ControlTypeAttribute(string typeName)
    {
        TypeName = typeName;
    }
}