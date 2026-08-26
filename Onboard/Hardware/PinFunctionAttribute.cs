namespace SignalRC.Onboard.Control;

[AttributeUsage(AttributeTargets.Property)]
public class PinFunctionAttribute : Attribute
{
    public PinFunctionFlags Functions { get; }

    public PinFunctionAttribute(PinFunctionFlags functions)
    {
        Functions = functions;
    }
}