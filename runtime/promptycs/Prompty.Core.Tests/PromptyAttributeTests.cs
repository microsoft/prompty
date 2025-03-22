using Microsoft.Extensions.AI;

namespace Prompty.Core.Tests;

/// <summary>
/// Test class with a single Prompty attribute
/// </summary>
[Prompty("prompty/basic.prompty")]
public class ClassWithAttribute { }

/// <summary>
/// Test class with a Prompty attribute that loads from an embedded resource
/// </summary>
[Prompty("prompty/basic.prompty", IsResource = true)]
public class ClassWithResourceAttribute { }

/// <summary>
/// Test class with a Prompty attribute that loads from an embedded resource
/// and has configuration and parameters
/// </summary>
[Prompty("prompty/basic.prompty", IsResource = true, Configuration = "FAKE_TYPE", Params = new string[] { "firstName", "Caspar", "lastName", "Haglund", "question", "What is your name?" })]
public class ClassWithResourceAttributeAndCofigAndParams { }

/// <summary>
/// Test class with multiple Prompty attributes
/// </summary>
[Prompty("prompty/basic.prompty")]
[Prompty("prompty/context.prompty")]
public class ClassWithMultipleAttributes { }

/// <summary>
/// Test class with multiple Prompty attributes with mixed configurations
/// </summary>
[Prompty("prompty/basic.prompty", IsResource = true)]
[Prompty("prompty/context.prompty", Configuration = "FAKE_TYPE")]
public class ClassWithMultipleMixedAttributes { }

/// <summary>
/// Prompty Attribute Tests
/// </summary>
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
        Assert.NotNull(attr.Messages);
        Assert.NotNull(attr);
        Assert.Equal("prompty/basic.prompty", attr.File);
        Assert.False(attr.IsResource);
        Assert.NotNull(attr.Prompt);
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
        Assert.NotNull(attr.Messages);
        Assert.NotNull(attr);
        Assert.Equal("prompty/basic.prompty", attr.File);
        Assert.True(attr.IsResource);
        Assert.NotNull(attr.Prompt);
    }

    /// <summary>
    /// Test that inalid file paths result in exception
    /// </summary>
    [Fact]
    public void ThrowsOnInvalidFile()
    {

        Assert.Throws<FileNotFoundException>(() => 
            {
                var fail = new PromptyAttribute("nonexistent.prompty", false);
                var _ = fail.Prompt;
            });
    }

    /// <summary>
    /// Test that invalid resource paths result in exception
    /// </summary>
    [Fact]
    public void ThrowsOnInvalidResource()
    {
        Assert.Throws<FileNotFoundException>(() => 
        {
            var fail = new PromptyAttribute("nonexistent.prompty", true);
            var _ = fail.Prompt;
        });
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

    /// <summary>
    /// Test retrieving multiple Prompty attributes from a class
    /// </summary>
    [Fact]
    public void LoadMultipleAttributes()
    {
        var attrs = Attribute.GetCustomAttributes(
            typeof(ClassWithMultipleAttributes), 
            typeof(PromptyAttribute));

        Assert.NotNull(attrs);
        Assert.Equal(2, attrs.Length);
        
        var basicAttr = attrs[0] as PromptyAttribute;
        var contextAttr = attrs[1] as PromptyAttribute;
        
        Assert.NotNull(basicAttr);
        Assert.NotNull(contextAttr);
        Assert.Equal("prompty/basic.prompty", basicAttr!.File);
        Assert.Equal("prompty/context.prompty", contextAttr!.File);
        
        Assert.NotNull(basicAttr.Prompt);
        Assert.NotNull(contextAttr.Prompt);
        
        Assert.NotNull(basicAttr.Messages);
        Assert.NotNull(contextAttr.Messages);
    }

    /// <summary>
    /// Test retrieving multiple Prompty attributes with different configurations
    /// </summary>
    [Fact]
    public void LoadMultipleMixedAttributes()
    {
        var attrs = Attribute.GetCustomAttributes(
            typeof(ClassWithMultipleMixedAttributes), 
            typeof(PromptyAttribute));

        Assert.NotNull(attrs);
        Assert.Equal(2, attrs.Length);
        
        var basicAttr = attrs[0] as PromptyAttribute;
        var contextAttr = attrs[1] as PromptyAttribute;
        
        Assert.NotNull(basicAttr);
        Assert.NotNull(contextAttr);
        
        // First attribute with IsResource = true
        Assert.Equal("prompty/basic.prompty", basicAttr!.File);
        Assert.True(basicAttr.IsResource);
        Assert.NotNull(basicAttr.Prompt);
        Assert.NotNull(basicAttr.Messages);
        
        // Second attribute with specific configuration
        Assert.Equal("prompty/context.prompty", contextAttr!.File);
        Assert.Equal("FAKE_TYPE", contextAttr.Configuration);
        Assert.NotNull(contextAttr.Prompt);
        Assert.NotNull(contextAttr.Messages);
    }
}
