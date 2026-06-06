using Prompty.Core;

namespace Prompty.Core.Tests;

public class LoaderTests
{
    private static string PromptPath(string name) =>
        Path.Combine(AppContext.BaseDirectory, "Prompts", name);

    // --- Basic loading ---

    [Fact]
    public void Load_Basic_ReturnsPrompty()
    {
        Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", "https://test.openai.azure.com");
        Environment.SetEnvironmentVariable("AZURE_OPENAI_API_KEY", "test-key-123");
        try
        {
            var agent = PromptyLoader.Load(PromptPath("basic.prompty"));

            Assert.NotNull(agent);
            Assert.Equal("basic-prompt", agent.Name);
            Assert.Equal("A basic prompt for testing", agent.Description);
        }
        finally
        {
            Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", null);
            Environment.SetEnvironmentVariable("AZURE_OPENAI_API_KEY", null);
        }
    }

    [Fact]
    public void Load_Basic_HasInstructions()
    {
        Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", "https://test.openai.azure.com");
        Environment.SetEnvironmentVariable("AZURE_OPENAI_API_KEY", "test-key-123");
        try
        {
            var agent = PromptyLoader.Load(PromptPath("basic.prompty"));

            Assert.NotNull(agent.Instructions);
            Assert.Contains("system:", agent.Instructions);
            Assert.Contains("You are an AI assistant", agent.Instructions);
            Assert.Contains("{{firstName}}", agent.Instructions);
        }
        finally
        {
            Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", null);
            Environment.SetEnvironmentVariable("AZURE_OPENAI_API_KEY", null);
        }
    }

    [Fact]
    public void Load_Basic_HasModel()
    {
        Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", "https://test.openai.azure.com");
        Environment.SetEnvironmentVariable("AZURE_OPENAI_API_KEY", "test-key-123");
        try
        {
            var agent = PromptyLoader.Load(PromptPath("basic.prompty"));

            Assert.NotNull(agent.Model);
            Assert.Equal("gpt-4", agent.Model.Id);
            Assert.Equal("azure", agent.Model.Provider);
            Assert.Equal("chat", agent.Model.ApiType);
        }
        finally
        {
            Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", null);
            Environment.SetEnvironmentVariable("AZURE_OPENAI_API_KEY", null);
        }
    }

    [Fact]
    public void Load_Basic_HasConnection()
    {
        Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", "https://test.openai.azure.com");
        Environment.SetEnvironmentVariable("AZURE_OPENAI_API_KEY", "test-key-123");
        try
        {
            var agent = PromptyLoader.Load(PromptPath("basic.prompty"));
            var conn = agent.Model?.Connection;

            Assert.NotNull(conn);
            Assert.IsType<ApiKeyConnection>(conn);
            var apiKey = (ApiKeyConnection)conn;
            Assert.Equal("https://test.openai.azure.com", apiKey.Endpoint);
            Assert.Equal("test-key-123", apiKey.ApiKey);
        }
        finally
        {
            Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", null);
            Environment.SetEnvironmentVariable("AZURE_OPENAI_API_KEY", null);
        }
    }

    [Fact]
    public void Load_Basic_HasOptions()
    {
        Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", "https://test.openai.azure.com");
        Environment.SetEnvironmentVariable("AZURE_OPENAI_API_KEY", "test-key-123");
        try
        {
            var agent = PromptyLoader.Load(PromptPath("basic.prompty"));
            var opts = agent.Model?.Options;

            Assert.NotNull(opts);
            Assert.Equal(0.7f, opts.Temperature);
            Assert.Equal(1000, opts.MaxOutputTokens);
        }
        finally
        {
            Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", null);
            Environment.SetEnvironmentVariable("AZURE_OPENAI_API_KEY", null);
        }
    }

    [Fact]
    public void Load_Basic_HasInputs()
    {
        Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", "https://test.openai.azure.com");
        Environment.SetEnvironmentVariable("AZURE_OPENAI_API_KEY", "test-key-123");
        try
        {
            var agent = PromptyLoader.Load(PromptPath("basic.prompty"));

            Assert.NotNull(agent.Inputs);
            Assert.Equal(3, agent.Inputs.Count);
            Assert.Equal("firstName", agent.Inputs[0].Name);
            Assert.Equal("string", agent.Inputs[0].Kind);
        }
        finally
        {
            Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", null);
            Environment.SetEnvironmentVariable("AZURE_OPENAI_API_KEY", null);
        }
    }

