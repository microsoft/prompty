package prompty

// Provider-agnostic streaming-failure classification and reconciliation -- the
// canonical Processor.processStream engine. This file classifies a raw provider
// stream into canonical StreamChunk items and reconciles them into the
// streaming-failure contract asserted by the Processor.processStream vectors
// (schema/model/conformance/vectors/stream.tsp), mirroring the Python reference
// in prompty/providers/openai/processor.py and prompty/core/streaming.py.

import "fmt"

// StreamChunkValue is a classified stream chunk (a TextChunk or FailureChunk)
// that serializes to the canonical processStream wire shape.
type StreamChunkValue interface {
	Save(ctx *SaveContext) map[string]interface{}
}

// StreamReconciliationOutcome is the outcome of reconciling a classified
// stream-chunk sequence.
type StreamReconciliationOutcome struct {
	PartialText            string
	RequiresReconciliation bool
	CompletionCommitted    bool
}

// Save serializes the outcome to the canonical processStream wire shape.
func (o StreamReconciliationOutcome) Save() map[string]interface{} {
	return map[string]interface{}{
		"partialText":            o.PartialText,
		"requiresReconciliation": o.RequiresReconciliation,
		"completionCommitted":    o.CompletionCommitted,
	}
}

// ClassifyStreamEvents classifies raw OpenAI stream events into canonical
// StreamChunk items. Each event is either a provider SSE payload
// ({kind:"provider", value:{...}}) or a transport failure
// ({kind:"transportError", message:"..."}). A content delta becomes a
// TextChunk; a refusal delta becomes a determinate FailureChunk; a transport
// error becomes an indeterminate FailureChunk that requires reconciliation.
func ClassifyStreamEvents(events []interface{}) ([]StreamChunkValue, error) {
	chunks := []StreamChunkValue{}
	for _, raw := range events {
		event, _ := raw.(map[string]interface{})
		kind, _ := event["kind"].(string)
		switch kind {
		case "provider":
			value, _ := event["value"].(map[string]interface{})
			choices, _ := value["choices"].([]interface{})
			if len(choices) == 0 {
				continue
			}
			first, _ := choices[0].(map[string]interface{})
			delta, _ := first["delta"].(map[string]interface{})
			if content, ok := delta["content"]; ok && content != nil {
				chunks = append(chunks, TextChunk{Kind: "text", Value: interfaceToString(content)})
			}
			if refusal, ok := delta["refusal"]; ok && refusal != nil {
				chunks = append(chunks, FailureChunk{
					Kind: "failure",
					Failure: StreamFailure{
						Outcome: StreamFailureOutcomeDeterminate,
						Message: "Model refused: " + interfaceToString(refusal),
					},
				})
			}
		case "transportError":
			message, _ := event["message"].(string)
			chunks = append(chunks, FailureChunk{
				Kind: "failure",
				Failure: StreamFailure{
					Outcome: StreamFailureOutcomeIndeterminate,
					Message: message,
				},
			})
		default:
			return nil, fmt.Errorf("unsupported stream event kind: %q", kind)
		}
	}
	return chunks, nil
}

// ReconcileStream reconciles classified stream chunks into a
// StreamReconciliationOutcome. Partial text is the concatenation of every text
// chunk; a stream requires reconciliation when any terminal failure is
// indeterminate; a completion is committed only when the stream terminates with
// no failure at all.
func ReconcileStream(chunks []StreamChunkValue) StreamReconciliationOutcome {
	partialText := ""
	requiresReconciliation := false
	failureCount := 0
	for _, chunk := range chunks {
		switch typed := chunk.(type) {
		case TextChunk:
			partialText += typed.Value
		case FailureChunk:
			failureCount++
			if typed.Failure.Outcome == StreamFailureOutcomeIndeterminate {
				requiresReconciliation = true
			}
		}
	}
	return StreamReconciliationOutcome{
		PartialText:            partialText,
		RequiresReconciliation: requiresReconciliation,
		CompletionCommitted:    failureCount == 0,
	}
}
