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
        IList<Property>? properties,
        bool strict = false,
        ISet<string>? excludedPropertyNames = null)
    {
        var result = new Dictionary<string, object?> { ["type"] = "object" };

        if (properties is null || properties.Count == 0)
            return result;

        var props = new Dictionary<string, object?>();
        var required = new List<string>();

        foreach (var prop in properties)
        {
            if (string.IsNullOrEmpty(prop.Name)) continue;
            if (excludedPropertyNames?.Contains(prop.Name) == true) continue;

            props[prop.Name] = PropertyToJsonSchema(prop);

            if (prop.Required == true)
                required.Add(prop.Name);
        }

        result["properties"] = props;
        if (strict)
        {
            // OpenAI strict mode requires ALL properties in the required array
            result["required"] = props.Keys.ToList();
            result["additionalProperties"] = false;
        }
        else if (required.Count > 0)
        {
            result["required"] = required;
        }

        return result;
    }

    /// <summary>
    /// Convert a single Property to a JSON Schema definition (recursive for arrays/objects).
    /// </summary>
    public static Dictionary<string, object?> PropertyToJsonSchema(Property prop)
    {
        var schema = new Dictionary<string, object?>
        {
            ["type"] = MapKindToJsonType(prop.Kind),
        };

        if (!string.IsNullOrEmpty(prop.Description))
            schema["description"] = prop.Description;

        if (prop.EnumValues is not null && prop.EnumValues.Count > 0)
            schema["enum"] = prop.EnumValues;

        // Array items — recurse into item schema
        if (prop is ArrayProperty arrayProp)
        {
            schema["items"] = arrayProp.Items is not null
                ? PropertyToJsonSchema(arrayProp.Items)
                : new Dictionary<string, object?> { ["type"] = "string" };
        }

        // Object properties — recurse into nested properties
        if (prop is ObjectProperty objectProp)
        {
            if (objectProp.Properties is not null && objectProp.Properties.Count > 0)
            {
                var nested = new Dictionary<string, object?>();
                var nestedRequired = new List<string>();
                foreach (var p in objectProp.Properties)
                {
                    if (string.IsNullOrEmpty(p.Name)) continue;
                    nested[p.Name] = PropertyToJsonSchema(p);
                    nestedRequired.Add(p.Name);
                }
                schema["properties"] = nested;
                schema["required"] = nestedRequired;
            }
            else
            {
                schema["properties"] = new Dictionary<string, object?>();
                schema["required"] = new List<string>();
            }
            schema["additionalProperties"] = false;
        }

        return schema;
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
