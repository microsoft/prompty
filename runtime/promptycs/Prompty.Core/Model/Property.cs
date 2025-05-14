namespace Prompty.Core
{
    public class Number
    {
        public object Value { get; set; }
        public Number(object value)
        {
            Value = value;
        }
    }
    public enum PropertyType
    {
        String,
        Number,
        Array,
        Object,
        Boolean
    }

    public class Property
    {
        private static readonly Dictionary<string, PropertyType> _propertyTypes = new()
        {
            { "string", PropertyType.String },
            { "number", PropertyType.Number },
            { "array", PropertyType.Array },
            { "object", PropertyType.Object },
            { "boolean", PropertyType.Boolean }
        };

        private static readonly Dictionary<PropertyType, string> _propertyTypeNames = new()
        {
            { PropertyType.String, "string" },
            { PropertyType.Number, "number" },
            { PropertyType.Array, "array" },
            { PropertyType.Object, "object" },
            { PropertyType.Boolean, "boolean" }
        };


        public PropertyType Type { get; set; } = PropertyType.String;
        public object? Default { get; set; }
        public object? Sample { get; set; }
        public string Description { get; set; } = string.Empty;

        public Property() { }

        internal Property(Dictionary<string, object>? property)
        {
            if (property == null) return;

            Description = property.GetValue<string>("description") ?? string.Empty;


            if (!property.ContainsKey("type"))
            {
                if (Sample == null) throw new Exception("Cannot infer property type from configuration");
                Type = Property.GetPropertyTypeFromValue(Sample);
            }
            else
            {
                var pType = property.GetValue<string>("type");
                if (pType == null || !_propertyTypes.ContainsKey(pType)) throw new Exception("Invalid property type");
                Type = _propertyTypes[pType];
            }

            if (property.ContainsKey("default") && property["default"] != null)
                Default = GetPropertyValue(Type, property["default"]);
            if (property.ContainsKey("sample") && property["sample"] != null)
                Sample = GetPropertyValue(Type, property["sample"]);
        }

        internal static object? GetPropertyValue(PropertyType type, object? value)
        {
            if (value == null) return null;
            switch (type)
            {
                case PropertyType.Object:
                    return value;
                case PropertyType.String:
                    return value.ToString() ?? "";
                case PropertyType.Boolean:
                    return value.GetType() != typeof(bool) ?
                        ((string)value).Equals("true", StringComparison.OrdinalIgnoreCase) :
                        (bool)value;
                case PropertyType.Array:
                    return value;
                case PropertyType.Number:
                    if (value.GetType() == typeof(int) || value.GetType() == typeof(double) || value.GetType() == typeof(float))
                        return value;
                    else
                    {
                        var sValue = value.ToString() ?? (string)value;
                        if (sValue.Contains('.'))
                            return float.Parse(sValue);
                        else
                            return int.Parse(sValue);
                    }
                default:
                    throw new NotImplementedException();
            }
        }

        internal static PropertyType GetPropertyType(Dictionary<string, object> dictionary)
        {
            if (!dictionary.ContainsKey("type"))
            {
                var value = dictionary.GetValue<object>("default") ?? dictionary.GetValue<object>("sample");
                return Property.GetPropertyTypeFromValue(value);
            }
            else
            {
                var pType = dictionary.GetValue<string>("type");
                if (pType == null || !_propertyTypes.ContainsKey(pType)) throw new Exception("Invalid property type");
                return _propertyTypes[pType];
            }
        }

        internal static PropertyType GetPropertyTypeFromValue(object? o)
        {
            if (o == null) return PropertyType.String; // default to string

            return o switch
            {
                string => PropertyType.String,
                int or double or float => PropertyType.Number,
                bool => PropertyType.Boolean,
                List<object> or Array => PropertyType.Array,
                Dictionary<string, object> => PropertyType.Object,
                _ => throw new Exception($"Unknown property type: {o.GetType()}"),
            };
        }

        internal static Dictionary<string, Property> CreatePropertyDictionary(Dictionary<string, object> config)
        {
            var properties = new Dictionary<string, Property>();
            foreach (var key in config.Keys)
            {
                // current config
                if (config[key] == null) continue;

                // check type
                var t = Property.GetPropertyTypeFromValue(config[key]);

                // passing in a sample
                if (t != PropertyType.Object)
                {
                    properties[key] = new Property
                    {
                        Sample = config[key],
                        Type = t
                    };
                }
                else
                {
                    // check if the object is a property
                    string[] props = { "type", "default", "sample", "description" };
                    if (((Dictionary<string, object>)config[key]).Keys.All(k => props.Contains(k)))
                        properties[key] = new Property((Dictionary<string, object>)config[key]);
                    // otherwise just an object sample
                    else
                        properties[key] = new Property { Sample = config[key], Type = PropertyType.Object };
                }
            }
            return properties;
        }
    }
}
