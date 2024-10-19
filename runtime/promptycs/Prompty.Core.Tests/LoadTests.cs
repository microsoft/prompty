namespace Prompty.Core.Tests;


public class LoadTests
{
    public LoadTests()
    {
        // TODO: Change to settings loaders
        Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", "ENDPOINT_VALUE");
    }

    [Theory]
    [InlineData("prompty/basic.prompty")]
    [InlineData("prompty/basic_props.prompty")]
    [InlineData("prompty/context.prompty")]
    [InlineData("prompty/functions.prompty")]
    public void LoadRaw(string path)
    {
        var prompty = Prompty.Load(path);

    }
}