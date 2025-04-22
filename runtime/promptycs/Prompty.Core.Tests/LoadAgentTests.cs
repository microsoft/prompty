namespace Prompty.Core.Tests;

public class LoadAgentTests
{
    public LoadAgentTests()
    {
        Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", "ENDPOINT_VALUE");
    }
    /*

    [Theory]
    [InlineData("agents/basic.prompty")]
    [InlineData("agents/claim_buddy.prompty")]
    [InlineData("agents/code-interpreter.prompty")]
    [InlineData("agents/on-your-data.prompty")]
    [InlineData("agents/on-your-file.prompty")]
    [InlineData("agents/openapi.prompty")]
    [InlineData("agents/rag-teams-agent.prompty")]
    [InlineData("agents/web-search.prompty")]
    public void ItCanLoadAgent(string path)
    {
        // Arrange & Act
        var agent = Prompty.LoadAgent(path);

        // Assert
        Assert.NotNull(agent);
        Assert.NotNull(agent.Instructions);
    }

    [Fact]
    public void ItCanLoadAgentWithMetadata()
    {
        // Arrange & Act
        var agent = Prompty.LoadAgent("agents/basic.prompty");

        // Assert
        Assert.NotNull(agent);
        Assert.Equal("my_agent_21", agent.Id);
        Assert.Equal("Basic Agent", agent.Name);
        Assert.Equal("A basic prompt that uses the gpt-4o chat API to answer questions", agent.Description);
        Assert.NotNull(agent.Metadata);
        Assert.NotNull(agent.Metadata.Authors);
        Assert.Equal(2, agent.Metadata.Authors.Count);
        Assert.NotNull(agent.Metadata.Tags);
        Assert.Equal(2, agent.Metadata.Tags.Count);
    }

    [Fact]
    public void ItCanLoadAgentWithModel()
    {
        // Arrange & Act
        var agent = Prompty.LoadAgent("agents/basic.prompty");

        // Assert
        Assert.NotNull(agent);
        Assert.NotNull(agent.Model);
        Assert.Equal("chat", agent.Model.Api);
        Assert.NotNull(agent.Model.Connection);
        Assert.Equal("azure_openai", agent.Model.Connection.Type);
        Assert.Equal("gpt-4o", agent.Model.Connection.ExtensionData["azure_deployment"]);
        Assert.NotNull(agent.Model.Options);
        Assert.Equal("150", agent.Model.Options["max_tokens"]);
        Assert.Equal("0.5", agent.Model.Options["temperature"]);
        Assert.Equal("1", agent.Model.Options["top_p"]);
        Assert.Equal("0", agent.Model.Options["frequency_penalty"]);
        Assert.Equal("0", agent.Model.Options["presence_penalty"]);
    }

    [Fact]
    public void ItCanLoadAgentWithInputs()
    {
        // Arrange & Act
        var agent = Prompty.LoadAgent("agents/basic.prompty");

        // Assert
        Assert.NotNull(agent);
        Assert.NotNull(agent.Inputs);
        Assert.Equal(2, agent.Inputs.Count);
        Assert.NotNull(agent.Inputs["firstName"]);
        Assert.NotNull(agent.Inputs["lastName"]);
        Assert.NotNull(agent.Inputs["question"]);
        Assert.Equal("", agent.Inputs["firstName"].Name);
        Assert.Equal("", agent.Inputs["firstName"].Type);
        Assert.Equal("", agent.Inputs["firstName"].Name);
        Assert.Equal("", agent.Inputs["firstName"].Name);
        Assert.Equal("", agent.Inputs["firstName"].Name);
    }

    [Fact]
    public void ItCanLoadAgentWithOutputs()
    {
        // Arrange & Act
        var agent = Prompty.LoadAgent("agents/basic.prompty");

        // Assert
        Assert.NotNull(agent);
        Assert.NotNull(agent.Model);
        Assert.Equal("chat", agent.Model.Api);
        Assert.NotNull(agent.Model.Connection);
        Assert.Equal("azure_openai", agent.Model.Connection.Type);
        Assert.Equal("gpt-4o", agent.Model.Connection.ExtensionData["azure_deployment"]);
        Assert.NotNull(agent.Model.Options);
        Assert.Equal("150", agent.Model.Options["max_tokens"]);
        Assert.Equal("0.5", agent.Model.Options["temperature"]);
        Assert.Equal("1", agent.Model.Options["top_p"]);
        Assert.Equal("0", agent.Model.Options["frequency_penalty"]);
        Assert.Equal("0", agent.Model.Options["presence_penalty"]);
    }

    [Fact]
    public void ItCanLoadAgentWithTools()
    {
        // Arrange & Act
        var agent = Prompty.LoadAgent("agents/basic.prompty");

        // Assert
        Assert.NotNull(agent);
        Assert.NotNull(agent.Model);
        Assert.Equal("chat", agent.Model.Api);
        Assert.NotNull(agent.Model.Connection);
        Assert.Equal("azure_openai", agent.Model.Connection.Type);
        Assert.Equal("gpt-4o", agent.Model.Connection.ExtensionData["azure_deployment"]);
        Assert.NotNull(agent.Model.Options);
        Assert.Equal("150", agent.Model.Options["max_tokens"]);
        Assert.Equal("0.5", agent.Model.Options["temperature"]);
        Assert.Equal("1", agent.Model.Options["top_p"]);
        Assert.Equal("0", agent.Model.Options["frequency_penalty"]);
        Assert.Equal("0", agent.Model.Options["presence_penalty"]);
    }

    [Fact]
    public void ItCanLoadAgentWithTemplate()
    {
        // Arrange & Act
        var agent = Prompty.LoadAgent("agents/basic.prompty");

        // Assert
        Assert.NotNull(agent);
        Assert.NotNull(agent.Model);
        Assert.Equal("chat", agent.Model.Api);
        Assert.NotNull(agent.Model.Connection);
        Assert.Equal("azure_openai", agent.Model.Connection.Type);
        Assert.Equal("gpt-4o", agent.Model.Connection.ExtensionData["azure_deployment"]);
        Assert.NotNull(agent.Model.Options);
        Assert.Equal("150", agent.Model.Options["max_tokens"]);
        Assert.Equal("0.5", agent.Model.Options["temperature"]);
        Assert.Equal("1", agent.Model.Options["top_p"]);
        Assert.Equal("0", agent.Model.Options["frequency_penalty"]);
        Assert.Equal("0", agent.Model.Options["presence_penalty"]);
    }
    */
}
