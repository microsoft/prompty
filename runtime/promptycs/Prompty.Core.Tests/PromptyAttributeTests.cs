using Microsoft.Extensions.AI;

namespace Prompty.Core.Tests;


[Prompty("prompty/basic.prompty")]
public class ClassWithAttribute { }

[Prompty("prompty/basic.prompty", IsResource = true)]
public class ClassWithResourceAttribute { }

[Prompty("prompty/basic.prompty", IsResource = true, Configuration = "FAKE_TYPE", Params = new string[] { "firstName", "Caspar", "lastName", "Haglund", "question", "What is your name?" })]
public class ClassWithResourceAttributeAndCofigAndParams { }

public class PromptyAttributeTests
{
    public PromptyAttributeTests()
    {
        Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", "ENDPOINT_VALUE");
    }

    /// <summary>
    /// Test Loading from a File path
    /// </summary>
    [Fact]
    public void LoadFromFile()
    {
        var attr = (PromptyAttribute)Attribute.GetCustomAttribute(
            typeof(ClassWithAttribute), 
            typeof(PromptyAttribute))!;

        Assert.NotNull(attr);
        Assert.Equal("prompty/basic.prompty", attr.File);
        Assert.False(attr.IsResource);
        Assert.NotNull(attr.Prompt);
        Assert.NotNull(attr.Messages);
    }

    /// <summary>
    /// Test Loading from an embedded Resource path
    /// </summary>
    [Fact]
    public void LoadFromResource()
    {
        var attr = (PromptyAttribute)Attribute.GetCustomAttribute(
            typeof(ClassWithResourceAttribute), 
            typeof(PromptyAttribute))!;

        Assert.NotNull(attr);
        Assert.Equal("prompty/basic.prompty", attr.File);
        Assert.True(attr.IsResource);
        Assert.NotNull(attr.Prompt);
        Assert.NotNull(attr.Messages);
    }

    [Fact]
    public void ThrowsOnInvalidFile()
    {
        Assert.Throws<FileNotFoundException>(() => 
            new PromptyAttribute("nonexistent.prompty", false));
    }

    [Fact]
    public void ThrowsOnInvalidResource()
    {
        Assert.Throws<FileNotFoundException>(() => 
            new PromptyAttribute("nonexistent.prompty", true));
    }

    /// <summary>
    /// Test Loading from a Resource path with configuration and parameters
    /// </summary>
    [Fact]
    public void LoadFromResourceWithConfigAndParams()
    {

        var attr = (PromptyAttribute)Attribute.GetCustomAttribute(
            typeof(ClassWithResourceAttributeAndCofigAndParams), 
            typeof(PromptyAttribute))!;

        var messages = attr.Messages;

        Assert.NotNull(attr);
        Assert.Equal("prompty/basic.prompty", attr.File);
        Assert.True(attr.IsResource);
        Assert.Equal("FAKE_TYPE", attr.Configuration);
        Assert.NotNull(attr.Params);
        Assert.Equal(6, attr.Params.Length);
        Assert.Equal("firstName", attr.Params[0]);
        Assert.Equal("Caspar", attr.Params[1]);
        Assert.Equal("lastName", attr.Params[2]);
        Assert.Equal("Haglund", attr.Params[3]);
        Assert.Equal("question", attr.Params[4]);
        Assert.Equal("What is your name?", attr.Params[5]);
        Assert.NotNull(attr.Prompt);
        Assert.IsType<ChatMessage[]>(messages);
        Assert.NotNull(messages);
        Assert.Equal(2, messages.Length);
        Assert.Contains("Caspar", messages[0].Text);
        Assert.Contains("Haglund", messages[0].Text);
        Assert.Contains("What is your name?", messages[1].Text);
    }
}
