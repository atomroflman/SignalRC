namespace SignalRC.Server.Services;

public class BiDictionary<TKey, TValue>
    where TKey : notnull
    where TValue : notnull
{
    private readonly Dictionary<TKey, TValue> _forward = new();
    private readonly Dictionary<TValue, TKey> _reverse = new();

    public Dictionary<TKey, TValue> Forward => _forward;
    public Dictionary<TValue, TKey> Reverse => _reverse;

    public void Add(TKey key, TValue value)
    {
        if (_forward.ContainsKey(key))
            _forward[key] = value;
        else 
            _forward.Add(key, value);
        if (_reverse.ContainsKey(value)) 
            _reverse[value] = key;
        else
            _reverse.Add(value, key);
    }

    public bool TryGetByKey(TKey key, out TValue value) =>
        _forward.TryGetValue(key, out value!);

    public bool TryGetByValue(TValue value, out TKey key) =>
        _reverse.TryGetValue(value, out key!);

    public TValue this[TKey key] => _forward[key];
    public TKey this[TValue value] => _reverse[value];

    public bool RemoveByKey(TKey key)
    {
        if (_forward.TryGetValue(key, out var value))
        {
            _forward.Remove(key);
            _reverse.Remove(value);
            return true;
        }
        return false;
    }

    public bool RemoveByValue(TValue value)
    {
        if (_reverse.TryGetValue(value, out var key))
        {
            _reverse.Remove(value);
            _forward.Remove(key);
            return true;
        }
        return false;
    }

    public Dictionary<TKey, TValue> ToDictionary() => _forward.ToDictionary();
}