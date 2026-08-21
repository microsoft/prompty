package jinjasubset

import (
	"fmt"
	"strings"
	"unicode"
)

type tokenType int

const (
	tokenText tokenType = iota
	tokenExpr
	tokenStmt
	tokenComment
)

type token struct {
	typ       tokenType
	value     string
	trimLeft  bool
	trimRight bool
}

func tokenize(template string) ([]token, error) {
	raw := []token{}
	i, textStart := 0, 0
	for i < len(template) {
		if i+2 <= len(template) {
			two := template[i : i+2]
			typ, close, ok := opener(two)
			if ok {
				if i > textStart {
					raw = append(raw, token{typ: tokenText, value: template[textStart:i]})
				}
				closeIdx := strings.Index(template[i+2:], close)
				if closeIdx < 0 {
					return nil, &TemplateSyntaxError{Message: fmt.Sprintf("unclosed %q tag at offset %d", two, i)}
				}
				closeIdx += i + 2
				inner := template[i+2 : closeIdx]
				trimLeft := strings.HasPrefix(inner, "-")
				trimRight := strings.HasSuffix(inner, "-")
				if trimLeft {
					inner = inner[1:]
				}
				if trimRight {
					inner = inner[:len(inner)-1]
				}
				if typ == tokenComment {
					raw = append(raw, token{typ: tokenComment, trimLeft: trimLeft, trimRight: trimRight})
				} else {
					raw = append(raw, token{typ: typ, value: strings.TrimSpace(inner), trimLeft: trimLeft, trimRight: trimRight})
				}
				i = closeIdx + len(close)
				textStart = i
				continue
			}
		}
		i++
	}
	if textStart < len(template) {
		raw = append(raw, token{typ: tokenText, value: template[textStart:]})
	}
	applyTrims(raw)
	out := make([]token, 0, len(raw))
	for _, tok := range raw {
		if tok.typ != tokenComment {
			out = append(out, tok)
		}
	}
	return out, nil
}

func opener(two string) (tokenType, string, bool) {
	switch two {
	case "{{":
		return tokenExpr, "}}", true
	case "{%":
		return tokenStmt, "%}", true
	case "{#":
		return tokenComment, "#}", true
	default:
		return tokenText, "", false
	}
}

func applyTrims(tokens []token) {
	for i := range tokens {
		if tokens[i].typ == tokenText {
			continue
		}
		if tokens[i].trimLeft && i > 0 && tokens[i-1].typ == tokenText {
			tokens[i-1].value = strings.TrimRightFunc(tokens[i-1].value, unicode.IsSpace)
		}
		if tokens[i].trimRight && i+1 < len(tokens) && tokens[i+1].typ == tokenText {
			tokens[i+1].value = strings.TrimLeftFunc(tokens[i+1].value, unicode.IsSpace)
		}
	}
}
