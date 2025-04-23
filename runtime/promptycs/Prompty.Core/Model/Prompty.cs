using System.Text.RegularExpressions;

namespace Prompty.Core;

/// <summary>
/// Defines a Prompty template which can be used to represent a prompt template or an Prompty file template.
/// </summary>
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

    /// <summary>
    /// Gets or sets the version of the Prompty file.
    /// </summary>
    public string? Version { get; set; }

    /// <summary>
    /// Gets or sets the unique identifier of the Prompty file.
    /// </summary>
    public string? Id { get; set; }

    /// <summary>
    /// Gets or sets the type of the Prompty file.
    /// </summary>
    public string? Type { get; set; }

    /// <summary>
    /// Gets or sets the name of the Prompty file.
    /// </summary>
    public string? Name { get; set; }

    /// <summary>
    /// Gets or sets the short description of the Prompty file.
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// Gets or sets the metadata associated with the Prompty file, including its authors and tags
    /// as specific metadata but can accept any optional metadata that can be handled by the provider.
    /// </summary>
    public Metadata? Metadata { get; set; }

    // model settings
    public Model? Model { get; set; } = null;

    /// <summary>
    /// Gets or sets the collection of inputs used by the Prompty file, including their type, default value, and description.
    /// </summary>
    /// <remarks>
    /// This is typically a set of inputs that will be used as parameters that participate in the template rendering.
    /// </remarks>
    public IDictionary<string, Input> Inputs { get; set; } = new Dictionary<string, Input>();

    /// <summary>
    /// Gets or sets the collection of outputs supported by the Prompty file, including their type and description.
    /// </summary>
    public IDictionary<string, Output>? Outputs { get; set; }

    /// <summary>
    /// Gets or sets the template options used by the Prompty file, including its type and parser.
    /// </summary>
    public Template? Template { get; set; }

    /// <summary>
    /// Gets or sets the collection of tools used by the agent.
    /// </summary>
    public IList<Tool>? Tools { get; set; }

    // base
    public string Base { get; set; } = string.Empty;
    public Prompty? BasePrompty { get; set; } = null;


    // internals
    public string? Path { get; set; } = string.Empty;
    public object Content { get; set; } = string.Empty;
}
