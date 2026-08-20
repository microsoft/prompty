package prompty

import (
	"encoding/json"
	"sync"
	"unicode"
	"unicode/utf8"

	_ "embed"
)

//go:embed model_capabilities.json
var modelCapabilitiesJSON []byte

type modelCapabilityDataset struct {
	Providers map[string][]modelCapabilityEntry `json:"providers"`
}

type modelCapabilityEntry struct {
	Prefix           string   `json:"prefix"`
	ContextWindow    *int32   `json:"contextWindow"`
	InputModalities  []string `json:"inputModalities"`
	OutputModalities []string `json:"outputModalities"`
}

var (
	modelCapabilitiesOnce sync.Once
	modelCapabilitiesData modelCapabilityDataset
	modelCapabilitiesErr  error
)

func loadModelCapabilities() (modelCapabilityDataset, error) {
	modelCapabilitiesOnce.Do(func() {
		modelCapabilitiesErr = json.Unmarshal(modelCapabilitiesJSON, &modelCapabilitiesData)
	})
	return modelCapabilitiesData, modelCapabilitiesErr
}

func matchCapabilities(modelID string, provider string) *modelCapabilityEntry {
	dataset, err := loadModelCapabilities()
	if err != nil {
		return nil
	}

	entries := dataset.Providers[provider]
	var best *modelCapabilityEntry
	bestLen := -1
	for i := range entries {
		entry := &entries[i]
		if !hasTokenBoundaryPrefix(modelID, entry.Prefix) {
			continue
		}
		if len(entry.Prefix) > bestLen {
			best = entry
			bestLen = len(entry.Prefix)
		}
	}
	return best
}

func hasTokenBoundaryPrefix(modelID string, prefix string) bool {
	if modelID == prefix {
		return true
	}
	if len(prefix) == 0 || len(modelID) <= len(prefix) || modelID[:len(prefix)] != prefix {
		return false
	}
	next, _ := utf8.DecodeRuneInString(modelID[len(prefix):])
	return !(unicode.IsLetter(next) || unicode.IsDigit(next))
}

// Enrich fills only missing ModelInfo capability fields from the shared discovery dataset.
func Enrich(base *ModelInfo, provider string) *ModelInfo {
	if base == nil {
		base = &ModelInfo{}
	}

	entry := matchCapabilities(base.Id, provider)
	if entry == nil {
		return base
	}

	if base.ContextWindow == nil && entry.ContextWindow != nil {
		value := *entry.ContextWindow
		base.ContextWindow = &value
	}
	if base.InputModalities == nil && entry.InputModalities != nil {
		// Use make+copy (not append to a nil slice) so a present-but-empty
		// dataset modality [] is preserved as a non-nil empty slice rather than
		// collapsing back to nil — append(nil) with zero elements returns nil.
		base.InputModalities = make([]string, len(entry.InputModalities))
		copy(base.InputModalities, entry.InputModalities)
	}
	if base.OutputModalities == nil && entry.OutputModalities != nil {
		base.OutputModalities = make([]string, len(entry.OutputModalities))
		copy(base.OutputModalities, entry.OutputModalities)
	}
	return base
}

// MapModel maps provider-native model payloads to canonical ModelInfo.
func MapModel(raw interface{}, provider string) *ModelInfo {
	data, _ := raw.(map[string]interface{})
	info := &ModelInfo{AdditionalProperties: data}

	switch provider {
	case "anthropic":
		info.Id = stringValue(data["id"])
		info.DisplayName = stringPointer(data["display_name"])
		ownedBy := "anthropic"
		info.OwnedBy = &ownedBy
		info.ContextWindow = int32Pointer(data["context_length"])
		info.InputModalities = stringSliceValue(data["input_modalities"])
		info.OutputModalities = stringSliceValue(data["output_modalities"])
	case "foundry":
		mapFoundryModel(info, data)
	default:
		info.Id = stringValue(data["id"])
		info.OwnedBy = stringPointer(data["owned_by"])
	}

	return info
}

func mapFoundryModel(info *ModelInfo, data map[string]interface{}) {
	if props, ok := data["properties"].(map[string]interface{}); ok {
		model, _ := props["model"].(map[string]interface{})
		caps, _ := props["capabilities"].(map[string]interface{})

		info.Id = stringValue(data["name"])
		info.DisplayName = stringPointer(model["name"])
		info.OwnedBy = stringPointer(model["publisher"])
		info.ContextWindow = int32Pointer(model["maxContextLength"])
		info.InputModalities = stringSliceValue(caps["supportedInputModalities"])
		info.OutputModalities = stringSliceValue(caps["supportedOutputModalities"])
		return
	}

	if _, ok := data["modelName"]; ok || stringValue(data["type"]) == "ModelDeployment" {
		info.Id = stringValue(data["name"])
		info.DisplayName = stringPointer(data["modelName"])
		info.OwnedBy = stringPointer(data["modelPublisher"])
		info.ContextWindow = int32Pointer(data["maxContextLength"])
		return
	}

	info.Id = stringValue(data["id"])
	info.OwnedBy = stringPointer(data["owned_by"])
	info.ContextWindow = int32Pointer(data["maxContextLength"])
}

func stringValue(value interface{}) string {
	if s, ok := value.(string); ok {
		return s
	}
	return ""
}

func stringPointer(value interface{}) *string {
	if s, ok := value.(string); ok {
		return &s
	}
	return nil
}

func int32Pointer(value interface{}) *int32 {
	switch n := value.(type) {
	case int:
		v := int32(n)
		return &v
	case int32:
		v := n
		return &v
	case int64:
		v := int32(n)
		return &v
	case float64:
		v := int32(n)
		return &v
	default:
		return nil
	}
}

func stringSliceValue(value interface{}) []string {
	switch arr := value.(type) {
	case []string:
		return append([]string(nil), arr...)
	case []interface{}:
		result := make([]string, len(arr))
		for i, item := range arr {
			result[i] = stringValue(item)
		}
		return result
	default:
		return nil
	}
}
