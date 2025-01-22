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
            if (property == null)
            {
                Type = "jinja2";
                Parser = "prompty";
            }
            else
            {
                Type = property.GetValue<string>("type") ?? string.Empty;
                Parser = property.GetValue<string>("parser") ?? string.Empty;
            }
        }
    }
}
