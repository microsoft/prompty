// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

/// <summary>
/// Valid message roles in the Prompty pipeline.
/// </summary>
public static class Roles
{
    public const string System = "system";
    public const string User = "user";
    public const string Assistant = "assistant";
    public const string Developer = "developer";
    public const string Tool = "tool";

    public static readonly IReadOnlySet<string> All = new HashSet<string>
    {
        System, User, Assistant, Developer, Tool
    };
}

/// <summary>
/// Input kinds that receive special handling during rendering/parsing.
/// </summary>
public static class RichKinds
{
    public static readonly IReadOnlySet<string> All = new HashSet<string>
    {
        "thread", "image", "file", "audio"
    };
}

/// <summary>
/// Base class for content parts within a message.
/// </summary>
public abstract class ContentPart
{
    public abstract string Kind { get; }
}

/// <summary>
/// Plain text content.
/// </summary>
public class TextPart : ContentPart
{
    public override string Kind => "text";
    public string Value { get; set; } = "";
}

/// <summary>
/// Image content with source URL/base64 and optional detail level.
/// </summary>
public class ImagePart : ContentPart
{
    public override string Kind => "image";
    public string Source { get; set; } = "";
    public string? Detail { get; set; }
    public string? MediaType { get; set; }
}

/// <summary>
/// File content with source URL/path.
/// </summary>
public class FilePart : ContentPart
{
    public override string Kind => "file";
    public string Source { get; set; } = "";
    public string? MediaType { get; set; }
}

/// <summary>
/// Audio content with source URL/base64.
/// </summary>
public class AudioPart : ContentPart
{
    public override string Kind => "audio";
    public string Source { get; set; } = "";
    public string? MediaType { get; set; }
}

/// <summary>
/// A message in the LLM conversation with role, content parts, and metadata.
/// </summary>
public class Message
{
    public string Role { get; set; } = Roles.User;
    public List<ContentPart> Parts { get; set; } = [];
    public Dictionary<string, object?> Metadata { get; set; } = [];

    /// <summary>
    /// Concatenated text from all TextParts.
    /// </summary>
    public string Text => string.Join("", Parts.OfType<TextPart>().Select(p => p.Value));

    /// <summary>
    /// Returns the content as a simple string if only text parts exist,
    /// or as a list of wire-format dictionaries for multimodal content.
    /// </summary>
    public object ToTextContent()
    {
        if (Parts.All(p => p is TextPart))
            return Text;

        return Parts.Select<ContentPart, Dictionary<string, object?>>(p => p switch
        {
            TextPart t => new() { ["type"] = "text", ["text"] = t.Value },
            ImagePart i => new()
            {
                ["type"] = "image_url",
                ["image_url"] = new Dictionary<string, object?>
                {
                    ["url"] = i.Source,
                    ["detail"] = i.Detail ?? "auto",
                },
            },
            FilePart f => new() { ["type"] = "file", ["file"] = new Dictionary<string, object?> { ["url"] = f.Source } },
            AudioPart a => new() { ["type"] = "input_audio", ["input_audio"] = new Dictionary<string, object?> { ["url"] = a.Source } },
            _ => new() { ["type"] = p.Kind },
        }).ToList();
    }
}

/// <summary>
/// Placeholder inserted by renderers to mark where thread/rich content should be expanded.
/// </summary>
public class ThreadMarker
{
    public string Name { get; set; } = "thread";
    public string Kind { get; set; } = "thread";
}
