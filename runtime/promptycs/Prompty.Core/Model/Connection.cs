using System.Text.Json.Serialization;

namespace Prompty.Core;

/// <summary>
/// Defines the connection for a model.
/// </summary>
public sealed class Connection
{
    /// <summary>
    /// The type of the model connection.
    /// </summary>
    /// <remarks>
    /// Used to identify the type of deployment e.g., azure_openai, openai, ...
    /// This type will also be used for connection hosting.
    /// </remarks>
    public string? Type { get; set; }

    /// <summary>
    /// Gets or sets the Service ID of the model connection.
    /// </summary>
    public string? ServiceId { get; set; }

    /// <summary>
    /// Extra properties that may be included in the serialized model connection.
    /// </summary>
    /// <remarks>
    /// Used to store model specific connection e.g., the deployment name, endpoint, etc.
    /// </remarks>
    [JsonExtensionData]
    public Dictionary<string, object> ExtensionData
    {
        get => this._extensionData;
        set
        {
            if (value is null)
            {
                throw new ArgumentNullException(nameof(value));
            }

            this._extensionData = value;
        }
    }

    #region private
    private Dictionary<string, object> _extensionData = [];
    #endregion
}
