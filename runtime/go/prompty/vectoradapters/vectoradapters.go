package vectoradapters

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"prompty/jinjasubset"
	prompty "prompty/model"
)

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
	"Renderer.renderSegments": {
		Invoke: func(input any, ctx Context) (any, error) {
			typed, _ := input.(map[string]any)
			template, _ := typed["template"].(string)
			inputs, _ := typed["inputs"].(map[string]any)
			strictProps := toStringSlice(typed["strict_props"])
			segments, err := jinjasubset.RenderSegments(template, inputs, strictProps)
			if err != nil {
				if jinjasubset.IsStrictViolation(err) {
					return map[string]any{"error": "StrictViolation"}, nil
				}
				return nil, err
			}
			out := make([]any, len(segments))
			for i, segment := range segments {
				var source any
				if segment.Source != nil {
					source = *segment.Source
				}
				out[i] = map[string]any{
					"kind":   segment.Kind,
					"text":   segment.Text,
					"source": source,
					"strict": segment.Strict,
				}
			}
			return map[string]any{"segments": out}, nil
		},
		Normalize: projectNormalize,
	},
	// Renderer.render -- render agent instructions through the real render
	// pipeline (jinja2/mustache dispatch + thread-nonce injection).
	"Renderer.render": {
		Invoke:    renderInvoke,
		Normalize: renderNormalize,
	},
	// Parser.parse -- parse rendered role-marker text into structured messages
	// through the real chat parser + thread-marker expansion.
	"Parser.parse": {
		Invoke:    parseInvoke,
		Normalize: projectNormalize,
	},
	// Processor.process -- normalize a raw provider response into the result
	// contract (text / tool calls / structured object / embeddings) via the real
	// OpenAI + Anthropic processors.
	"Processor.process": {
		Invoke:    processInvoke,
		Normalize: projectNormalize,
	},
	// WireConformance.toRequest -- map canonical agent + messages into a
	// provider-specific request body via the real wire builders.
	"WireConformance.toRequest": {
		Invoke:    wireInvoke,
		Normalize: projectNormalize,
	},
	// LoadConformance.load -- drive the real .prompty load pipeline: split
	// frontmatter/body, resolve ${env:}/${file:} refs, reject invalid templates,
	// load through the generated Agent model, and validate inputs.
	"LoadConformance.load": {
		Invoke:    loadInvoke,
		Normalize: loadNormalize,
	},
	// Processor.processStream -- classify a raw provider stream and reconcile the
	// streaming-failure contract via the provider-agnostic engine.
	"Processor.processStream": {
		Invoke:    processStreamInvoke,
		Normalize: projectNormalize,
	},
	// TurnConformance.run -- drive the provider-agnostic agent loop.
	"TurnConformance.run": {
		Invoke:    runInvoke,
		Normalize: runNormalize,
	},
	// TurnConformance.runTurn -- drive the provider-agnostic snapshot/portability
	// turn engine.
	"TurnConformance.runTurn": {
		Invoke:    runTurnInvoke,
		Normalize: projectNormalize,
	},
	// TurnConformance.replay -- drive the ReferenceTurnRunner and normalize its
	// emitted journal to the shared golden line form.
	"TurnConformance.replay": {
		Invoke: replayInvoke,
	},
}

// VectorWaivers records explicit, honest conformance gaps. Empty: every gap is
// being driven to green rather than waived.
var VectorWaivers = map[string]string{}

// VectorDoubles is reserved for deterministic test doubles.
var VectorDoubles = map[string]any{}

