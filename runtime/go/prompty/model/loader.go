package prompty

// Real .prompty load pipeline: split frontmatter/body, resolve ${env:}/${file:}
// references, reject invalid templates, and drive the generated Agent loader.
// This is the runtime layer the LoadConformance.load vectors exercise.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// frontmatterRe splits `---`/`+++` delimited frontmatter from the markdown body.
// Group 1 is the YAML frontmatter, group 2 is the body (stored as instructions).
var frontmatterRe = regexp.MustCompile(`(?s)^\s*(?:---|\+\+\+)(.*?)(?:---|\+\+\+)\s*(.+)$`)

// LoadError classifies a load failure so the conformance layer (and callers)
// can map it onto the expected error contract.
type LoadError struct {
	Kind    string // env | file_missing | file_traversal | template | frontmatter | not_found | required_input
	Field   string
	Message string
}

func (e *LoadError) Error() string { return e.Message }

// ParseFrontmatter splits .prompty content into a frontmatter dict plus body,
// storing the markdown body under the "instructions" key. Content with no
// delimiter is parsed as a bare YAML mapping.
func ParseFrontmatter(contents string) (map[string]interface{}, error) {
	contents = strings.ReplaceAll(contents, "\r\n", "\n")
	trimmed := strings.TrimLeft(contents, " \t\r\n")
	if strings.HasPrefix(trimmed, "---") || strings.HasPrefix(trimmed, "+++") {
		if m := frontmatterRe.FindStringSubmatch(contents); m != nil {
			data, err := deserializeYAML(m[1])
			if err != nil {
				return nil, &LoadError{Kind: "frontmatter", Message: "invalid frontmatter: " + err.Error()}
			}
			data["instructions"] = m[2]
			return data, nil
		}
	}
	return deserializeYAML(contents)
}

func deserializeYAML(text string) (map[string]interface{}, error) {
	if strings.TrimSpace(text) == "" {
		return map[string]interface{}{}, nil
	}
	var out map[string]interface{}
	if err := yaml.Unmarshal([]byte(text), &out); err != nil {
		return nil, &LoadError{Kind: "frontmatter", Message: "invalid frontmatter: " + err.Error()}
	}
	if out == nil {
		out = map[string]interface{}{}
	}
	return out, nil
}

// ResolveReferences walks a frontmatter dict in place, replacing ${env:VAR},
// ${env:VAR:default}, and ${file:path} string values with their resolved value.
// File references may resolve to a nested object (JSON/YAML) or raw text.
func ResolveReferences(data map[string]interface{}, parentDir string, allowedRoots []string) error {
	for key, value := range data {
		switch typed := value.(type) {
		case string:
			resolved, changed, err := resolveRef(typed, key, parentDir, allowedRoots)
			if err != nil {
				return err
			}
			if changed {
				data[key] = resolved
				if nested, ok := resolved.(map[string]interface{}); ok {
					if err := ResolveReferences(nested, parentDir, allowedRoots); err != nil {
						return err
					}
				}
			}
		case map[string]interface{}:
			if err := ResolveReferences(typed, parentDir, allowedRoots); err != nil {
				return err
			}
		case []interface{}:
			for _, item := range typed {
				if nested, ok := item.(map[string]interface{}); ok {
					if err := ResolveReferences(nested, parentDir, allowedRoots); err != nil {
						return err
					}
				}
			}
		}
	}
	return nil
}

func resolveRef(str, key, parentDir string, allowedRoots []string) (interface{}, bool, error) {
	if !strings.HasPrefix(str, "${") || !strings.HasSuffix(str, "}") {
		return nil, false, nil
	}
	inner := str[2 : len(str)-1]
	idx := strings.Index(inner, ":")
	if idx < 0 {
		return nil, false, nil
	}
	protocol := strings.ToLower(inner[:idx])
	remainder := inner[idx+1:]
	switch protocol {
	case "env":
		val, err := resolveEnv(remainder)
		if err != nil {
			return nil, false, err
		}
		return val, true, nil
	case "file":
		val, err := resolveFile(remainder, parentDir, allowedRoots)
		if err != nil {
			return nil, false, err
		}
		return val, true, nil
	default:
		// Unknown protocol: leave the value unchanged.
		return nil, false, nil
	}
}

func resolveEnv(remainder string) (interface{}, error) {
	varName := remainder
	var def *string
	if idx := strings.Index(remainder, ":"); idx >= 0 {
		varName = remainder[:idx]
		d := remainder[idx+1:]
		def = &d
	}
	if val, ok := os.LookupEnv(varName); ok {
		return val, nil
	}
	if def != nil {
		return *def, nil
	}
	return nil, &LoadError{Kind: "env", Message: fmt.Sprintf("Environment variable '%s' not set", varName)}
}

