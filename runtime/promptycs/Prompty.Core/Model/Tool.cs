using System.Text.Json.Serialization;

namespace Prompty.Core;

/// <summary>
/// The options for defining a tool.
/// </summary>
public sealed class Tool
{
    /// <summary>
    /// The id of the tool.
    /// </summary>
    public string? Id { get; set; }

    /// <summary>
    /// The type of the tool.
    /// </summary>
    /// <remarks>
    /// Used to identify which type of tool is being used e.g., code interpreter, openapi, ...
    /// </remarks>
    public string? Type { get; set; }

    /// <summary>
    /// The description of the tool.
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// Gets or sets the options for the tool.
    /// </summary>
    /// <remarks>
    /// Used to store tool specific options e.g., files associated with the tool, etc.
    /// </remarks>
    [JsonExtensionData]
    public IDictionary<string, object?>? Options { get; set; }
}