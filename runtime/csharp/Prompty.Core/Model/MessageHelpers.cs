// Copyright (c) Microsoft. All rights reserved.

// --- Runtime helpers (manually maintained) ---
// This file extends the generated Message class with convenience members
// used by the Prompty pipeline and wire-format converters.

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

public partial class Message
{
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
