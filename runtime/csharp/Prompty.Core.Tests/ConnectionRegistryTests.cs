// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Core.Tests;

/// <summary>
/// Tests for ConnectionRegistry: named client registration and lookup.
/// </summary>
public class ConnectionRegistryTests : IDisposable
{
    public ConnectionRegistryTests()
    {
        // Each test starts clean
        ConnectionRegistry.Clear();
    }

    public void Dispose()
    {
        ConnectionRegistry.Clear();
    }

    [Fact]
    public void Register_And_Get_RoundTrip()
    {
        var client = new object();
        ConnectionRegistry.Register("openai", client);
        Assert.Same(client, ConnectionRegistry.Get("openai"));
    }

    [Fact]
    public void Get_ReturnsNull_WhenNotRegistered()
    {
        Assert.Null(ConnectionRegistry.Get("nonexistent"));
    }

    [Fact]
    public void Register_OverwritesExisting()
    {
        var first = new object();
        var second = new object();
        ConnectionRegistry.Register("key", first);
        ConnectionRegistry.Register("key", second);
        Assert.Same(second, ConnectionRegistry.Get("key"));
    }

    [Fact]
    public void Contains_ReturnsTrueForRegistered()
    {
        ConnectionRegistry.Register("test", new object());
        Assert.True(ConnectionRegistry.Contains("test"));
    }

    [Fact]
    public void Contains_ReturnsFalseForMissing()
    {
        Assert.False(ConnectionRegistry.Contains("missing"));
    }

    [Fact]
    public void Remove_ReturnsTrueAndRemovesEntry()
    {
        ConnectionRegistry.Register("temp", new object());
        Assert.True(ConnectionRegistry.Remove("temp"));
        Assert.Null(ConnectionRegistry.Get("temp"));
        Assert.False(ConnectionRegistry.Contains("temp"));
    }

    [Fact]
    public void Remove_ReturnsFalseForMissing()
    {
        Assert.False(ConnectionRegistry.Remove("nonexistent"));
    }

    [Fact]
    public void Clear_RemovesAllEntries()
    {
        ConnectionRegistry.Register("a", new object());
        ConnectionRegistry.Register("b", new object());
        ConnectionRegistry.Clear();
        Assert.Null(ConnectionRegistry.Get("a"));
        Assert.Null(ConnectionRegistry.Get("b"));
    }

    [Fact]
    public void Register_ThrowsOnNullName()
    {
        Assert.Throws<ArgumentNullException>(() => ConnectionRegistry.Register(null!, new object()));
    }

    [Fact]
    public void Register_ThrowsOnNullClient()
    {
        Assert.Throws<ArgumentNullException>(() => ConnectionRegistry.Register("key", null!));
    }

    [Fact]
    public void MultipleDifferentKeys_AreIndependent()
    {
        var c1 = new object();
        var c2 = new object();
        ConnectionRegistry.Register("openai", c1);
        ConnectionRegistry.Register("azure", c2);

        Assert.Same(c1, ConnectionRegistry.Get("openai"));
        Assert.Same(c2, ConnectionRegistry.Get("azure"));
        Assert.NotSame(ConnectionRegistry.Get("openai"), ConnectionRegistry.Get("azure"));
    }
}
