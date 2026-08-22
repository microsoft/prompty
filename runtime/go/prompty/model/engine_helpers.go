package prompty

// Small shared helpers for the provider-agnostic conformance engines
// (agent loop, snapshot turn, stream reconciliation). Kept unexported and
// dependency-light so they never leak into the public model surface.

import (
	"fmt"
	"strconv"
)

func itoa(value int) string {
	return strconv.Itoa(value)
}

func interfaceToString(value interface{}) string {
	if value == nil {
		return ""
	}
	if s, ok := value.(string); ok {
		return s
	}
	return fmt.Sprintf("%v", value)
}

func agentBeforeIterationKey(iteration int) string {
	return "before_iteration_" + strconv.Itoa(iteration)
}

func agentAfterToolKey(index int) string {
	return "after_tool_" + strconv.Itoa(index)
}
