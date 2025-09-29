// Copyright (c) Microsoft. All rights reserved.
using System.Buffers;
using System.Text.Json;
using System.Text.Json.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

public class GenericRegistryJsonConverter : JsonConverter<GenericRegistry>
{
    public override GenericRegistry Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            throw new JsonException("Cannot convert null value to GenericRegistry.");
        }
        else if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new JsonException($"Unexpected JSON token when parsing GenericRegistry: {reader.TokenType}");
        }

        using (var jsonDocument = JsonDocument.ParseValue(ref reader))
        {
            var rootElement = jsonDocument.RootElement;

            // create new instance
            var instance = new GenericRegistry();
            if (rootElement.TryGetProperty("kind", out JsonElement kindValue))
            {
                instance.Kind = kindValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: kind");
            }

            if (rootElement.TryGetProperty("repository", out JsonElement repositoryValue))
            {
                instance.Repository = repositoryValue.GetString() ?? throw new ArgumentException("Properties must contain a property named: repository");
            }

            if (rootElement.TryGetProperty("username", out JsonElement usernameValue))
            {
                instance.Username = usernameValue.GetString();
            }

            if (rootElement.TryGetProperty("password", out JsonElement passwordValue))
            {
                instance.Password = passwordValue.GetString();
            }

            return instance;
        }
    }

    public override void Write(Utf8JsonWriter writer, GenericRegistry value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("kind");
        JsonSerializer.Serialize(writer, value.Kind, options);

        writer.WritePropertyName("repository");
        JsonSerializer.Serialize(writer, value.Repository, options);

        if (value.Username != null)
        {
            writer.WritePropertyName("username");
            JsonSerializer.Serialize(writer, value.Username, options);
        }

        if (value.Password != null)
        {
            writer.WritePropertyName("password");
            JsonSerializer.Serialize(writer, value.Password, options);
        }

        writer.WriteEndObject();
    }
}