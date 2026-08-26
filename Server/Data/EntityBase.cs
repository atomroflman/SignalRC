namespace SignalRC.Server.Data
{
    public class EntityBase
    {
        public int Id { get; set; }
        
        public override string ToString()
        {
            return $"{GetType().Name} #{Id}";
        }
    }
}