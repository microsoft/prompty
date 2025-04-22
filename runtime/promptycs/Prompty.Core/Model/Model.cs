namespace Prompty.Core;

/// <summary>
/// Defines the model to be used by an Prompty file.
/// </summary>
public sealed class Model
{
    /// <summary>
    /// The default API type.
    /// </summary>
    private const string DefaultApi = "chat";

    /// <summary>
    /// Gets or sets the unique identifier of the model.
    /// </summary>
    /// <remarks>
    /// This is typically a short string, but can be any string that is compatible with the Prompty file.
    /// Typically, depending on the provider, this can replace the entire connection settings if
    /// the provider has a way to resolve the model connection from the id.
    /// </remarks>
    public string? Id { get; set; }

    /// <summary>
    /// Gets or sets the type of API used by the Prompty file.
    /// </summary>
    /// <remarks>
    /// This is typically a chat or completion API, but can be any API that is compatible with the Prompty file.
    /// </remarks>
    public string Api
    {
        get => this._api ?? DefaultApi;
        set
        {
            //Verify.NotNullOrWhiteSpace(value);
            this._api = value;
        }
    }

    /// <summary>
    /// Gets or sets the options used by the Prompty file.
    /// </summary>
    /// <remarks>
    /// This is typically a set of options that are compatible with the API and connection used by the Prompty file.
    /// This optional section is used to specify the options to be used when executing the Prompty file.
    /// If this section is not included, the runtime will use the default options for the API and connection used by the Prompty file.
    /// </remarks>
    public IDictionary<string, object>? Options { get; set; }

    /// <summary>
    /// Gets or sets the connection used by the Prompty file.
    /// </summary>
    /// <remarks>
    /// This is typically a type and deployment, but can be any connection that is compatible with the Prompty file.
    /// The type parameter is used to tell the runtime how to load and execute the Prompty file.
    /// The deployment parameter, in this example, is used to tell the runtime which deployment to use when executing against Azure OpenAI.
    /// </remarks>
    public Connection? Connection { get; set; }

    #region
    private string? _api;
    #endregion
}

