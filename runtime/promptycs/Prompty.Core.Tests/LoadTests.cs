using System.Transactions;

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

        Assert.NotNull(prompty);
        Assert.NotNull(prompty.Content);
    }

    [Theory]
    [InlineData("prompty/basic.prompty")]
    [InlineData("prompty/basic_props.prompty")]
    [InlineData("prompty/context.prompty")]
    [InlineData("prompty/functions.prompty")]
    public void LoadRawWithConfig(string path)
    {
        var prompty = Prompty.Load(path, "fake");

        Assert.Equal("FAKE_TYPE", prompty.Model?.Configuration.Type);
    }

    [Fact]
    public void BasicSampleParameters()
    {
        var p = "prompty/basic.prompty";
        var prompty = Prompty.Load(p);
        string[] props = ["firstName", "lastName", "question"];
        string[] samples = ["Jane", "Doe", "What is the meaning of life?"];
        for (int i = 0; i < props.Length; i++)
        {
            string? item = props[i];
            Assert.NotNull(prompty.Inputs[item]);
            Assert.Equal(PropertyType.String, prompty.Inputs[item].Type);
            Assert.Equal(samples[i], prompty.Inputs[item].Sample);   
        }
    }

    [Fact]
    public void BasicParameters()
    {
        var p = "prompty/basic_props.prompty";
        var prompty = Prompty.Load(p);
        string[] props = ["firstName", "lastName", "question", "age", "pct", "valid", "items"];
        PropertyType[] types = [PropertyType.String, 
                                PropertyType.String, 
                                PropertyType.String, 
                                PropertyType.Number, 
                                PropertyType.Number,
                                PropertyType.Boolean,
                                PropertyType.Array];

        string[] vals = { "one", "two", "three" };
        object[] samples = ["Jane", "Doe", "What is the meaning of life?", 45, 1.9, true, vals];
        object?[] defaults = ["User", null, null, 18, 1.7, false, null];
        for (int i = 0; i < props.Length; i++)
        {
            string? item = props[i];
            Assert.NotNull(prompty.Inputs[item]);
            Assert.Equal(types[i], prompty.Inputs[item].Type);
            if (prompty.Inputs[item].Type == PropertyType.Number)
            {
                double sTruth = Math.Round(Convert.ToDouble(samples[i]), 5);
                double dTruth = Math.Round(Convert.ToDouble(defaults[i]), 5);

                double sValue = Math.Round(Convert.ToDouble(prompty.Inputs[item].Sample), 5);
                double dValue = Math.Round(Convert.ToDouble(prompty.Inputs[item].Default), 5);

                Assert.Equal(sTruth, sValue);
                Assert.Equal(dTruth, dValue);
            }
            else
            {
                Assert.Equal(samples[i], prompty.Inputs[item].Sample);
                Assert.Equal(defaults[i], prompty.Inputs[item].Default);
            }            
            Assert.Equal($"The {item} description", prompty.Inputs[item].Description);
        }
    }
}