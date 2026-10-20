// Copyright (c) Microsoft. All rights reserved.
using Prompty.Core;

namespace Prompty.Core.Tests;

/// <summary>Tests for endpoint trust (spec §2.5.1).</summary>
public sealed class EndpointTrustTests : IDisposable
{
    private readonly string _tmp;
    private readonly Dictionary<string, string?> _savedEnv = [];

    public EndpointTrustTests()
    {
        _tmp = Path.Combine(Path.GetTempPath(), $"prompty-trust-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_tmp);
        SetEnv(EndpointTrust.TrustedEndpointsEnv, null);
    }

    public void Dispose()
    {
        foreach (var (key, value) in _savedEnv)
            Environment.SetEnvironmentVariable(key, value);
        try
        {
            Directory.Delete(_tmp, recursive: true);
        }
        catch (IOException)
        {
        }
    }

    private void SetEnv(string key, string? value)
    {
        _savedEnv.TryAdd(key, Environment.GetEnvironmentVariable(key));
        Environment.SetEnvironmentVariable(key, value);
    }

    private string Write(string connection)
    {
        var p = Path.Combine(_tmp, "t.prompty");
        File.WriteAllText(p, $"---\nname: t\nmodel:\n  id: gpt-4\n  connection:\n{connection}\n---\nHello\n");
        return p;
    }

    // --- IsTrustedEndpoint ---

    [Theory]
    [InlineData("https://api.openai.com/v1")]
    [InlineData("https://API.OpenAI.com:443")]
    [InlineData("https://myres.openai.azure.com/")]
    [InlineData("https://a.b.services.ai.azure.com/api/projects/p")]
    [InlineData("https://login.microsoftonline.com/tenant/oauth2/v2.0/token")]
    public void BuiltinTrusted(string url) => Assert.True(EndpointTrust.IsTrustedEndpoint(url));

    [Theory]
    [InlineData("http://api.openai.com")] // scheme mismatch
    [InlineData("https://api.openai.com:8443")] // port mismatch
    [InlineData("https://openai.azure.com")] // wildcard never matches apex
    [InlineData("https://api.openai.com.evil.com")]
    [InlineData("https://evilopenai.azure.com")]
    [InlineData("https://api.openai.com@evil.com")] // userinfo ignored; host is evil.com
    [InlineData("http://localhost:11434")]
    [InlineData("not a url")]
    [InlineData("ftp://api.openai.com")]
    [InlineData("")]
    [InlineData("https://api.openai.com:99999")] // invalid port
    [InlineData("https://api.openai.com:abc")]
    [InlineData("https://[::1")]
    public void Untrusted(string url) => Assert.False(EndpointTrust.IsTrustedEndpoint(url));

    [Fact]
    public void HostOptionAndWildcard()
    {
        Assert.True(EndpointTrust.IsTrustedEndpoint("http://localhost:11434/v1", ["http://LOCALHOST:11434"]));
        Assert.True(EndpointTrust.IsTrustedEndpoint("https://x.contoso.com", ["https://*.contoso.com"]));
        Assert.False(EndpointTrust.IsTrustedEndpoint("https://contoso.com", ["https://*.contoso.com"]));
        Assert.True(EndpointTrust.IsTrustedEndpoint("http://[::1]:8080/x", ["http://[::1]:8080"]));
    }

    [Fact]
    public void EnvListAndStar()
    {
        SetEnv(EndpointTrust.TrustedEndpointsEnv, " https://a.example.com , http://localhost:8080");
        Assert.True(EndpointTrust.IsTrustedEndpoint("http://localhost:8080/x"));
        Assert.False(EndpointTrust.IsTrustedEndpoint("http://localhost:8081"));
        SetEnv(EndpointTrust.TrustedEndpointsEnv, "*");
        Assert.True(EndpointTrust.IsTrustedEndpoint("http://anything.example"));
    }

    // --- Loader enforcement ---

    [Fact]
    public void AmbientLiteralEndpointRejected()
    {
        var p = Write("    kind: foundry\n    endpoint: http://127.0.0.1:9999");
        var ex = Assert.Throws<PromptyLoadException>(() => PromptyLoader.Load(p));
        Assert.Equal("untrusted_endpoint", ex.Kind);
        Assert.Contains("127.0.0.1", ex.Message);
    }

    [Fact]
    public void EnvKeyLiteralEndpointRejected()
    {
        SetEnv("SOME_KEY", "secret");
        var p = Write("    kind: key\n    endpoint: https://evil.example.com\n    apiKey: ${env:SOME_KEY}");
        var ex = Assert.Throws<PromptyLoadException>(() => PromptyLoader.Load(p));
        Assert.Contains("not trusted", ex.Message);
    }

    [Fact]
    public void OAuthTokenUrlChecked()
    {
        SetEnv("SECRET", "s");
        var p = Write(
            "    kind: oauth\n    endpoint: https://myres.openai.azure.com\n    clientId: c\n"
            + "    clientSecret: ${env:SECRET}\n    tokenUrl: https://evil.example.com/token");
        var ex = Assert.Throws<PromptyLoadException>(() => PromptyLoader.Load(p));
        Assert.Contains("tokenUrl", ex.Message);
    }

    [Fact]
    public void MismatchedCredentialFieldRejected()
    {
        var p = Write("    kind: foundry\n    endpoint: https://evil.example.com\n    apiKey: junk");
        Assert.Contains("not trusted", Assert.Throws<PromptyLoadException>(() => PromptyLoader.Load(p)).Message);
        p = Write("    kind: key\n    endpoint: https://evil.example.com\n    clientSecret: junk");
        Assert.Contains("not trusted", Assert.Throws<PromptyLoadException>(() => PromptyLoader.Load(p)).Message);
    }

    [Fact]
    public void LiteralKeyAllowed()
    {
        var agent = PromptyLoader.Load(Write("    kind: key\n    endpoint: http://127.0.0.1:9999\n    apiKey: mine"));
        Assert.Equal("http://127.0.0.1:9999", Assert.IsType<ApiKeyConnection>(agent.Model!.Connection).Endpoint);
    }

    [Fact]
    public void EnvEndpointAllowed()
    {
        SetEnv("EP", "http://127.0.0.1:9999");
        var agent = PromptyLoader.Load(Write("    kind: foundry\n    endpoint: ${env:EP}"));
        Assert.Equal("http://127.0.0.1:9999", Assert.IsType<FoundryConnection>(agent.Model!.Connection).Endpoint);
    }

    [Fact]
    public void EnvDefaultUsedRejected()
    {
        SetEnv("UNSET_EP", null);
        var p = Write("    kind: foundry\n    endpoint: ${env:UNSET_EP:http://127.0.0.1:9999}");
        Assert.Contains("not trusted", Assert.Throws<PromptyLoadException>(() => PromptyLoader.Load(p)).Message);
    }

    [Fact]
    public void TrustedOptionAllows()
    {
        var p = Write("    kind: foundry\n    endpoint: http://127.0.0.1:9999/api");
        var agent = PromptyLoader.Load(p, new PromptyLoadOptions { TrustedEndpoints = ["http://127.0.0.1:9999"] });
        Assert.Equal("http://127.0.0.1:9999/api", Assert.IsType<FoundryConnection>(agent.Model!.Connection).Endpoint);
    }

    [Fact]
    public async Task AsyncHonorsOption()
    {
        var p = Write("    kind: foundry\n    endpoint: http://127.0.0.1:9999");
        await Assert.ThrowsAsync<PromptyLoadException>(() => PromptyLoader.LoadAsync(p));
        var agent = await PromptyLoader.LoadAsync(
            p, new PromptyLoadOptions { TrustedEndpoints = ["http://127.0.0.1:9999"] });
        Assert.Equal("http://127.0.0.1:9999", Assert.IsType<FoundryConnection>(agent.Model!.Connection).Endpoint);
    }

    [Fact]
    public void FileModelReferenceChecked()
    {
        File.WriteAllText(
            Path.Combine(_tmp, "model.json"),
            """{"id": "gpt-4", "connection": {"kind": "foundry", "endpoint": "https://evil.example.com"}}""");
        var p = Path.Combine(_tmp, "t.prompty");
        File.WriteAllText(p, "---\nname: t\nmodel: ${file:model.json}\n---\nHi\n");
        Assert.Contains("not trusted", Assert.Throws<PromptyLoadException>(() => PromptyLoader.Load(p)).Message);
    }

    [Fact]
    public void FileConnectionReferenceChecked()
    {
        File.WriteAllText(Path.Combine(_tmp, "conn.yaml"), "kind: foundry\nendpoint: https://evil.example.com\n");
        var p = Path.Combine(_tmp, "t.prompty");
        File.WriteAllText(p, "---\nname: t\nmodel:\n  id: gpt-4\n  connection: ${file:conn.yaml}\n---\nHi\n");
        var ex = Assert.Throws<PromptyLoadException>(() => PromptyLoader.Load(p));
        Assert.Equal("untrusted_endpoint", ex.Kind);
    }

    [Fact]
    public void FrontmatterCannotSelfTrust()
    {
        var p = Path.Combine(_tmp, "t.prompty");
        File.WriteAllText(
            p,
            "---\nname: t\nmetadata:\n  trustedEndpoints: ['*']\n  PROMPTY_TRUSTED_ENDPOINTS: '*'\n"
            + "model:\n  id: gpt-4\n  connection:\n    kind: foundry\n    endpoint: https://evil.example.com\n---\nHi\n");
        Assert.Throws<PromptyLoadException>(() => PromptyLoader.Load(p));
    }
}
