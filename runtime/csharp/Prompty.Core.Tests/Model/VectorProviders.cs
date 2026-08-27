#nullable enable

using System.Threading.Tasks;
using Prompty.OpenAI;

namespace Prompty.Core;

// Consumer-authored typed-rail providers for the @vector per-interface
// conformance tests (RendererConformanceTests / ParserConformanceTests /
// ProcessorConformanceTests). The emitter generates those tests to route each
// vector's shape discriminator through the emitted <Seam>Resolver against the
// provider VALUE authored here — a dropped @dispatch slot fails to compile, so
// conformance never silently skips a variant. This is the C# twin of the
// Python conftest fixtures.

/// <summary>Attaches Prompty's template renderers to the jinja2/mustache variants.</summary>
internal sealed class SeamRendererProvider : IRendererProvider
{
    public IRenderer? Jinja2 { get; } = new Jinja2Renderer();
    public IRenderer? Mustache { get; } = new MustacheRenderer();
    public IRenderer? Custom => null;
}

/// <summary>Attaches Prompty's chat parser to the prompty variant.</summary>
internal sealed class SeamParserProvider : IParserProvider
{
    public IParser? Prompty { get; } = new PromptyChatParser();
    public IParser? Custom => null;
}

/// <summary>
/// NOOP processor for the open-union '*' (CustomModel) default variant. An
/// unknown Model.provider (e.g. "anthropic") routes through ProcessorResolver
/// to the Custom slot; this passthrough returns the raw provider response
/// unchanged — the honest behavior for a provider Prompty has no typed
/// extraction for — so the seam stays total (never a silent null) without
/// pretending to understand foreign wire shapes.
/// </summary>
internal sealed class PassthroughProcessor : IProcessor
{
    public Task<object> ProcessAsync(Agent agent, object response) => Task.FromResult(response);

    public Task<object> ProcessStreamAsync(Agent agent, object stream) => Task.FromResult(stream);
}

/// <summary>
/// Attaches Prompty's response processors to the Processor @dispatch variants.
/// openai/azure get the concrete OpenAI-shaped processor (Azure OpenAI shares
/// the OpenAI response wire); the open-union '*' catch-all (Custom slot) gets a
/// passthrough NOOP so an unknown provider resolves to a total seam.
/// </summary>
internal sealed class SeamProcessorProvider : IProcessorProvider
{
    public IProcessor? Openai { get; } = new OpenAIProcessor();
    public IProcessor? Azure { get; } = new OpenAIProcessor();
    public IProcessor? Custom { get; } = new PassthroughProcessor();
}

/// <summary>
/// Provider VALUE factory referenced by the generated per-interface conformance
/// tests as VectorProviders.Renderer()/Parser()/Processor().
/// </summary>
public static class VectorProviders
{
    public static IRendererProvider Renderer() => new SeamRendererProvider();

    public static IParserProvider Parser() => new SeamParserProvider();

    public static IProcessorProvider Processor() => new SeamProcessorProvider();
}
