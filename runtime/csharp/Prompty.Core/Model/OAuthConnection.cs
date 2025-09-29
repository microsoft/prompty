// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json.Serialization;
using YamlDotNet.Core;
using YamlDotNet.Core.Events;
using YamlDotNet.Serialization;
using YamlDotNet.RepresentationModel;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Connection configuration for AI services using OAuth authentication.
/// </summary>
[JsonConverter(typeof(OAuthConnectionJsonConverter))]
public class OAuthConnection : Connection, IYamlConvertible
{
    /// <summary>
    /// Initializes a new instance of <see cref="OAuthConnection"/>.
    /// </summary>
#pragma warning disable CS8618
    public OAuthConnection()
    {
    }
#pragma warning restore CS8618

    /// <summary>
    /// The Authentication kind for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)
    /// </summary>
    public override string Kind { get; set; } = "oauth";

    /// <summary>
    /// The endpoint URL for the AI service
    /// </summary>
    public string Endpoint { get; set; } = string.Empty;

    /// <summary>
    /// The OAuth client ID for authenticating with the AI service
    /// </summary>
    public string ClientId { get; set; } = string.Empty;

    /// <summary>
    /// The OAuth client secret for authenticating with the AI service
    /// </summary>
    public string ClientSecret { get; set; } = string.Empty;

    /// <summary>
    /// The OAuth token URL for obtaining access tokens
    /// </summary>
    public string TokenUrl { get; set; } = string.Empty;

    /// <summary>
    /// The scopes required for the OAuth token
    /// </summary>
    public IList<string> Scopes { get; set; } = [];


    public new void Read(IParser parser, Type expectedType, ObjectDeserializer nestedObjectDeserializer)
    {



        if (parser.TryConsume<MappingStart>(out var _))
        {
            var node = nestedObjectDeserializer(typeof(YamlMappingNode)) as YamlMappingNode;
            if (node == null)
            {
                throw new YamlException("Expected a mapping node for type OAuthConnection");
            }

        }
        else
        {
            throw new YamlException($"Unexpected YAML token when parsing OAuthConnection: {parser.Current?.GetType().Name ?? "null"}");
        }
    }

    public new void Write(IEmitter emitter, ObjectSerializer nestedObjectSerializer)
    {
        emitter.Emit(new MappingStart());

        emitter.Emit(new Scalar("kind"));
        nestedObjectSerializer(Kind);

        emitter.Emit(new Scalar("endpoint"));
        nestedObjectSerializer(Endpoint);

        emitter.Emit(new Scalar("clientId"));
        nestedObjectSerializer(ClientId);

        emitter.Emit(new Scalar("clientSecret"));
        nestedObjectSerializer(ClientSecret);

        emitter.Emit(new Scalar("tokenUrl"));
        nestedObjectSerializer(TokenUrl);

        emitter.Emit(new Scalar("scopes"));
        nestedObjectSerializer(Scopes);
    }
}
