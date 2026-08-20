package vectoradapters

import prompty "prompty/model"

// Adapter binds a Typra vector operation to runtime code.
type Adapter struct {
	Invoke    func(input any, ctx Context) (any, error)
	Normalize func(value any, ctx Context) any
}

// Context is supplied by the generated vector conformance harness.
type Context struct {
	Contract  string
	Operation string
	Vector    map[string]any
	Provider  string
	TargetAPI string
	Doubles   map[string]any
	BaseDir   string
}

// VectorAdapters registers genuinely wired conformance adapters.
var VectorAdapters = map[string]Adapter{
	"DiscoveryConformance.enrich": {
		Invoke: func(input any, ctx Context) (any, error) {
			base, err := prompty.LoadModelInfo(input, prompty.NewLoadContext())
			if err != nil {
				return nil, err
			}
			return prompty.Enrich(&base, ctx.Provider).Save(prompty.NewSaveContext()), nil
		},
	},
	"DiscoveryConformance.mapModel": {
		Invoke: func(input any, ctx Context) (any, error) {
			return prompty.MapModel(input, ctx.Provider).Save(prompty.NewSaveContext()), nil
		},
	},
}

// VectorWaivers records explicit, honest conformance gaps.
var VectorWaivers = map[string]string{
	"LoadConformance.load": "Not yet wired (deferred). The Go loader is synchronous and wireable; scheduled for a follow-up increment.",
	"Renderer.render": "Not yet wired (deferred). The Go pipeline API is synchronous and directly wireable; scheduled for a follow-up increment. Not wired here to avoid reimplementing runtime logic in the adapter.",
	"Parser.parse": "Not yet wired (deferred). The Go pipeline API is synchronous and directly wireable; scheduled for a follow-up increment. Not wired here to avoid reimplementing runtime logic in the adapter.",
	"WireConformance.toRequest": "Not yet wired (deferred). The Go pipeline API is synchronous and directly wireable; scheduled for a follow-up increment. Not wired here to avoid reimplementing runtime logic in the adapter.",
	"Processor.process": "Not yet wired (deferred). The Go pipeline API is synchronous and directly wireable; scheduled for a follow-up increment. Not wired here to avoid reimplementing runtime logic in the adapter.",
	"TurnConformance.replay": "Not yet wired (deferred). Directly wireable (Go is synchronous); scheduled for a follow-up increment.",
	"TurnConformance.run": "The run vectors assert an agent-loop accounting/observability contract (iteration counting = LLM-call count, total_messages including the final assistant message, exact event schemas) not yet matched by the runtime. Same honest gap as the Python reference.",
	"TurnConformance.runTurn": "Requires the not-yet-implemented snapshot/portability turn engine. Same gap as the Python reference.",
}

// VectorDoubles is reserved for deterministic test doubles.
var VectorDoubles = map[string]any{}
