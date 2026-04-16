// Copyright (c) Microsoft. All rights reserved.

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130

/// <summary>
/// Parses rendered prompt text into an array of structured messages with role markers.
/// </summary>
public interface IParser
{
    /// <summary>
    /// Parse rendered text into a structured message array
    /// </summary>
    Task<List<Message>> ParseAsync(Prompty agent, string rendered);
}
