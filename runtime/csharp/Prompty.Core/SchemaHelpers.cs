// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

/// <summary>
/// Provider-agnostic helpers for converting Prompty model types to standard wire formats.
/// Used by all providers (OpenAI, Foundry, Anthropic) for JSON Schema generation.
/// </summary>
public static class SchemaHelpers
{
    /// <summary>
    /// Convert a list of Property to a JSON Schema object dict.
    /// Used for tool parameters and structured output schemas.
    /// </summary>
    public static Dictionary<string, object?> PropertiesToJsonSchema(
        IList<Property>? properties, bool strict = false)
    {
        var result = new Dictionary<string, object?> { ["type"] = "object" };

        if (properties is null || properties.Count == 0)
            return result;

        var props = new Dictionary<string, object?>();
        var required = new List<string>();

        foreach (var prop in properties)
        {
            if (string.IsNullOrEmpty(prop.Name)) continue;

            var propSchema = new Dictionary<string, object?>
            {
                ["type"] = MapKindToJsonType(prop.Kind),
            };

            if (!string.IsNullOrEmpty(prop.Description))
                propSchema["description"] = prop.Description;

            if (prop.EnumValues is not null && prop.EnumValues.Count > 0)
                propSchema["enum"] = prop.EnumValues;

            props[prop.Name] = propSchema;

            if (prop.Required == true)
                required.Add(prop.Name);
        }

        result["properties"] = props;
        if (required.Count > 0)
            result["required"] = required;
        if (strict)
            result["additionalProperties"] = false;

        return result;
    }

    /// <summary>
    /// Maps a Prompty property kind to a JSON Schema type string.
    /// </summary>
    public static string MapKindToJsonType(string? kind) => kind?.ToLowerInvariant() switch
    {
        "string" => "string",
        "integer" => "integer",
        "float" or "number" => "number",
        "boolean" => "boolean",
        "array" => "array",
        "object" => "object",
        _ => "string",
    };
}
