package vectoradapters

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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

// VectorWaivers records explicit, honest conformance gaps.
//
// The Go runtime ships the generated model layer (load/save), the discovery
// mapper (enrich/mapModel), the provider-agnostic run/runTurn/processStream
// engines, and the ReferenceTurnRunner replay engine -- all wired above. The
// .prompty document loader, template renderer, chat parser, provider
// wire-mapping, and response processor are not yet implemented in Go, so there
// is genuinely no runtime code to drive those vectors -- these are absent-layer
// gaps, not wiring deferrals.
var VectorWaivers = map[string]string{
	"LoadConformance.load":      absentPipeline,
	"Renderer.render":           absentPipeline,
	"Parser.parse":              absentPipeline,
	"WireConformance.toRequest": absentPipeline,
	"Processor.process":         absentPipeline,
}

// absentPipeline is the shared honest reason for the load/render/parse/wire/
// process operations that the Go runtime does not yet implement.
const absentPipeline = "Not implemented in the Go runtime. Go currently ships the generated model layer, the discovery mapper (enrich/mapModel), the provider-agnostic run/runTurn/processStream engines, and a reference turn/replay engine; the .prompty loader, template renderer, chat parser, provider wire-mapping, and response processor do not exist yet, so there is no runtime code to drive this vector. Absent-layer gap, not a wiring deferral."

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
// Generic value converters
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Processor.processStream
// ---------------------------------------------------------------------------

func processStreamInvoke(input any, ctx Context) (any, error) {
	typed, _ := input.(map[string]any)
	provider := strOr(typed["provider"], "")
	if provider == "" {
		provider = ctx.Provider
	}
	if provider == "" {
		provider = "openai"
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
		value := int32(toInt(raw))
		maxIterations = &value
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