func toStringSlice(value any) []string {
	switch typed := value.(type) {
	case nil:
		return nil
	case []string:
		return typed
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}

func projectNormalize(observed any, ctx Context) any {
	return project(observed, ctx.Vector["expected"])
}

func project(observed any, expected any) any {
	expMap, expMapOK := expected.(map[string]any)
	obsMap, obsMapOK := observed.(map[string]any)
	if expMapOK && obsMapOK {
		out := make(map[string]any, len(expMap))
		for key, expectedValue := range expMap {
			out[key] = project(obsMap[key], expectedValue)
		}
		return out
	}

	expList, expListOK := expected.([]any)
	obsList, obsListOK := observed.([]any)
	if expListOK && obsListOK {
		if len(expList) != len(obsList) {
			return observed
		}
		out := make([]any, len(expList))
		for i := range expList {
			out[i] = project(obsList[i], expList[i])
		}
		return out
	}

	return observed
}

// ---------------------------------------------------------------------------
// Renderer.render
// ---------------------------------------------------------------------------

// buildRenderAgent synthesizes an Agent from a render vector's raw input,
// inferring declared input kinds from any embedded `_kind` markers so that
// rich-kind (thread/image/file/audio) inputs trigger nonce substitution.
func buildRenderAgent(template, engine string, inputs map[string]any) *prompty.Agent {
	if engine == "" {
		engine = "jinja2"
	}
	props := make([]any, 0, len(inputs))
	for name, val := range inputs {
		kind := "string"
		if m, ok := val.(map[string]any); ok {
			if k, ok := m["_kind"].(string); ok {
				kind = k
			}
		}
		props = append(props, prompty.Property{Name: name, Kind: kind})
	}
	instr := template
	return &prompty.Agent{
		Instructions: &instr,
		Inputs:       props,
		Template: &prompty.Template{
			Format: prompty.FormatConfig{Kind: engine},
			Parser: prompty.ParserConfig{Kind: "prompty"},
		},
	}
}

func renderInvoke(input any, _ Context) (any, error) {
	typed, _ := input.(map[string]any)
	template, _ := typed["template"].(string)
	engine, err := seamDiscriminator(typed, "template", "format", "kind")
	if err != nil {
		return nil, err
	}
	inputs, _ := typed["inputs"].(map[string]any)
	agent := buildRenderAgent(template, engine, inputs)
	rendered, _, err := prompty.Render(agent, inputs)
	if err != nil {
		return nil, err
	}
	return map[string]any{"rendered": rendered}, nil
}

// renderNormalize handles both exact-text expectations ({"rendered": ...}) and
// nonce-pattern expectations, where the rendered output contains a random hex
// nonce and is graded against a regular expression.
func renderNormalize(observed any, ctx Context) any {
	expected, _ := ctx.Vector["expected"].(map[string]any)
	if pat, ok := expected["nonce_pattern"].(string); ok {
		obs, _ := observed.(map[string]any)
		rendered, _ := obs["rendered"].(string)
		if regexp.MustCompile(pat).MatchString(rendered) {
			return expected
		}
		return map[string]any{"nonce_pattern": rendered}
	}
	return project(observed, ctx.Vector["expected"])
}

// ---------------------------------------------------------------------------
// Parser.parse
// ---------------------------------------------------------------------------

func parseInvoke(input any, _ Context) (any, error) {
	typed, _ := input.(map[string]any)
	rendered, _ := typed["rendered"].(string)
	messages := prompty.ParseMessages(rendered)

	if ti, ok := typed["thread_inputs"].(map[string]any); ok && len(ti) > 0 {
		threadInputs := map[string][]prompty.Message{}
		for name, val := range ti {
			threadInputs[name] = vectorMessagesToModel(val)
		}
		messages = prompty.ExpandThreadMarkers(messages, threadInputs)
	}

	return map[string]any{"messages": saveConformanceMessages(messages)}, nil
}

// vectorMessagesToModel converts conformance-shaped message maps (which use a
// `content` array) into runtime Message values.
func vectorMessagesToModel(val any) []prompty.Message {
	out := []prompty.Message{}
	for _, item := range toMapSlice(val) {
		role, _ := item["role"].(string)
		parts := []any{}
		for _, c := range toMapSlice(item["content"]) {
			kind, _ := c["kind"].(string)
			value, _ := c["value"].(string)
			if kind == "" {
				kind = "text"
			}
			parts = append(parts, prompty.TextPart{Kind: kind, Value: value})
		}
		msg := prompty.Message{Role: prompty.Role(role), Parts: parts}
		if md, ok := item["metadata"].(map[string]any); ok && len(md) > 0 {
			msg.Metadata = md
		}
		out = append(out, msg)
	}
	return out
}

// saveConformanceMessages serializes messages into the conformance wire shape,
// which uses a `content` array (not `parts`) and omits empty metadata.
func saveConformanceMessages(messages []prompty.Message) []any {
	out := make([]any, 0, len(messages))
	for _, msg := range messages {
		content := make([]any, 0, len(msg.Parts))
		for _, p := range msg.Parts {
			content = append(content, partToConformance(p))
		}
		m := map[string]any{"role": string(msg.Role), "content": content}
		if len(msg.Metadata) > 0 {
			m["metadata"] = msg.Metadata
		}
		out = append(out, m)
	}
	return out
}

func partToConformance(p any) any {
	switch tp := p.(type) {
	case prompty.TextPart:
		return map[string]any{"kind": tp.Kind, "value": tp.Value}
	case *prompty.TextPart:
		if tp == nil {
			return map[string]any{}
		}
		return map[string]any{"kind": tp.Kind, "value": tp.Value}
	case map[string]any:
		return tp
	default:
		return map[string]any{}
	}
}

// -----------------------------------------------------------------------------
// Processor.process
// -----------------------------------------------------------------------------

func processInvoke(input any, _ Context) (any, error) {
	typed, _ := input.(map[string]any)
	provider, err := seamDiscriminator(typed, "model", "provider")
	if err != nil {
		return nil, err
	}
	apiType, _ := typed["apiType"].(string)
	hasOutputs, _ := typed["has_outputs"].(bool)
	result, err := prompty.ProcessResponse(provider, apiType, typed["response"], hasOutputs)
	if err != nil {
		return nil, err
	}
	return map[string]any{"result": result}, nil
}

// -----------------------------------------------------------------------------
// WireConformance.toRequest
// -----------------------------------------------------------------------------

func wireInvoke(input any, _ Context) (any, error) {
	typed, _ := input.(map[string]any)
	provider, err := seamDiscriminator(typed, "model", "provider")
	if err != nil {
		return nil, err
	}
	typed["provider"] = provider
	body, err := prompty.BuildWireRequest(typed)
	if err != nil {
		return nil, err
	}
	return map[string]any{"request_body": body}, nil
}

// -----------------------------------------------------------------------------
// LoadConformance.load
// -----------------------------------------------------------------------------

// loadInvoke drives the real load pipeline. It reconstructs the load source
// (a spec fixture, raw frontmatter text, or an inline frontmatter dict with
// optional materialized files), runs the loader, and shapes the result as the
// canonical Agent.Save() form. Error vectors surface as a returned error
// carrying its canonical {kind, [field]} via TypraVector(), so the harness
// matches it against expectedError.
func loadInvoke(input any, ctx Context) (any, error) {
	typed, _ := input.(map[string]any)

	restore := applyEnv(typed["env"])
	defer restore()

	// Input-validation vectors carry both a top-level `inputs` map and a
	// `frontmatter`; full-load vectors nest inputs inside the frontmatter.
	_, hasInputs := typed["inputs"]
	_, hasFrontmatter := typed["frontmatter"]
	if hasInputs && hasFrontmatter {
		agent, err := prompty.BuildAgentFromData(unwrapProperties(toMapAny(typed["frontmatter"])))
		if err != nil {
			return nil, wrapLoadError(err)
		}
		validated, verr := prompty.ValidateInputs(agent, toMapAny(typed["inputs"]))
		if verr != nil {
			return nil, wrapLoadError(verr)
		}
		return map[string]any{"validated_inputs": validated}, nil
	}

	var agent prompty.Agent
	var err error
	switch {
	case isNonEmptyString(typed["fixture"]):
		dir := findSpecFixtures(ctx.BaseDir)
		agent, err = prompty.LoadPromptyFile(filepath.Join(dir, typed["fixture"].(string)))
	case isNonEmptyString(typed["frontmatter_raw"]):
		agent, err = loadFromRaw(typed["frontmatter_raw"].(string))
	case isMapAny(typed["frontmatter"]):
		agent, err = materializeAndLoad(typed)
	default:
		return nil, fmt.Errorf("<no loadable input>")
	}
	if err != nil {
		return nil, wrapLoadError(err)
	}
	return canonicalAgent(agent), nil
}

// loadNormalize projects the observed value onto the vector's expected shape
// (subset semantics). For error vectors it projects onto expectedError so the
// canonical {kind, [field]} payload compares cleanly.
func loadNormalize(observed any, ctx Context) any {
	if exp, ok := ctx.Vector["expectedError"]; ok {
		return project(observed, exp)
	}
	return project(observed, ctx.Vector["expected"])
}

// unwrapProperties folds {inputs:{properties:[...]}} down to inputs:[...] (and
// likewise for outputs) so the generated loader sees the collection directly.
func unwrapProperties(data map[string]any) map[string]any {
	if data == nil {
		return map[string]any{}
	}
	for _, field := range []string{"inputs", "outputs"} {
		if v, ok := data[field].(map[string]any); ok {
			if props, ok := v["properties"]; ok {
				data[field] = props
			}
		}
	}
	return data
}

func loadFromRaw(raw string) (prompty.Agent, error) {
	tmp, err := os.MkdirTemp("", "prompty-load-")
	if err != nil {
		return prompty.Agent{}, err
	}
	defer os.RemoveAll(tmp)
	return prompty.LoadPromptyContent(strings.ReplaceAll(raw, "\r\n", "\n"), tmp, []string{tmp})
}

// materializeAndLoad writes the vector's files (honoring agent_subdir and
// allowing `..` keys so path-traversal vectors can plant a target outside the
// allowed root), resolves references against the agent directory, and loads.
func materializeAndLoad(input map[string]any) (prompty.Agent, error) {
	tempBase, err := os.MkdirTemp("", "prompty-load-")
	if err != nil {
		return prompty.Agent{}, err
	}
	defer os.RemoveAll(tempBase)

	agentDir := tempBase
	if sd, ok := input["agent_subdir"].(string); ok && sd != "" {
		agentDir = filepath.Join(tempBase, sd)
	}
	if err := os.MkdirAll(agentDir, 0o755); err != nil {
		return prompty.Agent{}, err
	}

	if files, ok := input["files"].(map[string]any); ok {
		for name, content := range files {
			fpath := filepath.Join(agentDir, name)
			if parent := filepath.Dir(fpath); parent != "" {
				if err := os.MkdirAll(parent, 0o755); err != nil {
					return prompty.Agent{}, err
				}
			}
			if err := os.WriteFile(fpath, fileContentBytes(content), 0o644); err != nil {
				return prompty.Agent{}, err
			}
		}
	}

	frontmatter := toMapAny(input["frontmatter"])
	roots := []string{canonicalDir(agentDir)}
	if err := prompty.ResolveReferences(frontmatter, agentDir, roots); err != nil {
		return prompty.Agent{}, err
	}
	return prompty.BuildAgentFromData(frontmatter)
}

func fileContentBytes(content any) []byte {
	if s, ok := content.(string); ok {
		return []byte(s)
	}
	data, err := json.Marshal(content)
	if err != nil {
		return []byte{}
	}
	return data
}

// findSpecFixtures walks up from the harness directory until it finds
// spec/fixtures, mirroring the C# reference adapter's discovery.
func findSpecFixtures(baseDir string) string {
	dir := baseDir
	for i := 0; i < 12; i++ {
		candidate := filepath.Join(dir, "spec", "fixtures")
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return filepath.Join(baseDir, "spec", "fixtures")
}

func canonicalDir(p string) string {
	if abs, err := filepath.Abs(p); err == nil {
		p = abs
	}
	if resolved, err := filepath.EvalSymlinks(p); err == nil {
		return resolved
	}
	return filepath.Clean(p)
}

// canonicalAgent shapes a loaded Agent into the cross-runtime canonical form:
// inject kind=prompt, save with ordered array collections, trim trailing
// newlines from instructions, and fold each tool's bindings back into a
// name-keyed map (bindings are the one collection kept in object form).
func canonicalAgent(agent prompty.Agent) map[string]any {
	sc := &prompty.SaveContext{UseShorthand: false, CollectionFormat: prompty.CollectionFormatArray}
	saved := agent.Save(sc)
	out := map[string]any{"kind": "prompt"}
	for key, value := range saved {
		out[key] = value
	}
	if instr, ok := out["instructions"].(string); ok {
		out["instructions"] = strings.TrimRight(instr, "\n")
	}
	if tools, ok := out["tools"].([]any); ok {
		for _, tool := range tools {
			tm, ok := tool.(map[string]any)
			if !ok {
				continue
			}
			if bindings, ok := tm["bindings"].([]any); ok {
				tm["bindings"] = bindingsToMap(bindings)
			}
		}
	}
	return out
}

func bindingsToMap(bindings []any) map[string]any {
	out := make(map[string]any, len(bindings))
	for _, b := range bindings {
		bm, ok := b.(map[string]any)
		if !ok {
			continue
		}
		name, _ := bm["name"].(string)
		if name == "" {
			continue
		}
		rest := make(map[string]any, len(bm))
		for key, value := range bm {
			if key == "name" {
				continue
			}
			rest[key] = value
		}
		out[name] = rest
	}
	return out
}

// vectorError carries a canonical {kind, [field]} payload alongside a load
// error so the conformance harness can match it against expectedError via the
// TypraVector() interface.
type vectorError struct {
	err     error
	payload map[string]any
}

func (e *vectorError) Error() string    { return e.err.Error() }
func (e *vectorError) Unwrap() error    { return e.err }
func (e *vectorError) TypraVector() any { return e.payload }

// loadErrorPayload maps a typed *prompty.LoadError onto the canonical
// cross-runtime error taxonomy. Mapping is by the typed Kind only -- no message
// substring matching -- so an unrecognized error surfaces its own message and
// fails the vector loudly rather than passing silently.
func loadErrorPayload(err error) (map[string]any, bool) {
	var le *prompty.LoadError
	if !errors.As(err, &le) {
		return nil, false
	}
	var kind string
	switch le.Kind {
	case "env":
		kind = "env_var_not_set"
	case "file_traversal":
		kind = "file_reference"
	case "file_missing", "not_found":
		kind = "file_not_found"
	case "frontmatter":
		kind = "invalid_frontmatter"
	case "template":
		kind = "invalid_template"
	case "required_input":
		kind = "missing_required_input"
	default:
		return nil, false
	}
	payload := map[string]any{"kind": kind}
	if le.Field != "" {
		payload["field"] = le.Field
	}
	return payload, true
}

// wrapLoadError attaches the canonical error payload to a load error when it is
// a recognized typed error; otherwise the original error is returned unchanged.
func wrapLoadError(err error) error {
	if payload, ok := loadErrorPayload(err); ok {
		return &vectorError{err: err, payload: payload}
	}
	return err
}

func applyEnv(value any) func() {
	envMap, _ := value.(map[string]any)
	saved := make(map[string]*string, len(envMap))
	for key, raw := range envMap {
		if prev, ok := os.LookupEnv(key); ok {
			saved[key] = &prev
		} else {
			saved[key] = nil
		}
		os.Setenv(key, fmt.Sprintf("%v", raw))
	}
	return func() {
		for key, prev := range saved {
			if prev == nil {
				os.Unsetenv(key)
			} else {
				os.Setenv(key, *prev)
			}
		}
	}
}

func toMapAny(value any) map[string]any {
	if m, ok := value.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func isNonEmptyString(value any) bool {
	s, ok := value.(string)
	return ok && s != ""
}

func isMapAny(value any) bool {
	_, ok := value.(map[string]any)
	return ok
}

func toAnySlice(value any) []any {
	switch typed := value.(type) {
	case nil:
		return nil
	case []any:
		return typed
	default:
		return nil
	}
}

func toMapSlice(value any) []map[string]any {
	items := toAnySlice(value)
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if m, ok := item.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func mapsToAny(values []map[string]any) []any {
	out := make([]any, 0, len(values))
	for _, value := range values {
		out = append(out, value)
	}
	return out
}

func stringsToAny(values []string) []any {
	out := make([]any, 0, len(values))
	for _, value := range values {
		out = append(out, value)
	}
	return out
}

func intsToAny(values []int) []any {
	out := make([]any, 0, len(values))
	for _, value := range values {
		out = append(out, value)
	}
	return out
}

func toInt(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case float32:
		return int(typed)
	case json.Number:
		if n, err := typed.Int64(); err == nil {
			return int(n)
		}
	case string:
		if n, err := strconv.Atoi(typed); err == nil {
			return n
		}
	}
	return 0
}

func asBool(value any) bool {
	b, _ := value.(bool)
	return b
}

func strOr(value any, fallback string) string {
	if s, ok := value.(string); ok {
		return s
	}
	return fallback
}

func seamDiscriminator(input map[string]any, path ...string) (string, error) {
	var node any
	if input != nil {
		node = input["agent"]
	}
	for _, key := range path {
		next, ok := node.(map[string]any)
		if !ok {
			node = nil
			break
		}
		node = next[key]
	}
	if value, ok := node.(string); ok && value != "" {
		return value, nil
	}
	dotted := "agent"
	for _, key := range path {
		dotted += "." + key
	}
	return "", fmt.Errorf("vector input missing @dispatch discriminator at '%s'; every conformance vector must nest the discriminator under the seam-param path (no flat-sibling fallback)", dotted)
}

// ---------------------------------------------------------------------------
// Processor.processStream
// ---------------------------------------------------------------------------

func processStreamInvoke(input any, _ Context) (any, error) {
	typed, _ := input.(map[string]any)
	provider, err := seamDiscriminator(typed, "model", "provider")
	if err != nil {
		return nil, err
	}
	if provider != "openai" {
		return nil, fmt.Errorf("unsupported stream provider: %q", provider)
	}

	chunks, err := prompty.ClassifyStreamEvents(toAnySlice(typed["events"]))
	if err != nil {
		return nil, err
	}

	saved := make([]any, len(chunks))
	for i, chunk := range chunks {
		saved[i] = chunk.Save(prompty.NewSaveContext())
	}
	out := map[string]any{"chunks": saved}
	for key, value := range prompty.ReconcileStream(chunks).Save() {
		out[key] = value
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// TurnConformance.run -- provider-agnostic agent loop
// ---------------------------------------------------------------------------

// scriptedModel replays a vector's sequence as the agent loop's model callback,
// recording each step's tool_results so dispatch can return them by tool_call_id.
type scriptedModel struct {
	sequence []any
	index    int
	results  map[string]any
}

func (m *scriptedModel) invoke(_ []map[string]any) prompty.AgentModelResponse {
	step, _ := m.sequence[m.index].(map[string]any)
	m.index++
	llm, _ := step["llm_response"].(map[string]any)
	choices := toAnySlice(llm["choices"])
	var message map[string]any
	if len(choices) > 0 {
		first, _ := choices[0].(map[string]any)
		message, _ = first["message"].(map[string]any)
	}
	if message == nil {
		message = map[string]any{}
	}

	rawToolCalls := toAnySlice(message["tool_calls"])
	toolCalls := make([]prompty.AgentToolCall, 0, len(rawToolCalls))
	for _, raw := range rawToolCalls {
		tc, _ := raw.(map[string]any)
		fn, _ := tc["function"].(map[string]any)
		toolCalls = append(toolCalls, prompty.AgentToolCall{
			Id:        strOr(tc["id"], ""),
			Name:      strOr(fn["name"], ""),
			Arguments: strOr(fn["arguments"], ""),
		})
	}

	m.results = map[string]any{}
	for _, raw := range toAnySlice(step["tool_results"]) {
		tr, _ := raw.(map[string]any)
		m.results[strOr(tr["tool_call_id"], "")] = tr["result"]
	}

	var raw []interface{}
	if len(rawToolCalls) > 0 {
		raw = rawToolCalls
	}
	return prompty.AgentModelResponse{
		Content:      message["content"],
		ToolCalls:    toolCalls,
		RawToolCalls: raw,
	}
}

func (m *scriptedModel) dispatch(call prompty.AgentToolCall) string {
	if value, ok := m.results[call.Id]; ok {
		if s, ok := value.(string); ok {
			return s
		}
		return fmt.Sprintf("%v", value)
	}
	return ""
}

func runGuardrails(flags map[string]any) (
	inputGuardrail func([]map[string]any) prompty.AgentGuardrailDecision,
	outputGuardrail func(prompty.AgentModelResponse) prompty.AgentGuardrailDecision,
	toolGuardrail func(string, map[string]any) prompty.AgentGuardrailDecision,
) {
	guardrails, _ := flags["guardrails"].(map[string]any)
	if guardrails == nil {
		return nil, nil, nil
	}

	if inputCfg, ok := guardrails["input"].(map[string]any); ok {
		inputGuardrail = func(_ []map[string]any) prompty.AgentGuardrailDecision {
			if inputCfg["action"] == "deny" {
				return prompty.AgentGuardrailDecision{Allowed: false, Reason: inputCfg["reason"]}
			}
			return prompty.AgentGuardrailDecision{Allowed: true}
		}
	}

	if outputCfg, ok := guardrails["output"].(map[string]any); ok {
		outputGuardrail = func(_ prompty.AgentModelResponse) prompty.AgentGuardrailDecision {
			if outputCfg["action"] == "deny" {
				return prompty.AgentGuardrailDecision{Allowed: false, Reason: outputCfg["reason"]}
			}
			return prompty.AgentGuardrailDecision{Allowed: true}
		}
	}

	if toolCfg, ok := guardrails["tool"].(map[string]any); ok {
		deny := map[string]bool{}
		for _, name := range toStringSlice(toolCfg["deny_tools"]) {
			deny[name] = true
		}
		reason := toolCfg["reason"]
		toolGuardrail = func(name string, _ map[string]any) prompty.AgentGuardrailDecision {
			if deny[name] {
				return prompty.AgentGuardrailDecision{Allowed: false, Reason: reason}
			}
			return prompty.AgentGuardrailDecision{Allowed: true}
		}
	}

	return inputGuardrail, outputGuardrail, toolGuardrail
}

func runSteering(flags map[string]any) []prompty.AgentSteeringMessage {
	steeringCfg, _ := flags["steering"].(map[string]any)
	if steeringCfg == nil {
		return nil
	}
	var steering []prompty.AgentSteeringMessage
	for _, raw := range toAnySlice(steeringCfg["messages"]) {
		item, _ := raw.(map[string]any)
		steering = append(steering, prompty.AgentSteeringMessage{
			InjectBeforeIteration: toInt(item["inject_before_iteration"]),
			Role:                  strOr(item["role"], "user"),
			Text:                  strOr(item["text"], ""),
		})
	}
	return steering
}

func runScriptedSummary(expected map[string]any) *string {
	for _, raw := range toAnySlice(expected["trimmed_messages"]) {
		message, _ := raw.(map[string]any)
		if content, ok := message["content"].(string); ok && strings.HasPrefix(content, prompty.AgentSummaryPrefix) {
			summary := content
			return &summary
		}
	}
	return nil
}

func firstMessage(conversation []map[string]any, predicate func(map[string]any) bool) map[string]any {
	for _, message := range conversation {
		if predicate(message) {
			return message
		}
	}
	return nil
}

func runInvoke(input any, ctx Context) (any, error) {
	flags, _ := input.(map[string]any)
	expected, _ := ctx.Vector["expected"].(map[string]any)

	messages := toMapSlice(flags["messages"])
	toolFunctions, _ := flags["tool_functions"].(map[string]any)
	sequence := toAnySlice(ctx.Vector["sequence"])

	model := &scriptedModel{sequence: sequence}
	inputGuardrail, outputGuardrail, toolGuardrail := runGuardrails(flags)

	var contextBudget *int
	if raw, ok := flags["context_budget"]; ok && raw != nil {
		budget := toInt(raw)
		contextBudget = &budget
	}

	var cancelAt string
	if cancel, ok := flags["cancel"].(map[string]any); ok {
		cancelAt = strOr(cancel["cancelled_at"], "")
	}

	var summarize func([]map[string]any) string
	if summary := runScriptedSummary(expected); summary != nil {
		text := *summary
		summarize = func(_ []map[string]any) string { return text }
	}

	result := prompty.RunAgentLoop(messages, prompty.AgentLoopOptions{
		InvokeModel:  model.invoke,
		DispatchTool: model.dispatch,
		IsToolRegistered: func(name string) bool {
			_, ok := toolFunctions[name]
			return ok
		},
		InputGuardrail:  inputGuardrail,
		OutputGuardrail: outputGuardrail,
		ToolGuardrail:   toolGuardrail,
		Steering:        runSteering(flags),
		CancelAt:        cancelAt,
		ContextBudget:   contextBudget,
		Summarize:       summarize,
	})

	observed := map[string]any{
		"result":               result.Result,
		"iterations":           result.Iterations,
		"total_messages":       result.TotalMessages(),
		"message_sequence":     mapsToAny(result.Conversation),
		"tools_executed":       result.ToolsExecuted,
		"tool_execution_order": stringsToAny(result.ToolExecutionOrder),
		"denied_tools":         stringsToAny(result.DeniedTools),
		"events":               mapsToAny(result.Events),
	}
	if result.TrimmedMessages != nil {
		observed["trimmed_messages"] = mapsToAny(result.TrimmedMessages)
	} else {
		observed["trimmed_messages"] = nil
	}

	assistantToolCalls := firstMessage(result.Conversation, func(message map[string]any) bool {
		if message["role"] != "assistant" {
			return false
		}
		metadata, ok := message["metadata"].(map[string]any)
		if !ok {
			return false
		}
		_, has := metadata["tool_calls"]
		return has
	})
	if assistantToolCalls != nil {
		observed["assistant_tool_calls_message"] = assistantToolCalls
	}

	toolMessage := firstMessage(result.Conversation, func(message map[string]any) bool {
		return message["role"] == "tool"
	})
	if toolMessage != nil {
		observed["tool_result_message"] = map[string]any{
			"role":     "tool",
			"content":  []any{map[string]any{"type": "text", "text": toolMessage["content"]}},
			"metadata": toolMessage["metadata"],
		}
	}

	if result.Error != nil {
		observed["error"] = result.Error
	}
	if result.ErrorType != nil {
		observed["error_type"] = result.ErrorType
	}
	if result.ErrorReason != nil {
		observed["error_reason"] = result.ErrorReason
	}

	// Annotation passthrough -- cross-runtime notes that are not Go behavioral
	// observations. Echo them so canonical equality holds without fabricating
	// engine output.
	for _, annotation := range []string{"notes", "summary_contains", "rust_expected_error"} {
		if value, ok := expected[annotation]; ok {
			observed[annotation] = value
		}
	}

	return observed, nil
}

func runMatchEvents(observedEvents []any, expectedEvents []any) any {
	matched := []any{}
	index := 0
	for _, rawExpected := range expectedEvents {
		expected, _ := rawExpected.(map[string]any)
		expectedType := expected["type"]
		var found map[string]any
		for index < len(observedEvents) {
			candidate, _ := observedEvents[index].(map[string]any)
			index++
			if candidate["type"] == expectedType {
				found = candidate
				break
			}
		}
		if found == nil {
			return observedEvents
		}
		if expectedData, has := expected["data"]; has {
			matched = append(matched, map[string]any{
				"type": expectedType,
				"data": project(found["data"], expectedData),
			})
		} else {
			matched = append(matched, map[string]any{"type": expectedType})
		}
	}
	return matched
}

func runNormalize(observed any, ctx Context) any {
	expected, expectedOK := ctx.Vector["expected"].(map[string]any)
	observedMap, observedOK := observed.(map[string]any)
	if !expectedOK || !observedOK {
		return observed
	}
	out := make(map[string]any, len(expected))
	for key, expectedValue := range expected {
		if key == "events" {
			out[key] = runMatchEvents(toAnySlice(observedMap["events"]), toAnySlice(expectedValue))
		} else {
			out[key] = project(observedMap[key], expectedValue)
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// TurnConformance.runTurn -- provider-agnostic snapshot/portability turn engine
// ---------------------------------------------------------------------------

func runTurnInvoke(input any, ctx Context) (any, error) {
	flags, _ := input.(map[string]any)
	messages := toAnySlice(flags["messages"])
	scripted := toAnySlice(flags["model"])
	toolOutputs, _ := flags["toolOutputs"].(map[string]any)
	denyTools := map[string]bool{}
	for _, name := range toStringSlice(flags["denyTools"]) {
		denyTools[name] = true
	}
	cancelBeforeRun := asBool(flags["cancelBeforeRun"])

	invoke := func(iteration int, _ []prompty.SnapshotTurnToolResult) prompty.SnapshotModelTurn {
		turn, _ := scripted[iteration].(map[string]any)
		var toolCalls []prompty.SnapshotTurnToolCall
		for _, raw := range toAnySlice(turn["tools"]) {
			tc, _ := raw.(map[string]any)
			arguments, _ := tc["arguments"].(map[string]any)
			toolCalls = append(toolCalls, prompty.SnapshotTurnToolCall{
				Id:        strOr(tc["id"], ""),
				Name:      strOr(tc["name"], ""),
				Arguments: arguments,
			})
		}
		var delegated []interface{}
		if raw, ok := turn["delegatedState"]; ok {
			delegated = toAnySlice(raw)
		}
		return prompty.SnapshotModelTurn{
			Output:          turn["output"],
			ToolCalls:       toolCalls,
			NextPortability: turn["nextPortability"],
			DelegatedState:  delegated,
		}
	}

	result := prompty.RunSnapshotTurn(messages, prompty.SnapshotTurnOptions{
		InvokeModel: invoke,
		ResolvePermission: func(call prompty.SnapshotTurnToolCall) bool {
			return !denyTools[call.Name]
		},
		ExecuteTool: func(call prompty.SnapshotTurnToolCall) interface{} {
			return toolOutputs[call.Id]
		},
		CancelBeforeRun: cancelBeforeRun,
	})

	return map[string]any{
		"status":                 result.Status,
		"output":                 result.Output,
		"iterations":             result.Iterations,
		"snapshots":              result.Snapshots,
		"snapshotStablePrefixes": intsToAny(result.SnapshotStablePrefixes),
		"snapshotPortability":    stringsToAny(result.SnapshotPortability),
		"commitPortability":      result.CommitPortability,
		"delegatedState":         result.DelegatedStateCount,
		"toolResults":            len(result.ToolResults),
		"toolResultOrder":        stringsToAny(result.ToolResultOrder),
		"eventKinds":             stringsToAny(result.Events),
	}, nil
}

// ---------------------------------------------------------------------------
// TurnConformance.replay -- ReferenceTurnRunner journal normalization
// ---------------------------------------------------------------------------

func replayFixedIds() func(prefix string) string {
	index := 0
	return func(prefix string) string {
		index++
		return fmt.Sprintf("%s-%d", prefix, index)
	}
}

func replayOutputPtr(value interface{}) *interface{} {
	return &value
}

func replayModelForScenario(name string) prompty.TurnModelCallback {
	return func(request prompty.TurnModelRequest) (prompty.TurnModelResponse, error) {
		if name == "no_tool" {
			inputName, _ := request.Inputs["name"].(string)
			return prompty.TurnModelResponse{
				Output:          replayOutputPtr(map[string]interface{}{"text": "hello " + inputName}),
				CheckpointState: map[string]interface{}{"stable": true},
			}, nil
		}
		if request.Iteration == 0 {
			requestId := "exec-1"
			toolCallId := "call-1"
			toolName := "add"
			if name == "tool_failure" {
				toolName = "fail"
			}
			return prompty.TurnModelResponse{ToolRequests: []prompty.HostToolRequest{{
				RequestId:  &requestId,
				ToolCallId: &toolCallId,
				ToolName:   toolName,
				Arguments:  map[string]interface{}{"a": 2, "b": 3},
			}}}, nil
		}
		return prompty.TurnModelResponse{Output: replayOutputPtr(map[string]interface{}{
			"toolResult": *request.ToolResults[0].Result,
			"errorKind":  request.ToolResults[0].ErrorKind,
		})}, nil
	}
}

func replayNumberAsInt(value interface{}) int {
	switch typed := value.(type) {
	case int:
		return typed
	case float64:
		return int(typed)
	default:
		return 0
	}
}

func replayReadRecords(path string) ([]map[string]interface{}, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	records := []map[string]interface{}{}
	for _, line := range strings.Split(strings.ReplaceAll(string(content), "\r\n", "\n"), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var record map[string]interface{}
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, nil
}

func replayNormalizeJournal(records []map[string]interface{}) []any {
	normalized := []any{}
	for _, record := range records {
		if record["kind"] == "summary" {
			summary, _ := record["summary"].(map[string]interface{})
			normalized = append(normalized, fmt.Sprintf(
				"summary:%v:%v:turns=%v:checkpoints=%v",
				summary["sessionId"], summary["status"], summary["turns"], summary["checkpoints"],
			))
			continue
		}

		event, _ := record["event"].(map[string]interface{})
		eventType, _ := event["type"].(string)
		if record["kind"] == "session" {
			if eventType == "session_end" {
				payload, _ := event["payload"].(map[string]interface{})
				normalized = append(normalized, fmt.Sprintf(
					"session:%s:%v:%v:%v",
					eventType, event["sessionId"], event["turnId"], payload["status"],
				))
			} else {
				normalized = append(normalized, fmt.Sprintf("session:%s:%v:%v", eventType, event["sessionId"], event["turnId"]))
			}
			continue
		}

		payload, _ := event["payload"].(map[string]interface{})
		iteration := event["iteration"]
		switch eventType {
		case "permission_requested":
			normalized = append(normalized, fmt.Sprintf("turn:%s:%v:%v", eventType, iteration, payload["requestId"]))
		case "permission_completed":
			normalized = append(normalized, fmt.Sprintf("turn:%s:%v:%v", eventType, iteration, payload["approved"]))
		case "tool_execution_start":
			normalized = append(normalized, fmt.Sprintf("turn:%s:%v:%v", eventType, iteration, payload["toolName"]))
		case "tool_execution_complete", "tool_result":
			value := fmt.Sprintf("turn:%s:%v:%v:%v", eventType, iteration, payload["toolName"], payload["success"])
			if payload["errorKind"] != nil {
				value = fmt.Sprintf("%s:%v", value, payload["errorKind"])
			}
			normalized = append(normalized, value)
		case "error":
			normalized = append(normalized, fmt.Sprintf("turn:%s:%v:%v", eventType, iteration, payload["errorKind"]))
		case "turn_end":
			normalized = append(normalized, fmt.Sprintf("turn:%s:%v:%v", eventType, iteration, payload["status"]))
		default:
			normalized = append(normalized, fmt.Sprintf("turn:%s:%v", eventType, iteration))
		}
	}
	return normalized
}

func replayInvoke(input any, ctx Context) (any, error) {
	resolved, _ := input.(map[string]any)
	name := strOr(ctx.Vector["name"], "")

	tmpDir, err := os.MkdirTemp("", "prompty-replay")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmpDir)

	journalPath := filepath.Join(tmpDir, name+".jsonl")
	journal, err := prompty.NewJsonlEventJournalWriter(journalPath)
	if err != nil {
		return nil, err
	}

	permissionResolver := prompty.PermissionResolver(prompty.AllowAllPermissionResolver{})
	if name == "permission_denied" {
		permissionResolver = prompty.DenyAllPermissionResolver{}
	}

	clock := strOr(resolved["clock"], "")
	runner := prompty.ReferenceTurnRunner{
		EventSink:          &prompty.CollectingEventSink{},
		Journal:            journal,
		CheckpointStore:    prompty.NewInMemoryCheckpointStore(),
		PermissionResolver: permissionResolver,
		HostToolExecutor: prompty.FunctionHostToolExecutor{Handlers: map[string]prompty.HostToolHandler{
			"add": func(arguments map[string]interface{}, request prompty.HostToolRequest) (interface{}, error) {
				return replayNumberAsInt(arguments["a"]) + replayNumberAsInt(arguments["b"]), nil
			},
			"fail": func(arguments map[string]interface{}, request prompty.HostToolRequest) (interface{}, error) {
				return nil, fmt.Errorf("boom")
			},
		}},
		InvokeModel: replayModelForScenario(name),
		Now:         func() string { return clock },
		NextId:      replayFixedIds(),
	}

	var maxIterations *int32
	if raw, ok := resolved["maxIterations"]; ok && raw != nil {
		if n := toInt(raw); n >= math.MinInt32 && n <= math.MaxInt32 {
			value := int32(n)
			maxIterations = &value
		}
	}

	var inputs map[string]interface{}
	if raw, ok := resolved["inputs"].(map[string]any); ok {
		inputs = raw
	}

	if _, err := runner.Run(prompty.RunTurnRequest{
		SessionId: strOr(resolved["sessionId"], ""),
		TurnId:    strOr(resolved["turnId"], ""),
		Inputs:    inputs,
		Options:   &prompty.TurnOptions{MaxIterations: maxIterations},
	}); err != nil {
		return nil, err
	}

	records, err := replayReadRecords(journalPath)
	if err != nil {
		return nil, err
	}
	return replayNormalizeJournal(records), nil
}
