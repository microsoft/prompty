namespace Prompty.Core.Tests;

public class LoadAgentTests
{
    public LoadAgentTests()
    {
        Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", "ENDPOINT_VALUE");
    }

    [Theory]
    [InlineData("agents/basic.prompty")]
    [InlineData("agents/claim_buddy.prompty")]
    [InlineData("agents/code-interpreter.prompty")]
    [InlineData("agents/on-your-data.prompty")]
    [InlineData("agents/on-your-file.prompty")]
    [InlineData("agents/openapi.prompty")]
    [InlineData("agents/rag-teams-agent.prompty")]
    [InlineData("agents/web-search.prompty")]
    public void ItCanLoad(string path)
    {
        // Arrange & Act
        var prompty = Prompty.Load(path);

        // Assert
        Assert.NotNull(prompty);
        Assert.NotNull(prompty.Content);
    }

    [Fact]
    public void ItCanLoadWithMetadata()
    {
        // Arrange & Act
        var prompty = Prompty.Load("agents/basic.prompty");

        // Assert
        Assert.NotNull(prompty);
        Assert.Equal("my_agent_21", prompty.Id);
        Assert.Equal("Basic Agent", prompty.Name);
        Assert.Equal("A basic prompt that uses the gpt-4o chat API to answer questions", prompty.Description);
        Assert.NotNull(prompty.Metadata);
        Assert.NotNull(prompty.Metadata.Authors);
        Assert.Equal(2, prompty.Metadata.Authors.Count);
        Assert.NotNull(prompty.Metadata.Tags);
        Assert.Equal(2, prompty.Metadata.Tags.Count);
    }

    [Fact]
    public void ItCanLoadWithModel()
    {
        // Arrange & Act
        var prompty = Prompty.Load("agents/basic.prompty");

        // Assert
        Assert.NotNull(prompty);
        Assert.NotNull(prompty.Model);
        Assert.Equal("chat", prompty.Model.Api);
        Assert.NotNull(prompty.Model.Connection);
        Assert.Equal("azure_openai", prompty.Model.Connection.Type);
        Assert.Equal("gpt-4o", prompty.Model.Connection.ExtensionData["azure_deployment"]);
        Assert.NotNull(prompty.Model.Options);
        Assert.Equal("150", prompty.Model.Options["max_tokens"]);
        Assert.Equal("0.5", prompty.Model.Options["temperature"]);
        Assert.Equal("1", prompty.Model.Options["top_p"]);
        Assert.Equal("0", prompty.Model.Options["frequency_penalty"]);
        Assert.Equal("0", prompty.Model.Options["presence_penalty"]);
    }

    [Fact]
    public void ItCanLoadWithInputs()
    {
        // Arrange & Act
        var prompty = Prompty.Load("agents/basic.prompty");

        // Assert
        Assert.NotNull(prompty);
        Assert.NotNull(prompty.Inputs);
        Assert.Equal(3, prompty.Inputs.Count);
        Assert.NotNull(prompty.Inputs["firstName"]);
        Assert.NotNull(prompty.Inputs["lastName"]);
        Assert.NotNull(prompty.Inputs["question"]);
        Assert.Equal("firstName", prompty.Inputs["firstName"].Name);
        Assert.Equal(PropertyType.String, prompty.Inputs["firstName"].Type);
        Assert.Equal("User", prompty.Inputs["firstName"].Default);
        Assert.Equal("April", prompty.Inputs["firstName"].Sample);
        Assert.Equal("The first name of the customer", prompty.Inputs["firstName"].Description);
        Assert.True(prompty.Inputs["firstName"].Strict);
        Assert.True(prompty.Inputs["firstName"].Required);
        Assert.Null(prompty.Inputs["firstName"].JsonSchema);
    }

    [Fact]
    public void ItCanLoadWithOutputs()
    {
        // Arrange & Act
        var prompty = Prompty.Load("agents/basic.prompty");

        // Assert
        Assert.NotNull(prompty);
        Assert.NotNull(prompty.Outputs);
    }

    [Fact]
    public void ItCanLoadWithTools()
    {
        // Arrange & Act
        var prompty = Prompty.Load("agents/basic.prompty");

        // Assert
        Assert.NotNull(prompty);
        Assert.NotNull(prompty.Tools);
    }

    [Fact]
    public void ItCanLoadWithTemplate()
    {
        // Arrange & Act
        var prompty = Prompty.Load("agents/basic.prompty");

        // Assert
        Assert.NotNull(prompty);
        Assert.NotNull(prompty.Template);
    }
}
