package prompty

// Provider-agnostic agent loop -- the canonical TurnConformance.run engine.
//
// This file owns the observable agent-loop contract that the cross-runtime
// @vector suite (schema/model/conformance/vectors/agent.tsp, stage "agent")
// asserts. It is deliberately provider-agnostic: the loop is driven by two
// abstract callbacks -- InvokeModel(conversation) -> AgentModelResponse (one LLM
// call) and DispatchTool(call) -> string (one tool execution) -- so the same
// engine backs every provider. Providers supply only the wire translation that
// turns their raw response into an AgentModelResponse; they never re-implement
// the loop, its accounting, or its event vocabulary. This mirrors the Python
// reference in prompty/core/agent_loop.py so every runtime shares one contract.
//
// Observable contract (verified against all 28 run vectors):
//   - Iterations counts LLM calls (not tool rounds).
//   - TotalMessages == len(conversation) + (1 if any tool round ran else 0).
//   - messages_updated.message_count == len(conversation) + 1 at emit time.
//   - Events are emitted in a fixed order: status -> tool_call_start ->
//     tool_result -> messages_updated -> optional steering status/
//     messages_updated -> done; cancelled replaces the tail on cancellation.
//   - Canonical message shapes: assistant-with-tool-calls
//     {role:"assistant", content:"", metadata:{tool_calls:[...]}}; tool result
//     {role:"tool", content:<str>, metadata:{tool_call_id:<id>}}; final answer
//     {role:"assistant", content:<str>}.
//
// Errors are returned as fields on AgentLoopResult (Error/ErrorType/ErrorReason)
// rather than raised, so the accumulated conversation and events remain
// observable on the failure path.

import (
	"encoding/json"
	"strings"
)

// AgentDefaultMaxIterations is the loop's default iteration ceiling.
const AgentDefaultMaxIterations = 10

// AgentSummaryPrefix marks a compaction summary system message.
const AgentSummaryPrefix = "[Summary of earlier conversation] "

// Canonical error markers. The vectors assert the class name for cancellation
// and guardrail denials, so these mirror the exception types used by the other
// runtimes without coupling the loop to them.
const (
	agentCancelledError = "CancelledError"
	agentGuardrailError = "GuardrailError"
)

// AgentToolCall is a single tool invocation requested by the model.
type AgentToolCall struct {
	Id   string
	Name string
	// Arguments is the raw JSON string exactly as the model emitted it.
	Arguments string
}

// AgentModelResponse is a normalized single-turn model response.
//
// RawToolCalls carries the provider's exact tool-call array so the assistant
// message's metadata.tool_calls round-trips byte-for-byte; when nil the engine
// reconstructs it from AgentToolCall fields.
type AgentModelResponse struct {
	Content      interface{}
	ToolCalls    []AgentToolCall
	RawToolCalls []interface{}
}

// AgentGuardrailDecision is the outcome of a guardrail check.
type AgentGuardrailDecision struct {
	Allowed bool
	Reason  interface{}
}

// AgentSteeringMessage is a steering message scheduled for injection before a
// given iteration.
type AgentSteeringMessage struct {
	InjectBeforeIteration int
	Role                  string
	Text                  string
}

// AgentLoopOptions bundles the abstract callbacks and scripted flags that drive
// one agent-loop run.
type AgentLoopOptions struct {
	InvokeModel      func(conversation []map[string]interface{}) AgentModelResponse
	DispatchTool     func(call AgentToolCall) string
	IsToolRegistered func(name string) bool
	MaxIterations    int
	InputGuardrail   func(conversation []map[string]interface{}) AgentGuardrailDecision
	OutputGuardrail  func(response AgentModelResponse) AgentGuardrailDecision
	ToolGuardrail    func(name string, arguments map[string]interface{}) AgentGuardrailDecision
	Steering         []AgentSteeringMessage
	CancelAt         string
	ContextBudget    *int
	Summarize        func(dropped []map[string]interface{}) string
}

// AgentLoopResult is the observable result of an agent-loop run.
type AgentLoopResult struct {
	Result             interface{}
	Iterations         int
	Conversation       []map[string]interface{}
	Events             []map[string]interface{}
	ToolRounds         int
	ToolsExecuted      int
	ToolExecutionOrder []string
	DeniedTools        []string
	TrimmedMessages    []map[string]interface{}
	Error              interface{}
	ErrorType          interface{}
	ErrorReason        interface{}
}

// TotalMessages is the conversation length plus the conformance +1 when tools
// ran.
func (r AgentLoopResult) TotalMessages() int {
	total := len(r.Conversation)
	if r.ToolRounds > 0 {
		total++
	}
	return total
}