    [Fact]
    public void Load_Basic_HasTemplate()
    {
        Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", "https://test.openai.azure.com");
        Environment.SetEnvironmentVariable("AZURE_OPENAI_API_KEY", "test-key-123");
        try
        {
            var agent = PromptyLoader.Load(PromptPath("basic.prompty"));

            Assert.NotNull(agent.Template);
            Assert.NotNull(agent.Template.Format);
            Assert.Equal("jinja2", agent.Template.Format.Kind);
            Assert.NotNull(agent.Template.Parser);
            Assert.Equal("prompty", agent.Template.Parser.Kind);
        }
        finally
        {
            Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", null);
            Environment.SetEnvironmentVariable("AZURE_OPENAI_API_KEY", null);
        }
    }

    [Fact]
    public void Load_Basic_HasMetadata()
    {
        Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", "https://test.openai.azure.com");
        Environment.SetEnvironmentVariable("AZURE_OPENAI_API_KEY", "test-key-123");
        try
        {
            var agent = PromptyLoader.Load(PromptPath("basic.prompty"));

            Assert.NotNull(agent.Metadata);
            Assert.True(agent.Metadata.ContainsKey("authors"));
        }
        finally
        {
            Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", null);
            Environment.SetEnvironmentVariable("AZURE_OPENAI_API_KEY", null);
        }
    }

    // --- Minimal ---

    [Fact]
    public void Load_Minimal_Works()
    {
        var agent = PromptyLoader.Load(PromptPath("minimal.prompty"));

        Assert.Equal("minimal", agent.Name);
        Assert.NotNull(agent.Model);
        Assert.Equal("gpt-4", agent.Model.Id);
        Assert.Contains("Hello world.", agent.Instructions);
    }

    // --- Env resolution ---

    [Fact]
    public void Load_EnvResolution_ResolvesVars()
    {
        Environment.SetEnvironmentVariable("TEST_ENDPOINT", "https://resolved.openai.azure.com");
        Environment.SetEnvironmentVariable("TEST_API_KEY", "resolved-key");
        try
        {
            var agent = PromptyLoader.Load(PromptPath("env_test.prompty"));
            var conn = (ApiKeyConnection)agent.Model!.Connection!;

            Assert.Equal("https://resolved.openai.azure.com", conn.Endpoint);
            Assert.Equal("resolved-key", conn.ApiKey);
        }
        finally
        {
            Environment.SetEnvironmentVariable("TEST_ENDPOINT", null);
            Environment.SetEnvironmentVariable("TEST_API_KEY", null);
        }
    }

    [Fact]
    public void Load_EnvDefault_UsesDefault()
    {
        // NONEXISTENT_VAR should not be set
        Environment.SetEnvironmentVariable("NONEXISTENT_VAR", null);

        var agent = PromptyLoader.Load(PromptPath("env_default.prompty"));
        var conn = (ApiKeyConnection)agent.Model!.Connection!;

        Assert.Equal("https://fallback.openai.azure.com", conn.Endpoint);
    }

    [Fact]
    public void Load_EnvMissing_Throws()
    {
        Environment.SetEnvironmentVariable("TEST_ENDPOINT", null);
        Environment.SetEnvironmentVariable("TEST_API_KEY", null);

        var ex = Assert.Throws<InvalidOperationException>(
            () => PromptyLoader.Load(PromptPath("env_test.prompty")));
        Assert.Contains("TEST_ENDPOINT", ex.Message);
    }

    // --- File resolution ---

    [Fact]
    public void Load_FileRef_ResolvesJsonFile()
    {
        var agent = PromptyLoader.Load(PromptPath("file_ref.prompty"));
        var conn = agent.Model?.Connection;

        Assert.NotNull(conn);
        Assert.IsType<ApiKeyConnection>(conn);
        var apiKey = (ApiKeyConnection)conn;
        Assert.Equal("https://shared.openai.azure.com", apiKey.Endpoint);
        Assert.Equal("shared-key-12345", apiKey.ApiKey);
    }

    [Fact]
    public void Load_FileRef_TraversalOutsidePromptDir_Throws()
    {
        var root = Directory.CreateTempSubdirectory("prompty-loader-");
        try
        {
            var promptDir = Directory.CreateDirectory(Path.Combine(root.FullName, "prompts"));
            File.WriteAllText(Path.Combine(root.FullName, "secret.txt"), "secret");
            var prompt = Path.Combine(promptDir.FullName, "bad.prompty");
            File.WriteAllText(prompt, "---\nname: bad\ndescription: \"${file:../secret.txt}\"\n---\nHello\n");

            var ex = Assert.Throws<InvalidOperationException>(() => PromptyLoader.Load(prompt));
            Assert.Contains("outside allowed roots", ex.Message);
        }
        finally
        {
            root.Delete(recursive: true);
        }
    }

