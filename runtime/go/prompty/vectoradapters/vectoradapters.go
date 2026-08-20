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
//
// The Go runtime currently ships the generated model layer (load/save), the
// discovery mapper (enrich/mapModel, wired above), and a reference turn/replay
// engine (ReferenceTurnRunner). The .prompty document loader, template
// renderer, chat parser, provider wire-mapping, and response processor are not
// yet implemented in Go, so there is genuinely no runtime code to drive those
// vectors — these are absent-layer gaps, not wiring deferrals.
var VectorWaivers = map[string]string{
	"LoadConformance.load":      absentPipeline,
	"Renderer.render":           absentPipeline,
	"Parser.parse":              absentPipeline,
	"WireConformance.toRequest": absentPipeline,
	"Processor.process":         absentPipeline,
	"TurnConformance.replay": "Implemented by ReferenceTurnRunner and exercised against the shared `replay` vectors by TestReferenceTurnRunnerMatchesSharedGoldenReplayVectors in turn_runner_test.go. Not driven through this generated adapter because the replay contract uses the reconstructed journal/scenario object shape the dedicated runner already asserts (mirrors the Rust reference).",
	"TurnConformance.run":     "The run vectors assert an agent-loop accounting/observability contract (iteration counting = LLM-call count, total_messages including the final assistant message, exact event schemas). The Go runtime does not implement that LLM agent loop, so this stays waived — same honest gap as the Python reference.",
	"TurnConformance.runTurn": "Requires the not-yet-implemented snapshot/portability turn engine contract. Same gap as the Python reference.",
}

// absentPipeline is the shared honest reason for the load/render/parse/wire/
// process operations that the Go runtime does not yet implement.
const absentPipeline = "Not implemented in the Go runtime. Go currently ships the generated model layer, the discovery mapper (enrich/mapModel), and a reference turn/replay engine; the .prompty loader, template renderer, chat parser, provider wire-mapping, and response processor do not exist yet, so there is no runtime code to drive this vector. Absent-layer gap, not a wiring deferral."

// VectorDoubles is reserved for deterministic test doubles.
var VectorDoubles = map[string]any{}