func agentCopyMessage(message map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(message))
	for key, value := range message {
		out[key] = value
	}
	return out
}

func agentAssistantToolCallsMessage(response AgentModelResponse) map[string]interface{} {
	var toolCalls []interface{}
	if response.RawToolCalls != nil {
		toolCalls = response.RawToolCalls
	} else {
		toolCalls = make([]interface{}, 0, len(response.ToolCalls))
		for _, call := range response.ToolCalls {
			toolCalls = append(toolCalls, map[string]interface{}{
				"id":   call.Id,
				"type": "function",
				"function": map[string]interface{}{
					"name":      call.Name,
					"arguments": call.Arguments,
				},
			})
		}
	}
	return map[string]interface{}{
		"role":     "assistant",
		"content":  "",
		"metadata": map[string]interface{}{"tool_calls": toolCalls},
	}
}

func agentToolMessage(callId string, content string) map[string]interface{} {
	return map[string]interface{}{
		"role":     "tool",
		"content":  content,
		"metadata": map[string]interface{}{"tool_call_id": callId},
	}
}

func agentCharCount(messages []map[string]interface{}) int {
	total := 0
	for _, message := range messages {
		if content, ok := message["content"].(string); ok {
			total += len(content)
		}
	}
	return total
}

func agentParseArgs(arguments string) map[string]interface{} {
	if arguments == "" {
		return map[string]interface{}{}
	}
	var parsed interface{}
	if err := json.Unmarshal([]byte(arguments), &parsed); err != nil {
		return map[string]interface{}{}
	}
	if asMap, ok := parsed.(map[string]interface{}); ok {
		return asMap
	}
	return map[string]interface{}{}
}

func agentDefaultSummary(droppedUsers []map[string]interface{}) string {
	topics := make([]string, 0, len(droppedUsers))
	for _, message := range droppedUsers {
		if content, ok := message["content"].(string); ok {
			trimmed := strings.TrimSpace(content)
			if trimmed != "" {
				topics = append(topics, trimmed)
			}
		}
	}
	return AgentSummaryPrefix + "User asked about " + strings.Join(topics, "; ")
}

func agentMaybeTrim(
	conversation []map[string]interface{},
	contextBudget *int,
	summarize func(dropped []map[string]interface{}) string,
) []map[string]interface{} {
	if contextBudget == nil || agentCharCount(conversation) <= *contextBudget {
		return nil
	}

	var systems []map[string]interface{}
	var users []map[string]interface{}
	for _, message := range conversation {
		switch message["role"] {
		case "system":
			systems = append(systems, agentCopyMessage(message))
		case "user":
			users = append(users, message)
		}
	}

	var droppedUsers []map[string]interface{}
	var lastUser map[string]interface{}
	if len(users) > 0 {
		droppedUsers = users[:len(users)-1]
		lastUser = users[len(users)-1]
	}

	var summaryText string
	if summarize != nil {
		summaryText = summarize(droppedUsers)
	} else {
		summaryText = agentDefaultSummary(droppedUsers)
	}

	trimmed := make([]map[string]interface{}, 0, len(systems)+2)
	trimmed = append(trimmed, systems...)
	trimmed = append(trimmed, map[string]interface{}{"role": "system", "content": summaryText})
	if lastUser != nil {
		trimmed = append(trimmed, map[string]interface{}{"role": "user", "content": lastUser["content"]})
	}
	return trimmed
}

