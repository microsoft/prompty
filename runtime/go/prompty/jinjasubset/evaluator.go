package jinjasubset

import (
	"errors"
	"fmt"
	"math"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Segment is a provenance-tagged piece of rendered template output.
type Segment struct {
	Kind   string  `json:"kind"`
	Text   string  `json:"text"`
	Source *string `json:"source"`
	Strict bool    `json:"strict"`
}

// TemplateSyntaxError reports tokenizer or parser failures.
type TemplateSyntaxError struct{ Message string }

func (e *TemplateSyntaxError) Error() string { return e.Message }

// StrictViolationError reports a strict input forging a role boundary.
type StrictViolationError struct{ Message string }

func (e *StrictViolationError) Error() string { return e.Message }

// IsStrictViolation reports whether err is a StrictViolationError.
func IsStrictViolation(err error) bool {
	var target *StrictViolationError
	return errors.As(err, &target)
}

type undefined struct{}

var undefinedValue = undefined{}

type frame struct {
	scope       map[string]any
	strictProps map[string]bool
}

var roleBoundary = regexp.MustCompile(`(?im)^\s*(system|user|assistant|developer)\s*:`)

// RenderSegments renders template to provenance-tagged segments.
func RenderSegments(template string, inputs map[string]any, strictProps []string) ([]Segment, error) {
	nodes, err := parseTemplate(template)
	if err != nil {
		return nil, err
	}
	scope := map[string]any{}
	for k, v := range inputs {
		scope[k] = v
	}
	strict := map[string]bool{}
	for _, prop := range strictProps {
		strict[prop] = true
	}
	out := []Segment{}
	err = renderNodes(nodes, frame{scope: scope, strictProps: strict}, &out)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Render renders template and concatenates the resulting segment text.
func Render(template string, inputs map[string]any, strictProps []string) (string, error) {
	segments, err := RenderSegments(template, inputs, strictProps)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	for _, segment := range segments {
		b.WriteString(segment.Text)
	}
	return b.String(), nil
}

func renderNodes(nodes []node, fr frame, out *[]Segment) error {
	for _, n := range nodes {
		switch typed := n.(type) {
		case textNode:
			if typed.value != "" {
				addSegment(out, Segment{Kind: "literal", Text: typed.value})
			}
		case interpNode:
			value, err := evalExpr(typed.expr, fr.scope)
			if err != nil {
				return err
			}
			text := stringify(value)
			source := interpSource(typed.expr)
			isStrict := source != nil && fr.strictProps[*source]
			if isStrict && roleBoundary.MatchString(text) {
				return &StrictViolationError{Message: fmt.Sprintf("strict input %q produced a forged role boundary: %s", *source, text)}
			}
			addSegment(out, Segment{Kind: "interp", Text: text, Source: source, Strict: isStrict})
		case ifNode:
			if err := renderIf(typed, fr, out); err != nil {
				return err
			}
		case forNode:
			if err := renderFor(typed, fr, out); err != nil {
				return err
			}
		default:
			return fmt.Errorf("unknown node %T", n)
		}
	}
	return nil
}

func addSegment(out *[]Segment, segment Segment) {
	if segment.Kind == "literal" && len(*out) > 0 {
		last := &(*out)[len(*out)-1]
		if last.Kind == "literal" {
			last.Text += segment.Text
			return
		}
	}
	*out = append(*out, segment)
}

func renderIf(n ifNode, fr frame, out *[]Segment) error {
	for _, br := range n.branches {
		v, err := evalExpr(br.test, fr.scope)
		if err != nil {
			return err
		}
		if truthy(v) {
			return renderNodes(br.body, fr, out)
		}
	}
	if n.elseBody != nil {
		return renderNodes(n.elseBody, fr, out)
	}
	return nil
}

func renderFor(n forNode, fr frame, out *[]Segment) error {
	value, err := evalExpr(n.seq, fr.scope)
	if err != nil {
		return err
	}
	items := iterSeq(value)
	total := len(items)
	for i, item := range items {
		child := map[string]any{}
		for k, v := range fr.scope {
			child[k] = v
		}
		child[n.loopVar] = item
		child["loop"] = map[string]any{
			"index":  int64(i + 1),
			"index0": int64(i),
			"first":  i == 0,
			"last":   i == total-1,
			"length": int64(total),
		}
		if err := renderNodes(n.body, frame{scope: child, strictProps: fr.strictProps}, out); err != nil {
			return err
		}
	}
	return nil
}

func interpSource(ex expr) *string {
	if v, ok := ex.(varExpr); ok {
		return &v.root
	}
	return nil
}

func evalExpr(ex expr, scope map[string]any) (any, error) {
	switch typed := ex.(type) {
	case litExpr:
		return typed.value, nil
	case varExpr:
		value := lookup(typed.root, scope)
		for _, seg := range typed.path {
			var err error
			value, err = access(value, seg, scope)
			if err != nil {
				return nil, err
			}
		}
		return value, nil
	case filterExpr:
		return applyFilter(typed, scope)
	case unaryExpr:
		value, err := evalExpr(typed.operand, scope)
		if err != nil {
			return nil, err
		}
		return !truthy(value), nil
	case binaryExpr:
		return evalBinary(typed, scope)
	default:
		return nil, fmt.Errorf("unknown expression %T", ex)
	}
}

func lookup(root string, scope map[string]any) any {
	if value, ok := scope[root]; ok {
		return value
	}
	return undefinedValue
}

func access(value any, seg pathSeg, scope map[string]any) (any, error) {
	if value == nil || isUndefined(value) {
		return undefinedValue, nil
	}
	switch typed := seg.(type) {
	case attrSeg:
		if m, ok := asStringMap(value); ok {
			if v, found := m[typed.name]; found {
				return v, nil
			}
		}
		return undefinedValue, nil
	case indexSeg:
		index, err := evalExpr(typed.expr, scope)
		if err != nil {
			return nil, err
		}
		if m, ok := asStringMap(value); ok {
			if key, ok := index.(string); ok {
				if v, found := m[key]; found {
					return v, nil
				}
			}
			return undefinedValue, nil
		}
		if s, ok := value.(string); ok {
			i, ok := toIndex(index)
			if !ok {
				return undefinedValue, nil
			}
			runes := []rune(s)
			if i < 0 {
				i += len(runes)
			}
			if i >= 0 && i < len(runes) {
				return string(runes[i]), nil
			}
			return undefinedValue, nil
		}
		items, ok := asSlice(value)
		if !ok {
			return undefinedValue, nil
		}
		i, ok := toIndex(index)
		if !ok {
			return undefinedValue, nil
		}
		if i < 0 {
			i += len(items)
		}
		if i >= 0 && i < len(items) {
			return items[i], nil
		}
		return undefinedValue, nil
	default:
		return undefinedValue, nil
	}
}

func evalBinary(ex binaryExpr, scope map[string]any) (any, error) {
	if ex.op == "and" {
		left, err := evalExpr(ex.left, scope)
		if err != nil {
			return nil, err
		}
		if truthy(left) {
			return evalExpr(ex.right, scope)
		}
		return left, nil
	}
	if ex.op == "or" {
		left, err := evalExpr(ex.left, scope)
		if err != nil {
			return nil, err
		}
		if truthy(left) {
			return left, nil
		}
		return evalExpr(ex.right, scope)
	}
	left, err := evalExpr(ex.left, scope)
	if err != nil {
		return nil, err
	}
	right, err := evalExpr(ex.right, scope)
	if err != nil {
		return nil, err
	}
	if ex.op == "in" {
		return evalIn(left, right), nil
	}
	lc, rc := nilIfUndefined(left), nilIfUndefined(right)
	switch ex.op {
	case "==":
		return valueEquals(lc, rc), nil
	case "!=":
		return !valueEquals(lc, rc), nil
	}
	if lx, ok := toFloat(lc); ok {
		if rx, ok := toFloat(rc); ok {
			switch ex.op {
			case "<":
				return lx < rx, nil
			case ">":
				return lx > rx, nil
			case "<=":
				return lx <= rx, nil
			case ">=":
				return lx >= rx, nil
			}
		}
	}
	ls, lok := lc.(string)
	rs, rok := rc.(string)
	if lok && rok {
		cmp := strings.Compare(ls, rs)
		switch ex.op {
		case "<":
			return cmp < 0, nil
		case ">":
			return cmp > 0, nil
		case "<=":
			return cmp <= 0, nil
		case ">=":
			return cmp >= 0, nil
		}
	}
	return false, nil
}

func evalIn(left, right any) bool {
	if m, ok := asStringMap(right); ok {
		key, ok := left.(string)
		return ok && hasKey(m, key)
	}
	if items, ok := asSlice(right); ok {
		for _, item := range items {
			if valueEquals(nilIfUndefined(item), nilIfUndefined(left)) {
				return true
			}
		}
		return false
	}
	if s, ok := right.(string); ok {
		sub, ok := left.(string)
		return ok && strings.Contains(s, sub)
	}
	return false
}

func applyFilter(ex filterExpr, scope map[string]any) (any, error) {
	value, err := evalExpr(ex.input, scope)
	if err != nil {
		return nil, err
	}
	args := []any{}
	for _, argExpr := range ex.args {
		arg, err := evalExpr(argExpr, scope)
		if err != nil {
			return nil, err
		}
		args = append(args, arg)
	}
	switch ex.name {
	case "upper":
		return strings.ToUpper(stringify(value)), nil
	case "lower":
		return strings.ToLower(stringify(value)), nil
	case "trim":
		return strings.TrimSpace(stringify(value)), nil
	case "join":
		sep := ""
		if len(args) > 0 {
			sep = stringify(args[0])
		}
		items, _ := asSlice(value)
		parts := make([]string, len(items))
		for i, item := range items {
			parts[i] = stringify(item)
		}
		return strings.Join(parts, sep), nil
	case "length":
		if value == nil || isUndefined(value) {
			return int64(0), nil
		}
		if s, ok := value.(string); ok {
			return int64(len([]rune(s))), nil
		}
		if m, ok := asStringMap(value); ok {
			return int64(len(m)), nil
		}
		if items, ok := asSlice(value); ok {
			return int64(len(items)), nil
		}
		return int64(0), nil
	case "default":
		fallback := any("")
		if len(args) > 0 {
			fallback = args[0]
		}
		if value == nil || isUndefined(value) {
			return fallback, nil
		}
		return value, nil
	case "replace":
		if len(args) < 2 {
			return nil, errors.New("replace filter requires (old, new) arguments")
		}
		old := stringify(args[0])
		if old == "" {
			return stringify(value), nil
		}
		return strings.ReplaceAll(stringify(value), old, stringify(args[1])), nil
	default:
		return nil, fmt.Errorf("unknown filter: %s", ex.name)
	}
}

func iterSeq(value any) []any {
	if value == nil || isUndefined(value) {
		return nil
	}
	if m, ok := asStringMap(value); ok {
		keys := make([]string, 0, len(m))
		for k := range m {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out := make([]any, len(keys))
		for i, key := range keys {
			out[i] = key
		}
		return out
	}
	if s, ok := value.(string); ok {
		runes := []rune(s)
		out := make([]any, len(runes))
		for i, r := range runes {
			out[i] = string(r)
		}
		return out
	}
	items, _ := asSlice(value)
	return items
}

func truthy(value any) bool {
	if value == nil || isUndefined(value) {
		return false
	}
	switch v := value.(type) {
	case bool:
		return v
	case string:
		return v != ""
	}
	if m, ok := asStringMap(value); ok {
		return len(m) > 0
	}
	if items, ok := asSlice(value); ok {
		return len(items) > 0
	}
	if f, ok := toFloat(value); ok {
		return f != 0
	}
	return true
}

func stringify(value any) string {
	if value == nil || isUndefined(value) {
		return ""
	}
	switch v := value.(type) {
	case string:
		return v
	case bool:
		if v {
			return "true"
		}
		return "false"
	case int:
		return strconv.FormatInt(int64(v), 10)
	case int8:
		return strconv.FormatInt(int64(v), 10)
	case int16:
		return strconv.FormatInt(int64(v), 10)
	case int32:
		return strconv.FormatInt(int64(v), 10)
	case int64:
		return strconv.FormatInt(v, 10)
	case uint:
		return strconv.FormatUint(uint64(v), 10)
	case uint8:
		return strconv.FormatUint(uint64(v), 10)
	case uint16:
		return strconv.FormatUint(uint64(v), 10)
	case uint32:
		return strconv.FormatUint(uint64(v), 10)
	case uint64:
		return strconv.FormatUint(v, 10)
	case float32:
		return formatFloat(float64(v))
	case float64:
		return formatFloat(v)
	}
	if m, ok := asStringMap(value); ok {
		keys := make([]string, 0, len(m))
		for k := range m {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, key := range keys {
			parts = append(parts, "'"+key+"': "+stringify(m[key]))
		}
		return "{" + strings.Join(parts, ", ") + "}"
	}
	if items, ok := asSlice(value); ok {
		var b strings.Builder
		for _, item := range items {
			b.WriteString(stringify(item))
		}
		return b.String()
	}
	return fmt.Sprint(value)
}

func formatFloat(f float64) string {
	if !math.IsInf(f, 0) && !math.IsNaN(f) && f == math.Floor(f) && math.Abs(f) < 9.2e18 {
		return strconv.FormatInt(int64(f), 10)
	}
	return strconv.FormatFloat(f, 'g', 15, 64)
}

func valueEquals(a, b any) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	if af, ok := toFloat(a); ok {
		if bf, ok := toFloat(b); ok {
			return af == bf
		}
	}
	return reflect.DeepEqual(a, b)
}

func nilIfUndefined(value any) any {
	if isUndefined(value) {
		return nil
	}
	return value
}

func isUndefined(value any) bool {
	_, ok := value.(undefined)
	return ok
}

func asStringMap(value any) (map[string]any, bool) {
	if m, ok := value.(map[string]any); ok {
		return m, true
	}
	return nil, false
}

func hasKey(m map[string]any, key string) bool {
	_, ok := m[key]
	return ok
}

func asSlice(value any) ([]any, bool) {
	if s, ok := value.([]any); ok {
		return s, true
	}
	rv := reflect.ValueOf(value)
	if !rv.IsValid() || (rv.Kind() != reflect.Slice && rv.Kind() != reflect.Array) {
		return nil, false
	}
	out := make([]any, rv.Len())
	for i := 0; i < rv.Len(); i++ {
		out[i] = rv.Index(i).Interface()
	}
	return out, true
}

func toIndex(value any) (int, bool) {
	switch v := value.(type) {
	case int:
		return v, true
	case int8:
		return int(v), true
	case int16:
		return int(v), true
	case int32:
		return int(v), true
	case int64:
		return int(v), true
	case float32:
		return int(v), true
	case float64:
		return int(v), true
	case string:
		i, err := strconv.Atoi(v)
		return i, err == nil
	default:
		return 0, false
	}
}

func toFloat(value any) (float64, bool) {
	switch v := value.(type) {
	case int:
		return float64(v), true
	case int8:
		return float64(v), true
	case int16:
		return float64(v), true
	case int32:
		return float64(v), true
	case int64:
		return float64(v), true
	case uint:
		return float64(v), true
	case uint8:
		return float64(v), true
	case uint16:
		return float64(v), true
	case uint32:
		return float64(v), true
	case uint64:
		return float64(v), true
	case float32:
		return float64(v), true
	case float64:
		return v, true
	default:
		return 0, false
	}
}
