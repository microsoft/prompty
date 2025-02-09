namespace Prompty.Core
{
    public class Template
    {
        public string Type { get; set; } = string.Empty;
        public string Parser { get; set; } = string.Empty;

        public Template()
        {
        }

        internal Template(Dictionary<string, object>? property)
        {
            Type = property?.GetValue<string>("type") ?? "liquid";
            Parser = property?.GetValue<string>("parser") ?? "prompty";
        }
    }
}
