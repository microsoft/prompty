namespace Prompty.Core;

/// <summary>
/// Represents an output for an Prompty file.
/// </summary>
public sealed class Output
{
    /// <summary>
    /// Gets or sets the name of the output.
    /// </summary>
    public string? Name { get; set; }

    /// <summary>
    /// Gets or sets a description of the output.
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// Gets or sets JSON Schema describing this output.
    /// </summary>
    public string? JsonSchema { get; set; }
}

