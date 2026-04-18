// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;
using Xunit;

namespace DocsExamples.Tests;

/// <summary>
/// Parametric tests that load every .prompty file from the shared prompts directory
/// and validate they load without error.
/// </summary>
[Collection("DocsExamples")]
public class PromptyLoadsTests
{
    /// <summary>
    /// Path to the shared prompts directory relative to this project's output.
    /// The csproj lives at web/docs-examples/csharp/ and prompts at web/docs-examples/prompts/.
    /// </summary>
    private static string PromptsDirectory
    {
        get
        {
            // Walk up from bin\Debug\net9.0\ back to the csproj directory (3 levels),
            // then resolve the relative path to the prompts folder.
            var baseDir = AppContext.BaseDirectory;
            var csprojDir = Path.GetFullPath(Path.Combine(baseDir, "..", "..", ".."));
            return Path.Combine(csprojDir, "..", "prompts");
        }
    }

    public static IEnumerable<object[]> PromptyFiles()
    {
        var dir = Path.GetFullPath(PromptsDirectory);
        if (!Directory.Exists(dir))
            yield break;

        foreach (var file in Directory.GetFiles(dir, "*.prompty"))
        {
            yield return [file];
        }
    }

    [Theory]
    [MemberData(nameof(PromptyFiles))]
    public void Load_AllPromptyFiles_Succeeds(string filePath)
    {
        // Set a dummy API key so ${env:OPENAI_API_KEY} resolves
        Environment.SetEnvironmentVariable("OPENAI_API_KEY", "test-key-for-loading");

        try
        {
            var agent = PromptyLoader.Load(filePath);

            // Basic structural assertions
            Assert.NotNull(agent);
            Assert.False(string.IsNullOrEmpty(agent.Name), $"Agent name should be set in {Path.GetFileName(filePath)}");
            Assert.NotNull(agent.Model);
            Assert.False(string.IsNullOrEmpty(agent.Model.Id), $"Model ID should be set in {Path.GetFileName(filePath)}");
        }
        finally
        {
            Environment.SetEnvironmentVariable("OPENAI_API_KEY", null);
        }
    }

    [Theory]
    [MemberData(nameof(PromptyFiles))]
    public void Load_AllPromptyFiles_HasInstructions(string filePath)
    {
        Environment.SetEnvironmentVariable("OPENAI_API_KEY", "test-key-for-loading");

        try
        {
            var agent = PromptyLoader.Load(filePath);

            // Every .prompty file should have a body that becomes instructions
            Assert.NotNull(agent.Instructions);
            Assert.NotEmpty(agent.Instructions);
        }
        finally
        {
            Environment.SetEnvironmentVariable("OPENAI_API_KEY", null);
        }
    }

    [Theory]
    [MemberData(nameof(PromptyFiles))]
    public async Task LoadAsync_AllPromptyFiles_Succeeds(string filePath)
    {
        Environment.SetEnvironmentVariable("OPENAI_API_KEY", "test-key-for-loading");

        try
        {
            var agent = await PromptyLoader.LoadAsync(filePath);

            Assert.NotNull(agent);
            Assert.False(string.IsNullOrEmpty(agent.Name));
            Assert.NotNull(agent.Model);
        }
        finally
        {
            Environment.SetEnvironmentVariable("OPENAI_API_KEY", null);
        }
    }

    [Fact]
    public void PromptsDirectory_ContainsPromptyFiles()
    {
        var dir = Path.GetFullPath(PromptsDirectory);
        Assert.True(Directory.Exists(dir), $"Prompts directory should exist at: {dir}");

        var files = Directory.GetFiles(dir, "*.prompty");
        Assert.True(files.Length > 0, "Prompts directory should contain at least one .prompty file");
    }
}