// RunAgentLoop runs the canonical agent loop and returns its observable result.
//
// CancelAt accepts the scripted positions "before_iteration" (before iteration
// 1), "before_iteration_<n>" (before iteration n), and "after_tool_<i>" (after
// the i-th tool of a round). The loop is deterministic: given the same
// callbacks and flags it always produces the same events and accounting.
func RunAgentLoop(messages []map[string]interface{}, opts AgentLoopOptions) AgentLoopResult {
	maxIterations := opts.MaxIterations
	if maxIterations <= 0 {
		maxIterations = AgentDefaultMaxIterations
	}

	result := AgentLoopResult{
		ToolExecutionOrder: []string{},
		DeniedTools:        []string{},
	}

	conversation := make([]map[string]interface{}, 0, len(messages))
	for _, message := range messages {
		conversation = append(conversation, agentCopyMessage(message))
	}

	emit := func(eventType string, data map[string]interface{}) {
		result.Events = append(result.Events, map[string]interface{}{"type": eventType, "data": data})
	}

	emit("status", map[string]interface{}{"message": "Starting agent loop"})

	if trimmed := agentMaybeTrim(conversation, opts.ContextBudget, opts.Summarize); trimmed != nil {
		conversation = trimmed
		result.TrimmedMessages = make([]map[string]interface{}, 0, len(trimmed))
		for _, message := range trimmed {
			result.TrimmedMessages = append(result.TrimmedMessages, agentCopyMessage(message))
		}
	}

	steeringPending := make([]AgentSteeringMessage, len(opts.Steering))
	copy(steeringPending, opts.Steering)

	registered := opts.IsToolRegistered
	if registered == nil {
		registered = func(string) bool { return true }
	}

	for {
		iterationNumber := result.Iterations + 1

		if opts.CancelAt == "before_iteration" && iterationNumber == 1 {
			emit("cancelled", map[string]interface{}{"reason": "Cancellation requested before first iteration"})
			result.Error = agentCancelledError
			result.Conversation = conversation
			return result
		}
		if opts.CancelAt == agentBeforeIterationKey(iterationNumber) {
			emit("cancelled", map[string]interface{}{
				"reason": "Cancellation requested before iteration " + itoa(iterationNumber),
			})
			result.Error = agentCancelledError
			result.Conversation = conversation
			return result
		}

		var toInject []AgentSteeringMessage
		var remaining []AgentSteeringMessage
		for _, steer := range steeringPending {
			if steer.InjectBeforeIteration == iterationNumber {
				toInject = append(toInject, steer)
			} else {
				remaining = append(remaining, steer)
			}
		}
		if len(toInject) > 0 {
			steeringPending = remaining
			emit("status", map[string]interface{}{"message": "Injecting steering message"})
			for _, steer := range toInject {
				conversation = append(conversation, map[string]interface{}{"role": steer.Role, "content": steer.Text})
			}
			emit("messages_updated", map[string]interface{}{"message_count": len(conversation) + 1})
		}

		if opts.InputGuardrail != nil {
			decision := opts.InputGuardrail(conversation)
			if !decision.Allowed {
				result.Error = agentGuardrailError
				result.ErrorReason = decision.Reason
				result.Conversation = conversation
				return result
			}
		}

		response := opts.InvokeModel(conversation)
		result.Iterations++

		if opts.OutputGuardrail != nil {
			decision := opts.OutputGuardrail(response)
			if !decision.Allowed {
				result.Error = agentGuardrailError
				result.ErrorReason = decision.Reason
				result.Conversation = conversation
				return result
			}
		}

		if len(response.ToolCalls) > 0 {
			conversation = append(conversation, agentAssistantToolCallsMessage(response))
			result.ToolRounds++
			cancelled := false

			for idx, call := range response.ToolCalls {
				emit("tool_call_start", map[string]interface{}{"name": call.Name, "arguments": call.Arguments})

				if opts.ToolGuardrail != nil {
					decision := opts.ToolGuardrail(call.Name, agentParseArgs(call.Arguments))
					if !decision.Allowed {
						result.DeniedTools = append(result.DeniedTools, call.Name)
						denial := "Tool denied by guardrail: " + interfaceToString(decision.Reason)
						conversation = append(conversation, agentToolMessage(call.Id, denial))
						continue
					}
				}

				if !registered(call.Name) {
					result.Error = "Tool not registered: " + call.Name
					result.ErrorType = "ValueError"
					result.Conversation = conversation
					return result
				}

				output := opts.DispatchTool(call)
				result.ToolsExecuted++
				result.ToolExecutionOrder = append(result.ToolExecutionOrder, call.Name)
				emit("tool_result", map[string]interface{}{"name": call.Name, "result": output})
				conversation = append(conversation, agentToolMessage(call.Id, output))

				if opts.CancelAt == agentAfterToolKey(idx) {
					emit("cancelled", map[string]interface{}{"reason": "Cancellation requested after tool execution"})
					result.Error = agentCancelledError
					cancelled = true
					break
				}
			}

			if cancelled {
				result.Conversation = conversation
				return result
			}

			emit("messages_updated", map[string]interface{}{"message_count": len(conversation) + 1})

			if result.Iterations > maxIterations {
				result.Error = "Agent loop exceeded " + itoa(maxIterations) + " iterations"
				result.Conversation = conversation
				return result
			}

			continue
		}

		result.Result = response.Content
		conversation = append(conversation, map[string]interface{}{"role": "assistant", "content": response.Content})
		emit("done", map[string]interface{}{"response": response.Content})
		result.Conversation = conversation
		return result
	}
}
