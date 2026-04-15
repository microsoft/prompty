// Copyright (c) Microsoft. All rights reserved.

using dotenv.net;
using Prompty.Core;

namespace Prompty.Providers.Tests.Integration;

/// <summary>
/// Base class for integration tests that hit real LLM endpoints.
/// Loads .env from the runtime/csharp/ directory and provides helpers
/// to skip tests when required env vars are missing.
/// </summary>
public abstract class IntegrationTestBase
{
    static IntegrationTestBase()
    {
        // Walk up from the test bin directory to find the .env file at runtime/csharp/.env
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var envFile = Path.Combine(dir.FullName, ".env");
            if (File.Exists(envFile))
            {
                DotEnv.Load(new DotEnvOptions(envFilePaths: [envFile]));
                break;
            }
            dir = dir.Parent;
        }
    }

    /// <summary>
    /// Returns the value of the given environment variable, or skips the test if not set.
    /// </summary>
    protected static string GetEnvOrSkip(string varName)
    {
        var value = Environment.GetEnvironmentVariable(varName);
        if (string.IsNullOrEmpty(value))
            Skip.If(true, $"Environment variable '{varName}' is not set.");
        return value!;
    }

    // -----------------------------------------------------------------------
    // Environment variable accessors
    // -----------------------------------------------------------------------

    protected static string? OpenAIApiKey => Environment.GetEnvironmentVariable("OPENAI_API_KEY");
    protected static string? OpenAIBaseUrl => Environment.GetEnvironmentVariable("OPENAI_BASE_URL");
    protected static string OpenAIModel => Environment.GetEnvironmentVariable("OPENAI_MODEL") ?? "gpt-4o-mini";
    protected static string OpenAIEmbeddingModel => Environment.GetEnvironmentVariable("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";
    protected static string? OpenAIImageModel => Environment.GetEnvironmentVariable("OPENAI_IMAGE_MODEL");

    protected static string? AzureOpenAIEndpoint => Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT");
    protected static string? AzureOpenAIApiKey => Environment.GetEnvironmentVariable("AZURE_OPENAI_API_KEY");
    protected static string? AzureOpenAIChatDeployment => Environment.GetEnvironmentVariable("AZURE_OPENAI_CHAT_DEPLOYMENT");
    protected static string? AzureOpenAIEmbeddingDeployment => Environment.GetEnvironmentVariable("AZURE_OPENAI_EMBEDDING_DEPLOYMENT");

    protected static string? AnthropicApiKey => Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY");

    protected static bool HasOpenAI => !string.IsNullOrEmpty(OpenAIApiKey);
    protected static bool HasAzure => !string.IsNullOrEmpty(AzureOpenAIApiKey)
                                      && !string.IsNullOrEmpty(AzureOpenAIEndpoint)
                                      && !string.IsNullOrEmpty(AzureOpenAIChatDeployment);
    protected static bool HasAzureEmbedding => HasAzure && !string.IsNullOrEmpty(AzureOpenAIEmbeddingDeployment);
    protected static bool HasAnthropic => !string.IsNullOrEmpty(AnthropicApiKey);

    // -----------------------------------------------------------------------
    // Agent builders (matching Python/TS patterns)
    // -----------------------------------------------------------------------

    /// <summary>
    /// Create an OpenAI agent for integration testing.
    /// Skips the test if OPENAI_API_KEY is not set.
    /// </summary>
    protected static Core.Prompty MakeOpenAIAgent(
        string apiType = "chat",
        string? model = null,
        ModelOptions? options = null,
        IList<Tool>? tools = null,
        IList<Property>? outputs = null,
        IDictionary<string, object>? metadata = null)
    {
        var apiKey = GetEnvOrSkip("OPENAI_API_KEY");
        model ??= OpenAIModel;

        var connectionDict = new Dictionary<string, object?>
        {
            ["kind"] = "key",
            ["apiKey"] = apiKey,
        };
        var baseUrl = OpenAIBaseUrl;
        if (!string.IsNullOrEmpty(baseUrl))
            connectionDict["endpoint"] = baseUrl;

        var modelDict = new Dictionary<string, object?>
        {
            ["id"] = model,
            ["provider"] = "openai",
            ["apiType"] = apiType,
            ["connection"] = connectionDict,
        };

        var data = new Dictionary<string, object?>
        {
            ["name"] = "integration-test",
            ["model"] = modelDict,
        };

        var agent = Core.Prompty.Load(data, new LoadContext());

        if (options is not null && agent.Model is not null)
            agent.Model.Options = options;
        if (tools is not null)
            agent.Tools = tools;
        if (outputs is not null)
            agent.Outputs = outputs;
        if (metadata is not null)
            agent.Metadata = metadata;

        return agent;
    }

    /// <summary>
    /// Create an Azure/Foundry agent for integration testing.
    /// Skips the test if Azure env vars are not set.
    /// </summary>
    protected static Core.Prompty MakeFoundryAgent(
        string apiType = "chat",
        string? deployment = null,
        ModelOptions? options = null,
        IList<Tool>? tools = null,
        IList<Property>? outputs = null,
        IDictionary<string, object>? metadata = null)
    {
        var apiKey = GetEnvOrSkip("AZURE_OPENAI_API_KEY");
        var endpoint = GetEnvOrSkip("AZURE_OPENAI_ENDPOINT");
        deployment ??= GetEnvOrSkip("AZURE_OPENAI_CHAT_DEPLOYMENT");

        var connectionDict = new Dictionary<string, object?>
        {
            ["kind"] = "key",
            ["apiKey"] = apiKey,
            ["endpoint"] = endpoint,
        };

        var modelDict = new Dictionary<string, object?>
        {
            ["id"] = deployment,
            ["provider"] = "foundry",
            ["apiType"] = apiType,
            ["connection"] = connectionDict,
        };

        var data = new Dictionary<string, object?>
        {
            ["name"] = "integration-test-foundry",
            ["model"] = modelDict,
        };

        var agent = Core.Prompty.Load(data, new LoadContext());

        if (options is not null && agent.Model is not null)
            agent.Model.Options = options;
        if (tools is not null)
            agent.Tools = tools;
        if (outputs is not null)
            agent.Outputs = outputs;
        if (metadata is not null)
            agent.Metadata = metadata;

        return agent;
    }

    /// <summary>
    /// Create an Anthropic agent for integration testing.
    /// Skips the test if ANTHROPIC_API_KEY is not set.
    /// </summary>
    protected static Core.Prompty MakeAnthropicAgent(
        string apiType = "chat",
        string model = "claude-sonnet-4-5-20250929",
        ModelOptions? options = null,
        IList<Tool>? tools = null,
        IList<Property>? outputs = null,
        IDictionary<string, object>? metadata = null)
    {
        var apiKey = GetEnvOrSkip("ANTHROPIC_API_KEY");

        var connectionDict = new Dictionary<string, object?>
        {
            ["kind"] = "key",
            ["apiKey"] = apiKey,
        };

        var modelDict = new Dictionary<string, object?>
        {
            ["id"] = model,
            ["provider"] = "anthropic",
            ["apiType"] = apiType,
            ["connection"] = connectionDict,
        };

        var data = new Dictionary<string, object?>
        {
            ["name"] = "integration-test-anthropic",
            ["model"] = modelDict,
        };

        var agent = Core.Prompty.Load(data, new LoadContext());

        if (options is not null && agent.Model is not null)
            agent.Model.Options = options;
        if (tools is not null)
            agent.Tools = tools;
        if (outputs is not null)
            agent.Outputs = outputs;
        if (metadata is not null)
            agent.Metadata = metadata;

        return agent;
    }

    // -----------------------------------------------------------------------
    // Message helpers
    // -----------------------------------------------------------------------

    protected static List<Message> HelloMessages() =>
    [
        new Message
        {
            Role = Roles.System,
            Parts = [new TextPart { Value = "You are a helpful assistant. Reply in one short sentence." }],
        },
        new Message
        {
            Role = Roles.User,
            Parts = [new TextPart { Value = "Say hello." }],
        },
    ];

    protected static List<Message> ChatMessages() =>
    [
        new Message
        {
            Role = Roles.System,
            Parts = [new TextPart { Value = "You are a helpful assistant. Be brief." }],
        },
        new Message
        {
            Role = Roles.User,
            Parts = [new TextPart { Value = "Say exactly: hello world" }],
        },
    ];

    protected static List<Message> EmbeddingMessages(params string[] texts) =>
        texts.Select(t => new Message
        {
            Role = Roles.User,
            Parts = [new TextPart { Value = t }],
        }).ToList();

    protected static List<Message> StructuredMessages() =>
    [
        new Message
        {
            Role = Roles.System,
            Parts = [new TextPart { Value = "You are a data assistant. Always respond with the requested JSON structure." }],
        },
        new Message
        {
            Role = Roles.User,
            Parts = [new TextPart { Value = "Give me information about Tokyo." }],
        },
    ];

    protected static ModelOptions LowTempOptions(int maxTokens = 50) => new()
    {
        Temperature = 0f,
        MaxOutputTokens = maxTokens,
    };

    /// <summary>
    /// Creates a FunctionTool for the standard get_weather test tool.
    /// </summary>
    protected static FunctionTool WeatherTool() => new()
    {
        Name = "get_weather",
        Kind = "function",
        Description = "Get the current weather for a city. Always call this when asked about weather.",
        Parameters =
        [
            new Property { Name = "city", Kind = "string", Description = "The city name, e.g. 'Seattle'", Required = true },
        ],
    };

    /// <summary>
    /// Standard weather tool function for agent loop tests.
    /// </summary>
    protected static Task<ToolResult> GetWeatherAsync(string args)
    {
        // Parse simple JSON to extract city name
        var city = "unknown";
        try
        {
            var json = System.Text.Json.JsonDocument.Parse(args);
            if (json.RootElement.TryGetProperty("city", out var cityProp))
                city = cityProp.GetString() ?? "unknown";
        }
        catch
        {
            // Fallback if args isn't valid JSON
        }
        return Task.FromResult<ToolResult>($"72°F and sunny in {city}");
    }

    /// <summary>
    /// Creates the standard output schema for structured output tests (city info).
    /// </summary>
    protected static IList<Property> CityOutputSchema() =>
    [
        new Property { Name = "city", Kind = "string", Description = "The city name" },
        new Property { Name = "population", Kind = "integer", Description = "Approximate population" },
        new Property { Name = "country", Kind = "string", Description = "The country" },
    ];
}


