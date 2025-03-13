namespace Prompty.Core.Tests;


[Prompty("prompty/basic.prompty")]
public class ClassWithAttribute { }

[Prompty("prompty/basic.prompty", IsResource = true)]
public class ClassWithResourceAttribute { }

public class PromptyAttributeTests
{
    public PromptyAttributeTests()
    {
        Environment.SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", "ENDPOINT_VALUE");
    }

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
}