func resolveFile(relativePath, parentDir string, allowedRoots []string) (interface{}, error) {
	full := relativePath
	if !filepath.IsAbs(full) {
		full = filepath.Join(parentDir, relativePath)
	}
	if _, err := os.Stat(full); err != nil {
		return nil, &LoadError{
			Kind:    "file_missing",
			Message: fmt.Sprintf("FileNotFoundError: referenced file '%s' not found", relativePath),
		}
	}
	canon := canonicalPath(full)
	if !withinAnyRoot(canon, allowedRoots) {
		return nil, &LoadError{
			Kind:    "file_traversal",
			Message: fmt.Sprintf("File reference '%s' resolves outside allowed roots", relativePath),
		}
	}
	content, err := os.ReadFile(full)
	if err != nil {
		return nil, &LoadError{Kind: "file_missing", Message: fmt.Sprintf("FileNotFoundError: %v", err)}
	}
	switch strings.ToLower(filepath.Ext(full)) {
	case ".json":
		var parsed interface{}
		if err := json.Unmarshal(content, &parsed); err != nil {
			return nil, &LoadError{Kind: "file_missing", Message: fmt.Sprintf("Failed to parse JSON file '%s': %v", relativePath, err)}
		}
		return parsed, nil
	case ".yaml", ".yml":
		var parsed interface{}
		if err := yaml.Unmarshal(content, &parsed); err != nil {
			return nil, &LoadError{Kind: "file_missing", Message: fmt.Sprintf("Failed to parse YAML file '%s': %v", relativePath, err)}
		}
		return parsed, nil
	default:
		return string(content), nil
	}
}

func canonicalPath(p string) string {
	if abs, err := filepath.Abs(p); err == nil {
		p = abs
	}
	if resolved, err := filepath.EvalSymlinks(p); err == nil {
		return resolved
	}
	return filepath.Clean(p)
}

func withinAnyRoot(path string, roots []string) bool {
	for _, root := range roots {
		rel, err := filepath.Rel(root, path)
		if err != nil {
			continue
		}
		if rel == "." || (!strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel)) {
			return true
		}
	}
	return false
}

// BuildAgentFromData validates the template shape and drives the generated
// Agent loader. Callers must resolve ${...} references before invoking.
func BuildAgentFromData(data map[string]interface{}) (Agent, error) {
	if t, ok := data["template"]; ok && t != nil {
		if _, isMap := t.(map[string]interface{}); !isMap {
			return Agent{}, &LoadError{Kind: "template", Message: "Invalid template format: template must be an object"}
		}
	}
	return LoadAgent(data, NewLoadContext())
}

// LoadPromptyContent parses .prompty text, resolves references relative to
// parentDir, and returns the loaded Agent.
func LoadPromptyContent(contents, parentDir string, allowedRoots []string) (Agent, error) {
	data, err := ParseFrontmatter(contents)
	if err != nil {
		return Agent{}, err
	}
	if err := ResolveReferences(data, parentDir, allowedRoots); err != nil {
		return Agent{}, err
	}
	return BuildAgentFromData(data)
}

// LoadPromptyFile reads a .prompty file from disk and loads it, resolving
// references relative to the file's directory.
func LoadPromptyFile(path string) (Agent, error) {
	if _, err := os.Stat(path); err != nil {
		return Agent{}, &LoadError{Kind: "not_found", Message: fmt.Sprintf("FileNotFoundError: prompty file not found: '%s'", path)}
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return Agent{}, &LoadError{Kind: "not_found", Message: fmt.Sprintf("FileNotFoundError: %v", err)}
	}
	dir := canonicalPath(filepath.Dir(path))
	return LoadPromptyContent(string(content), dir, []string{dir})
}

// ValidateInputs fills declared input defaults and reports missing required
// inputs. Example values are never used to satisfy a missing input.
func ValidateInputs(agent Agent, provided map[string]interface{}) (map[string]interface{}, error) {
	result := make(map[string]interface{}, len(provided))
	for key, value := range provided {
		result[key] = value
	}
	sc := &SaveContext{UseShorthand: false, CollectionFormat: CollectionFormatObject}
	for _, item := range agent.Inputs {
		saver, ok := item.(interface {
			Save(*SaveContext) map[string]interface{}
		})
		if !ok {
			continue
		}
		prop := saver.Save(sc)
		name, _ := prop["name"].(string)
		if name == "" {
			continue
		}
		if _, exists := result[name]; exists {
			continue
		}
		if def, ok := prop["default"]; ok && def != nil {
			result[name] = def
			continue
		}
		if req, ok := prop["required"].(bool); ok && req {
			return nil, &LoadError{
				Kind:    "required_input",
				Field:   name,
				Message: fmt.Sprintf("Missing required input: %s", name),
			}
		}
	}
	return result, nil
}
