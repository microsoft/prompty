package vectoradapters

// Hand-written seam-conformance provider doubles.
//
// The generated per-seam conformance tests (renderer/parser/processor) resolve
// an implementation via the generated `Resolve*` switch and a `*Provider`
// registry, call the primary seam method, and assert only that no error is
// returned (the value is discarded). These are smoke tests: value/error
// correctness lives in the vector conformance suite. The three
// `*Provider()` constructors below hand the resolver concrete doubles that
// delegate to the real runtime pipeline helpers, mirroring the Rust
// `vector_adapters::{renderer,parser,processor}_provider()` seam doubles.

import (
	"prompty/jinjasubset"
	prompty "prompty/model"
)

// RendererProvider hands the Renderer resolver one double per @dispatch variant.
// Custom stays nil (no `*` renderer variant is exercised), matching the Rust
// renderer double's `custom: None`.
func RendererProvider() prompty.RendererProvider {
	provider, err := prompty.NewRendererProvider(map[string]prompty.Renderer{
		"jinja2":   seamRenderer{engine: "jinja2"},
		"mustache": seamRenderer{engine: "mustache"},
	})
	if err != nil {
		panic(err)
	}
	return provider
}

// ParserProvider hands the Parser resolver the prompty double. Custom stays nil.
func ParserProvider() prompty.ParserProvider {
	provider, err := prompty.NewParserProvider(map[string]prompty.Parser{
		"prompty": seamParser{},
	})
	if err != nil {
		panic(err)
	}
	return provider
}

// ProcessorProvider hands the Processor resolver openai/azure doubles plus a
// custom catch-all. The custom slot is populated (unlike renderer/parser)
// because provider discriminators such as "anthropic" route to Custom, and the
// double resolves the real provider from the agent before delegating.
func ProcessorProvider() prompty.ProcessorProvider {
	provider, err := prompty.NewProcessorProvider(map[string]prompty.Processor{
		"openai": seamProcessor{},
		"azure":  seamProcessor{},
		"custom": seamProcessor{},
	})
	if err != nil {
		panic(err)
	}
	return provider
}

// --- Renderer double ---------------------------------------------------------

// seamRenderer renders an explicit template string with the given inputs using
// its fixed engine, reusing the runtime render path via buildRenderAgent.
type seamRenderer struct{ engine string }

func (r seamRenderer) Render(agent prompty.Agent, template string, inputs map[string]interface{}) (string, error) {
	built := buildRenderAgent(template, r.engine, inputs)
	rendered, _, err := prompty.Render(built, inputs)
	return rendered, err
}

func (r seamRenderer) RenderSegments(agent prompty.Agent, template string, inputs map[string]interface{}) ([]prompty.RenderSegment, error) {
	segs, err := jinjasubset.RenderSegments(template, inputs, nil)
	if err != nil {
		return nil, err
	}
	out := make([]prompty.RenderSegment, 0, len(segs))
	for _, s := range segs {
		seg := prompty.RenderSegment{
			Kind:   prompty.RenderSegmentKind(s.Kind),
			Text:   s.Text,
			Source: s.Source,
		}
		if s.Strict {
			strict := true
			seg.Strict = &strict
		}
		out = append(out, seg)
	}
	return out, nil
}

// --- Parser double -----------------------------------------------------------

// seamParser splits rendered text into structured messages via the runtime
// chat parser.
type seamParser struct{}

func (seamParser) Parse(agent prompty.Agent, rendered string, context *map[string]interface{}) ([]prompty.Message, error) {
	return prompty.ParseMessages(rendered), nil
}

func (seamParser) PreRender(template string) *interface{} {
	return nil
}

// --- Processor double --------------------------------------------------------

// seamProcessor normalizes a raw provider response via the runtime processor.
// The provider/apiType discriminators are read from the agent's coerce-union
// Model field, so a single double serves the openai, azure, and custom slots.
type seamProcessor struct{}

func (seamProcessor) Process(agent prompty.Agent, response interface{}) (interface{}, error) {
	provider := agentModelDiscriminator(agent, "provider", "openai")
	apiType := agentModelDiscriminator(agent, "apiType", "chat")
	hasOutputs := len(agent.Outputs) > 0
	return prompty.ProcessResponse(provider, apiType, response, hasOutputs)
}

func (seamProcessor) ProcessStream(agent prompty.Agent, stream interface{}) (interface{}, error) {
	return nil, nil
}

// agentModelDiscriminator reads a discriminator field (e.g. "provider",
// "apiType") from the agent's value-backed Model coerce-union, falling back
// when the field is absent.
func agentModelDiscriminator(agent prompty.Agent, field, fallback string) string {
	if agent.Model == nil {
		return fallback
	}
	if saver, ok := agent.Model.(interface {
		Save(*prompty.SaveContext) map[string]interface{}
	}); ok {
		if v, ok := saver.Save(prompty.NewSaveContext())[field].(string); ok && v != "" {
			return v
		}
		return fallback
	}
	if m, ok := agent.Model.(map[string]interface{}); ok {
		if v, ok := m[field].(string); ok && v != "" {
			return v
		}
	}
	return fallback
}
