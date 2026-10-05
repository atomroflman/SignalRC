using LteCar.Shared;

public class ServerCarConfigurationService {
    public event Action OnConfigurationChanged = delegate { };

    private CarConfiguration _configuration = null!;
    public CarConfiguration Configuration {
        get { return _configuration;}
        set {
            if (Object.ReferenceEquals(_configuration, value))
                return;
            var newConfig = MergeObjects(_configuration, value);
            if (!CheckForChanges(newConfig, _configuration))
                return;
            _configuration = value;
            OnConfigurationChanged?.Invoke();
        }
    }

    /// <summary>
    /// Server-assigned Car ID - available after successful connection to server
    /// </summary>
    public int? ServerAssignedCarId => Configuration?.ServerAssignedCarId;

    public bool CheckForChanges(object newConfig, object configuration)
    {
        if (newConfig == null ^ configuration == null)
            return true;
        if (newConfig == null && configuration == null)
            return false;
        var t = newConfig!.GetType();
        if (t != configuration!.GetType())
            throw new ArgumentException("Objects must be of the same type");
        foreach (var prop in t.GetProperties()) {
            var newValue = prop.GetValue(newConfig, null);
            var currentValue = prop.GetValue(configuration, null);
            if (newValue == null && currentValue == null)
                continue;
            if (newValue == null || currentValue == null)
                return true;
            if (prop.PropertyType.IsAssignableTo(typeof(IConfigurationModel)))
            {
                if (CheckForChanges(newValue!, currentValue!))
                    return true;
            }
            if (newValue != currentValue)
                return true;
        }
        return false;
    }


    public object MergeObjects(object current, object next) 
    {
        if (current == null && next == null)
            return null!;
        if (current == null)
            return next!;
        var t = current.GetType();
        if (t != next.GetType())
            throw new ArgumentException("Objects must be of the same type");
        var res = t.GetConstructor(new Type[] {})?.Invoke(null);
        if (res == null)
            throw new ArgumentException("Cannot create instance of type " + t.Name);
        foreach (var prop in t.GetProperties()) {
            var currentValue = prop.GetValue(current, null);
            var nextValue = prop.GetValue(next, null);
            if (currentValue == null && nextValue == null)
                continue;
            if (prop.PropertyType.IsAssignableTo(typeof(IConfigurationModel)))
            {
                currentValue = MergeObjects(currentValue!, nextValue!);
            }
            if (Object.ReferenceEquals(currentValue, nextValue))
                continue;
            prop.SetValue(res, nextValue ?? currentValue);
        }
        return res;
    }

    /// <summary>
    /// Forces Update of the configuration.
    /// Does not check for changes.
    /// </summary>
    public void UpdateConfiguration(CarConfiguration config)
    {
        _configuration = config;
        OnConfigurationChanged?.Invoke();
    }
}