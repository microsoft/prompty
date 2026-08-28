// Hand-written pipeline layer: template rendering.
//
// Renders an agent's instructions with caller-supplied inputs, dispatching on
// the configured template engine (jinja2 or mustache). Rich-kind inputs
// (thread/image/file/audio) are replaced with nonce markers that the parser
// later expands into structured messages. Mirrors the C# Pipeline.RenderAsync
// and RenderHelpers.PrepareRenderInputs reference implementation.

package prompty

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"prompty/jinjasubset"
)

// ThreadNoncePrefix is the prefix for thread nonce markers per spec §5.2.
// Format: __PROMPTY_THREAD_{hex8}_{name}__
const ThreadNoncePrefix = "__PROMPTY_THREAD_"

// richKinds are property kinds that cannot be rendered as text and are instead
// replaced with nonce markers during rendering.
var richKinds = map[string]bool{
	"thread": true,
	"image":  true,
	"file":   true,
	"audio":  true,
}

// generateHex returns a random lowercase hex string of 2*nBytes characters.
func generateHex(nBytes int) string {
	buf := make([]byte, nBytes)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand.Read never fails on supported platforms; fall back to zeros.
		for i := range buf {
			buf[i] = 0
		}
	}
	return hex.EncodeToString(buf)
}

// propertyNameKind extracts the name and kind of a declared input property,
// tolerating Property values or raw maps.
func propertyNameKind(item interface{}) (string, string) {
	switch p := item.(type) {
	case Property:
		return p.Name, p.Kind
	case *Property:
		if p == nil {
			return "", ""
		}
		return p.Name, p.Kind
	case map[string]interface{}:
		name, _ := p["name"].(string)
		kind, _ := p["kind"].(string)
		return name, kind
	default:
		return "", ""
	}
}

// PrepareRenderInputs replaces rich-kind declared inputs with nonce markers and
// returns the modified inputs plus a nonce → property-name mapping.
func PrepareRenderInputs(agent *Agent, inputs map[string]interface{}) (map[string]interface{}, map[string]string) {
	renderInputs := make(map[string]interface{}, len(inputs))
	for k, v := range inputs {
		renderInputs[k] = v
	}
	nonces := map[string]string{}
	if agent == nil {
		return renderInputs, nonces
	}
	for _, item := range agent.Inputs {
		name, kind := propertyNameKind(item)
		if name == "" || !richKinds[kind] {
			continue
		}
		nonce := ThreadNoncePrefix + generateHex(4) + "_" + name + "__"
		nonces[nonce] = name
		renderInputs[name] = nonce
	}
	return renderInputs, nonces
}

// formatEngine extracts the template engine discriminator from the coerce-union
// Template.Format value, which may hold any FormatConfig child type. It reads the
// discriminator via the canonical Save() form (mirroring the seam adapter) and
// defaults to "jinja2".
func formatEngine(agent *Agent) string {
	if agent == nil || agent.Template == nil || agent.Template.Format == nil {
		return "jinja2"
	}
	// Coerce shorthand: `format: mustache` lowers the FormatConfig|string union
	// to a bare string that IS the kind.
	if kind, ok := agent.Template.Format.(string); ok {
		if kind != "" {
			return kind
		}
		return "jinja2"
	}
	if s, ok := agent.Template.Format.(interface {
		Save(*SaveContext) map[string]interface{}
	}); ok {
		if kind, ok := s.Save(NewSaveContext())["kind"].(string); ok && kind != "" {
			return kind
		}
	}
	return "jinja2"
}

// Render renders the agent's instructions with the supplied inputs. It returns
// the rendered text and the nonce → property-name mapping produced by rich-kind
// substitution.
func Render(agent *Agent, inputs map[string]interface{}) (string, map[string]string, error) {
	renderInputs, nonces := PrepareRenderInputs(agent, inputs)

	template := ""
	if agent != nil && agent.Instructions != nil {
		template = *agent.Instructions
	}

	engine := formatEngine(agent)

	switch engine {
	case "jinja2":
		out, err := jinjasubset.Render(template, renderInputs, nil)
		return out, nonces, err
	case "mustache":
		return renderMustache(template, renderInputs), nonces, nil
	default:
		return "", nil, fmt.Errorf("unsupported template engine %q", engine)
	}
}
