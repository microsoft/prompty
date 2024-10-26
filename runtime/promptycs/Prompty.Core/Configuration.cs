namespace Prompty.Core
{
    public class Configuration : Settings
    {
        public string Type { get; set; } = string.Empty;
        public Configuration() { }
        public Configuration(Dictionary<string, object>? config)
        {
            Type = config != null ? config.GetAndRemove<string>("type") ?? string.Empty : string.Empty;
            Items = config ?? [];
        }
    }
}
