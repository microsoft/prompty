﻿using System.Text.Json.Serialization;

namespace Prompty.Core;

/// <summary>
/// Defines the metadata for a Prompty file.
/// </summary>
public sealed class Metadata
{
    /// <summary>
    /// Gets or sets the collection of authors associated with the agent.
    /// </summary>
    public IList<string>? Authors { get; set; }

    /// <summary>
    /// Gets or sets the collection of tags associated with the agent.
    /// </summary>
    public IList<string>? Tags { get; set; }

    /// <summary>
    /// Extra properties that may be included in the serialized agent metadata.
    /// </summary>
    /// <remarks>
    /// Used to store agent specific metadata.
    /// </remarks>
    [JsonExtensionData]
    public IDictionary<string, object?> ExtensionData
    {
        get => this._extensionData ??= new Dictionary<string, object?>();
        set
        {
            //Verify.NotNull(value);
            this._extensionData = value;
        }
    }

    #region private
    private IDictionary<string, object?>? _extensionData;
    #endregion
}