    [Fact]
    public void Load_FileRef_AbsolutePathOutsidePromptDir_Throws()
    {
        var root = Directory.CreateTempSubdirectory("prompty-loader-");
        try
        {
            var promptDir = Directory.CreateDirectory(Path.Combine(root.FullName, "prompts"));
            var secret = Path.Combine(root.FullName, "secret.txt");
            File.WriteAllText(secret, "secret");
            var prompt = Path.Combine(promptDir.FullName, "bad.prompty");
            File.WriteAllText(
                prompt,
                $"---\nname: bad\ndescription: \"${{file:{secret.Replace("\\", "/")}}}\"\n---\nHello\n");

            var ex = Assert.Throws<InvalidOperationException>(() => PromptyLoader.Load(prompt));
            Assert.Contains("outside allowed roots", ex.Message);
        }
        finally
        {
            root.Delete(recursive: true);
        }
    }

    [Fact]
    public void Load_FileRef_AllowedRootPermitsSharedFile()
    {
        var root = Directory.CreateTempSubdirectory("prompty-loader-");
        try
        {
            var promptDir = Directory.CreateDirectory(Path.Combine(root.FullName, "prompts"));
            var sharedDir = Directory.CreateDirectory(Path.Combine(root.FullName, "shared"));
            File.WriteAllText(Path.Combine(sharedDir.FullName, "description.txt"), "shared description");
            var prompt = Path.Combine(promptDir.FullName, "shared.prompty");
            File.WriteAllText(prompt, "---\nname: shared\ndescription: \"${file:../shared/description.txt}\"\n---\nHello\n");

            var agent = PromptyLoader.Load(
                prompt,
                new PromptyLoadOptions { AllowedFileRoots = [sharedDir.FullName] });

            Assert.Equal("shared description", agent.Description);
        }
        finally
        {
            root.Delete(recursive: true);
        }
    }

    [Fact]
    public void Load_FileRef_SymlinkEscape_Throws()
    {
        var root = Directory.CreateTempSubdirectory("prompty-loader-");
        try
        {
            var promptDir = Directory.CreateDirectory(Path.Combine(root.FullName, "prompts"));
            var secret = Path.Combine(root.FullName, "secret.txt");
            File.WriteAllText(secret, "secret");
            var link = Path.Combine(promptDir.FullName, "secret-link.txt");
            try
            {
                File.CreateSymbolicLink(link, secret);
            }
            catch
            {
                return;
            }

            var prompt = Path.Combine(promptDir.FullName, "bad.prompty");
            File.WriteAllText(prompt, "---\nname: bad\ndescription: \"${file:secret-link.txt}\"\n---\nHello\n");

            var ex = Assert.Throws<InvalidOperationException>(() => PromptyLoader.Load(prompt));
            Assert.Contains("outside allowed roots", ex.Message);
        }
        finally
        {
            root.Delete(recursive: true);
        }
    }

    // --- Tools ---

    [Fact]
    public void Load_Tools_HasFunctionTool()
    {
        var agent = PromptyLoader.Load(PromptPath("tools.prompty"));

        Assert.NotNull(agent.Tools);
        Assert.Single(agent.Tools);
        Assert.IsType<FunctionTool>(agent.Tools[0]);
        var tool = (FunctionTool)agent.Tools[0];
        Assert.Equal("get_weather", tool.Name);
        Assert.Equal("Get the current weather", tool.Description);
    }

    // --- Source path in metadata ---

    [Fact]
    public void Load_SetsSourcePath()
    {
        var agent = PromptyLoader.Load(PromptPath("minimal.prompty"));

        Assert.NotNull(agent.Metadata);
        Assert.True(agent.Metadata.ContainsKey("__source_path"));
        var sourcePath = agent.Metadata["__source_path"]!.ToString()!;
        Assert.EndsWith("minimal.prompty", sourcePath);
    }

    // --- Error cases ---

    [Fact]
    public void Load_MissingFile_Throws()
    {
        Assert.Throws<FileNotFoundException>(
            () => PromptyLoader.Load("nonexistent.prompty"));
    }

    // --- Async ---

    [Fact]
    public async Task LoadAsync_Works()
    {
        var agent = await PromptyLoader.LoadAsync(PromptPath("minimal.prompty"));

        Assert.Equal("minimal", agent.Name);
        Assert.NotNull(agent.Model);
    }

    [Fact]
    public async Task LoadAsync_MissingFile_Throws()
    {
        await Assert.ThrowsAsync<FileNotFoundException>(
            () => PromptyLoader.LoadAsync("nonexistent.prompty"));
    }
}
