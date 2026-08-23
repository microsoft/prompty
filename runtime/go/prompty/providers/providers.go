// Package providers implements HTTP-based Executor/Processor pairs for the
// built-in LLM providers (openai, anthropic, foundry) and a small registry that
// resolves them by provider key.
//
// Each provider builds a provider-specific request body via the shared
// model.BuildWireRequest pipeline, performs a raw net/http POST, and normalizes
// the response via model.ProcessResponse. This mirrors the C# / Rust reference
// provider packages (Prompty.OpenAI, prompty-openai, ...) while following Go
// conventions: a single module, explicit Register functions, and no init-time
// side effects. Import the desired sub-package and call its Register function to
// wire the executor/processor into the registry:
//
//	import "prompty/providers/openai"
//	openai.Register()
//	exec, _ := providers.GetExecutor("openai")
package providers

import (
	"sync"

	prompty "prompty/model"
)

var (
	registryMu sync.RWMutex
	executors  = map[string]prompty.Executor{}
	processors = map[string]prompty.Processor{}
)

// RegisterExecutor registers an Executor under a provider key (e.g. "openai").
// A later registration for the same key replaces the earlier one.
func RegisterExecutor(key string, executor prompty.Executor) {
	registryMu.Lock()
	defer registryMu.Unlock()
	executors[key] = executor
}

// RegisterProcessor registers a Processor under a provider key (e.g. "openai").
// A later registration for the same key replaces the earlier one.
func RegisterProcessor(key string, processor prompty.Processor) {
	registryMu.Lock()
	defer registryMu.Unlock()
	processors[key] = processor
}

// GetExecutor returns the Executor registered under key, or ok=false when no
// executor is registered for that provider.
func GetExecutor(key string) (prompty.Executor, bool) {
	registryMu.RLock()
	defer registryMu.RUnlock()
	e, ok := executors[key]
	return e, ok
}

// GetProcessor returns the Processor registered under key, or ok=false when no
// processor is registered for that provider.
func GetProcessor(key string) (prompty.Processor, bool) {
	registryMu.RLock()
	defer registryMu.RUnlock()
	p, ok := processors[key]
	return p, ok
}
