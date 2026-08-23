// Hand-written pipeline layer: minimal Mustache renderer.
//
// Implements the subset of Mustache used by Prompty templates: variable
// interpolation ({{name}}), truthy/list sections ({{#key}}...{{/key}}),
// inverted sections ({{^key}}...{{/key}}), and the implicit iterator ({{.}}).
// This is the Go counterpart to the C# MustacheRenderer (which delegates to the
// Stubble library); the runtime otherwise ships no Mustache engine.

package prompty

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var mustacheTag = regexp.MustCompile(`\{\{([#^/]?)\s*([^}]*?)\s*\}\}`)

// renderMustache renders a Mustache template against a root context map.
func renderMustache(tmpl string, root map[string]interface{}) string {
	return renderMustacheNodes(tmpl, []interface{}{root})
}

// mustacheLookup resolves a key against a context stack (innermost first).
func mustacheLookup(stack []interface{}, key string) interface{} {
	if key == "." {
		if len(stack) > 0 {
			return stack[len(stack)-1]
		}
		return nil
	}
	for i := len(stack) - 1; i >= 0; i-- {
		if m, ok := stack[i].(map[string]interface{}); ok {
			if v, ok := m[key]; ok {
				return v
			}
		}
	}
	return nil
}

// mustacheClassify reports whether a value is truthy and, when it is a list, the
// items to iterate.
func mustacheClassify(v interface{}) (truthy bool, items []interface{}, isList bool) {
	switch x := v.(type) {
	case nil:
		return false, nil, false
	case bool:
		return x, nil, false
	case string:
		return x != "", nil, false
	case []interface{}:
		return len(x) > 0, x, true
	case map[string]interface{}:
		return len(x) > 0, nil, false
	case float64:
		return x != 0, nil, false
	case int:
		return x != 0, nil, false
	default:
		return v != nil, nil, false
	}
}

// mustacheStringify converts a resolved value to its rendered string form.
func mustacheStringify(v interface{}) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case bool:
		if x {
			return "true"
		}
		return "false"
	case float64:
		return strconv.FormatFloat(x, 'g', -1, 64)
	case int:
		return strconv.Itoa(x)
	default:
		return fmt.Sprintf("%v", x)
	}
}

func renderMustacheNodes(t string, stack []interface{}) string {
	var b strings.Builder
	i := 0
	for i < len(t) {
		loc := mustacheTag.FindStringSubmatchIndex(t[i:])
		if loc == nil {
			b.WriteString(t[i:])
			break
		}
		start := i + loc[0]
		end := i + loc[1]
		b.WriteString(t[i:start])
		sigil := t[i+loc[2] : i+loc[3]]
		key := t[i+loc[4] : i+loc[5]]

		if sigil == "#" || sigil == "^" {
			closeTag := "{{/" + key + "}}"
			rest := t[end:]
			ci := strings.Index(rest, closeTag)
			if ci < 0 {
				// Unterminated section: treat remainder as literal.
				b.WriteString(t[start:])
				break
			}
			inner := rest[:ci]
			afterClose := end + ci + len(closeTag)
			val := mustacheLookup(stack, key)
			truthy, items, isList := mustacheClassify(val)
			if sigil == "#" {
				switch {
				case isList:
					for _, item := range items {
						b.WriteString(renderMustacheNodes(inner, append(stack, item)))
					}
				case truthy:
					next := stack
					if m, ok := val.(map[string]interface{}); ok {
						next = append(stack, m)
					}
					b.WriteString(renderMustacheNodes(inner, next))
				}
			} else { // inverted
				if !truthy {
					b.WriteString(renderMustacheNodes(inner, stack))
				}
			}
			i = afterClose
			continue
		}

		b.WriteString(mustacheStringify(mustacheLookup(stack, key)))
		i = end
	}
	return b.String()
}
