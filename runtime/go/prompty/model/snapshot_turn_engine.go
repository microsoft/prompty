package prompty

// Provider-agnostic single-turn engine -- the canonical TurnConformance.runTurn
// engine. This file owns the snapshot and portability turn contract asserted by
// schema/model/conformance/vectors/turn.tsp (stage "turn"), mirroring the Python
// reference in prompty/core/turn_engine.py.
//
// Where the agent loop models the conversational agent loop (message accounting,
// guardrails, steering), this engine models the durable turn: per-iteration
// snapshots, a stable-prefix marker, portability transitions (portable vs
// delegated provider state), and a fixed lifecycle event vocabulary. A turn is
// one or more model iterations; each iteration takes a snapshot after the model
// responds, runs any requested tools (through a permission gate), commits their
// results back into the conversation, and loops until the model returns a final
// output.
//
// Observable contract (verified against all 5 runTurn vectors):
//   - Iterations -- number of model invocations.
//   - Snapshots -- one per model iteration. SnapshotStablePrefixes[i] is the
//     length of the stable message prefix at snapshot i; SnapshotPortability[i]
//     is the provider-state portability entering iteration i (portable until a
//     model turn declares nextPortability "delegated", which applies to the
//     following snapshot).
//   - CommitPortability / DelegatedStateCount -- the portability and delegated
//     provider-state carried at commit time.
//   - ToolResults / ToolResultOrder -- count and ordered tool-call ids of every
//     tool round (denied tools still produce a model-visible result).
//   - Events -- the exact lifecycle event order documented on RunSnapshotTurn.

// SnapshotDefaultMaxIterations is the turn engine's default iteration ceiling.
const SnapshotDefaultMaxIterations = 10

// Portability transition values.
const (
	SnapshotPortabilityPortable  = "portable"
	SnapshotPortabilityDelegated = "delegated"
)

// SnapshotTurnToolCall is a tool invocation requested by the model.
type SnapshotTurnToolCall struct {
	Id        string
	Name      string
	Arguments map[string]interface{}
}

// SnapshotModelTurn is a normalized single model turn. Output is set for a final
// answer; ToolCalls for a tool round. NextPortability / DelegatedState declare
// the provider-state portability transition that applies to the next snapshot.
type SnapshotModelTurn struct {
	Output          interface{}
	ToolCalls       []SnapshotTurnToolCall
	NextPortability interface{}
	DelegatedState  []interface{}
}

// SnapshotTurnToolResult is the outcome of one tool invocation within a turn.
type SnapshotTurnToolResult struct {
	Id      string
	Result  interface{}
	Success bool
}

// SnapshotTurnOptions bundles the abstract callbacks and scripted flags for one
// turn.
type SnapshotTurnOptions struct {
	InvokeModel       func(iteration int, toolResults []SnapshotTurnToolResult) SnapshotModelTurn
	ResolvePermission func(call SnapshotTurnToolCall) bool
	ExecuteTool       func(call SnapshotTurnToolCall) interface{}
	CancelBeforeRun   bool
	MaxIterations     int
}

// SnapshotTurnResult is the observable result of a single turn.
type SnapshotTurnResult struct {
	Status                 string
	Output                 interface{}
	Iterations             int
	Snapshots              int
	SnapshotStablePrefixes []int
	SnapshotPortability    []string
	CommitPortability      string
	DelegatedStateCount    int
	ToolResults            []SnapshotTurnToolResult
	ToolResultOrder        []string
	Events                 []string
}

// RunSnapshotTurn runs one turn and returns its snapshot/portability observable
// result.
//
// Event order: turn_started -> per iteration (context_prepared ->
// model_invocation_started -> model_invocation_completed -> checkpoint_created;
// then per tool permission_requested -> permission_resolved ->
// tool_execution_started -> tool_execution_completed -> checkpoint_created; then
// tool_result_committed x n -> conversation_updated -> checkpoint_created) -> on
// final answer turn_committed -> post_commit_started -> post_commit_completed. A
// pre-run cancellation emits only turn_started -> turn_cancelled.
func RunSnapshotTurn(messages []interface{}, opts SnapshotTurnOptions) SnapshotTurnResult {
	maxIterations := opts.MaxIterations
	if maxIterations <= 0 {
		maxIterations = SnapshotDefaultMaxIterations
	}

	result := SnapshotTurnResult{
		Status:                 "success",
		CommitPortability:      SnapshotPortabilityPortable,
		SnapshotStablePrefixes: []int{},
		SnapshotPortability:    []string{},
		ToolResults:            []SnapshotTurnToolResult{},
		ToolResultOrder:        []string{},
		Events:                 []string{},
	}

	emit := func(kind string) {
		result.Events = append(result.Events, kind)
	}

	emit("turn_started")

	if opts.CancelBeforeRun {
		emit("turn_cancelled")
		result.Status = "cancelled"
		result.Output = nil
		return result
	}

	stablePrefix := len(messages)
	pendingPortability := SnapshotPortabilityPortable
	var delegatedState []interface{}
	pendingToolResults := []SnapshotTurnToolResult{}

	approve := opts.ResolvePermission
	if approve == nil {
		approve = func(SnapshotTurnToolCall) bool { return true }
	}
	dispatch := opts.ExecuteTool
	if dispatch == nil {
		dispatch = func(SnapshotTurnToolCall) interface{} { return nil }
	}

	for iteration := 0; iteration < maxIterations; iteration++ {
		result.Iterations = iteration + 1

		emit("context_prepared")
		emit("model_invocation_started")
		turn := opts.InvokeModel(iteration, pendingToolResults)
		emit("model_invocation_completed")

		result.SnapshotPortability = append(result.SnapshotPortability, pendingPortability)
		result.SnapshotStablePrefixes = append(result.SnapshotStablePrefixes, stablePrefix)
		result.Snapshots++
		emit("checkpoint_created")

		if turn.NextPortability == SnapshotPortabilityDelegated {
			pendingPortability = SnapshotPortabilityDelegated
			if turn.DelegatedState != nil {
				delegatedState = turn.DelegatedState
			} else {
				delegatedState = []interface{}{}
			}
		}

		if len(turn.ToolCalls) == 0 {
			result.Output = turn.Output
			result.CommitPortability = pendingPortability
			result.DelegatedStateCount = len(delegatedState)
			emit("turn_committed")
			emit("post_commit_started")
			emit("post_commit_completed")
			return result
		}

		pendingToolResults = []SnapshotTurnToolResult{}
		for _, call := range turn.ToolCalls {
			emit("permission_requested")
			approved := approve(call)
			emit("permission_resolved")
			var toolResult SnapshotTurnToolResult
			if approved {
				emit("tool_execution_started")
				output := dispatch(call)
				emit("tool_execution_completed")
				toolResult = SnapshotTurnToolResult{Id: call.Id, Result: output, Success: true}
			} else {
				toolResult = SnapshotTurnToolResult{
					Id:      call.Id,
					Result:  map[string]interface{}{"message": "Permission denied", "error_kind": "permission_denied"},
					Success: false,
				}
			}
			emit("checkpoint_created")
			result.ToolResults = append(result.ToolResults, toolResult)
			result.ToolResultOrder = append(result.ToolResultOrder, call.Id)
			pendingToolResults = append(pendingToolResults, toolResult)
		}

		for range turn.ToolCalls {
			emit("tool_result_committed")
		}
		emit("conversation_updated")
		emit("checkpoint_created")
	}

	result.Status = "error"
	result.CommitPortability = pendingPortability
	result.DelegatedStateCount = len(delegatedState)
	return result
}
