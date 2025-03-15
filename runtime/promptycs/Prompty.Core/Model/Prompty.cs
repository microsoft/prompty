using System.Text.RegularExpressions;

namespace Prompty.Core
{
    public partial class Prompty
    {
        private const string PromptyPattern = /* lang=regex */ """
        ^---\s*$\n      # Start of YAML front matter, a line beginning with "---" followed by optional whitespace
        (?<header>.*?)  # Capture the YAML front matter, everything up to the next "---" line
        ^---\s*$\n      # End of YAML front matter, a line beginning with "---" followed by optional whitespace
        (?<content>.*)  # Capture the content after the YAML front matter
        """;

        /// <summary>Regex for parsing the YAML frontmatter and content from the prompty template.</summary>
#if NET
        [GeneratedRegex(PromptyPattern, RegexOptions.Multiline | RegexOptions.Singleline | RegexOptions.IgnorePatternWhitespace)]
        private static partial Regex PromptyRegex();
#else
        private static Regex PromptyRegex() => s_promptyRegex;
        private static readonly Regex s_promptyRegex = new(PromptyPattern, RegexOptions.Multiline | RegexOptions.Singleline | RegexOptions.IgnorePatternWhitespace | RegexOptions.Compiled);
#endif

        // metadata
        public string Name { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public string[] Authors { get; set; } = [];
        public string[] Tags { get; set; } = [];
        public string Version { get; set; } = string.Empty;

        // base
        public string Base { get; set; } = string.Empty;
        public Prompty? BasePrompty { get; set; } = null;

        // model settings
        public Model? Model { get; set; } = null;

        // sample
        // public Dictionary<string, object> Sample { get; set; } = [];

        // properties
        public Dictionary<string, Property> Inputs { get; set; } = new Dictionary<string, Property>();
        public Dictionary<string, Property> Outputs { get; set; } = new Dictionary<string, Property>();

        // template
        public Template? Template { get; set; } = null;

        // internals
        public string? Path { get; set; } = string.Empty;
        public object Content { get; set; } = string.Empty;
    }
}
