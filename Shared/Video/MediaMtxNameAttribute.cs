namespace LteCar.Shared.Video
{
    public class MediaMtxNameAttribute(string name) : Attribute
    {
        public string Name {get;set;} = name;
    }
}