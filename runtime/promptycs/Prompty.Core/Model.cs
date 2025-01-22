namespace Prompty.Core
{
    public class Model : Settings
    {
        public string Api { get; set; } = string.Empty;
        public Configuration Configuration { get; set; } = new Configuration();
        public Settings Parameters { get; set; } = new Settings();
        public Settings Response { get; set; } = new Settings();
        public Model() { }

        public Model(Dictionary<string, object> config)
        {
            Api = config.GetAndRemove<string>("api") ?? string.Empty;
            Configuration = new Configuration(config.GetAndRemoveConfig("configuration"));
            Parameters = new Settings(config.GetAndRemoveConfig("parameters"));
            Response = new Settings(config.GetAndRemoveConfig("response"));
            Items = config;
        }
    }
}
