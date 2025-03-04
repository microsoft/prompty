namespace Prompty.Core
{
    public class Template
    {
        public string Format { get; set; } = string.Empty;
        public string Parser { get; set; } = string.Empty;
        public bool Strict { get; set; } = true;
        internal string? Nonce { get; set; }
        internal object Content { get; set; } = string.Empty;

        public Template()
        {
        }

        internal Template(Dictionary<string, object>? property)
        {
            Format = property?.GetValue<string>("format") ?? "liquid";
            Parser = property?.GetValue<string>("parser") ?? "prompty";
            var strict = property?.GetValue<string>("strict") ?? "true";
            Strict = strict.Trim().ToLower() == "true";
        }
    }
}
