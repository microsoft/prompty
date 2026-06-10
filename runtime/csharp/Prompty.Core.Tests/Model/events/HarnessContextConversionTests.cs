using Xunit;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class HarnessContextConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
cwd: /workspace/project
gitRoot: /workspace/project

""";

        var instance = HarnessContext.FromYaml(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("/workspace/project", instance.Cwd);
        Assert.Equal("/workspace/project", instance.GitRoot);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
{
  "cwd": "/workspace/project",
  "gitRoot": "/workspace/project"
}
""";

        var instance = HarnessContext.FromJson(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("/workspace/project", instance.Cwd);
        Assert.Equal("/workspace/project", instance.GitRoot);
    }

    [Fact]
    public void RoundtripJson()
    {
        // Test that FromJson -> ToJson -> FromJson produces equivalent data
        string jsonData = """
{
  "cwd": "/workspace/project",
  "gitRoot": "/workspace/project"
}
""";

        var original = HarnessContext.FromJson(jsonData);
        Assert.NotNull(original);

        var json = original.ToJson();
        Assert.False(string.IsNullOrEmpty(json));

        var reloaded = HarnessContext.FromJson(json);
        Assert.NotNull(reloaded);
        Assert.Equal("/workspace/project", reloaded.Cwd);
        Assert.Equal("/workspace/project", reloaded.GitRoot);
    }

    [Fact]
    public void RoundtripYaml()
    {
        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data
        string yamlData = """
cwd: /workspace/project
gitRoot: /workspace/project

""";

        var original = HarnessContext.FromYaml(yamlData);
        Assert.NotNull(original);

        var yaml = original.ToYaml();
        Assert.False(string.IsNullOrEmpty(yaml));

        var reloaded = HarnessContext.FromYaml(yaml);
        Assert.NotNull(reloaded);
        Assert.Equal("/workspace/project", reloaded.Cwd);
        Assert.Equal("/workspace/project", reloaded.GitRoot);
    }

    [Fact]
    public void ToJsonProducesValidJson()
    {
        string jsonData = """
{
  "cwd": "/workspace/project",
  "gitRoot": "/workspace/project"
}
""";

        var instance = HarnessContext.FromJson(jsonData);
        var json = instance.ToJson();

        // Verify it's valid JSON by parsing it
        var parsed = System.Text.Json.JsonDocument.Parse(json);
        Assert.NotNull(parsed);
    }

    [Fact]
    public void ToYamlProducesValidYaml()
    {
        string yamlData = """
cwd: /workspace/project
gitRoot: /workspace/project

""";

        var instance = HarnessContext.FromYaml(yamlData);
        var yaml = instance.ToYaml();

        // Verify it's valid YAML by parsing it
        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var parsed = deserializer.Deserialize<object>(yaml);
        Assert.NotNull(parsed);
    }
}
