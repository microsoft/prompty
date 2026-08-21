package jinjasubset

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

type exprTokenKind int

const (
	exprString exprTokenKind = iota
	exprNumber
	exprOp
	exprKeyword
	exprName
)

type exprToken struct {
	kind  exprTokenKind
	value any
}

var keywords = map[string]bool{
	"and": true, "or": true, "not": true, "in": true, "true": true, "false": true, "null": true,
}

func parseTemplate(template string) ([]node, error) {
	toks, err := tokenize(template)
	if err != nil {
		return nil, err
	}
	return (&templateParser{tokens: toks}).parse()
}

func lexExpr(src string) ([]exprToken, error) {
	toks := []exprToken{}
	for i := 0; i < len(src); {
		r, size := rune(src[i]), 1
		if r >= 0x80 {
			r, size = utf8Rune(src[i:])
		}
		if unicode.IsSpace(r) {
			i += size
			continue
		}
		if src[i] == '"' || src[i] == '\'' {
			quote := src[i]
			i++
			var b strings.Builder
			for i < len(src) && src[i] != quote {
				if src[i] == '\\' && i+1 < len(src) {
					b.WriteByte(src[i+1])
					i += 2
					continue
				}
				b.WriteByte(src[i])
				i++
			}
			if i >= len(src) {
				return nil, &TemplateSyntaxError{Message: "unterminated string in expression: " + src}
			}
			i++
			toks = append(toks, exprToken{kind: exprString, value: b.String()})
			continue
		}
		if isDigit(src[i]) || (src[i] == '-' && i+1 < len(src) && isDigit(src[i+1])) {
			j := i + 1
			for j < len(src) && (isDigit(src[j]) || src[j] == '.') {
				j++
			}
			num := src[i:j]
			if strings.Contains(num, ".") {
				v, err := strconv.ParseFloat(num, 64)
				if err != nil {
					return nil, &TemplateSyntaxError{Message: "invalid number in expression: " + num}
				}
				toks = append(toks, exprToken{kind: exprNumber, value: v})
			} else {
				v, err := strconv.ParseInt(num, 10, 64)
				if err != nil {
					return nil, &TemplateSyntaxError{Message: "invalid number in expression: " + num}
				}
				toks = append(toks, exprToken{kind: exprNumber, value: v})
			}
			i = j
			continue
		}
		if unicode.IsLetter(r) || r == '_' {
			j := i + size
			for j < len(src) {
				rr, ss := utf8Rune(src[j:])
				if !(unicode.IsLetter(rr) || unicode.IsDigit(rr) || rr == '_') {
					break
				}
				j += ss
			}
			word := src[i:j]
			kind := exprName
			if keywords[word] {
				kind = exprKeyword
			}
			toks = append(toks, exprToken{kind: kind, value: word})
			i = j
			continue
		}
		if i+2 <= len(src) {
			two := src[i : i+2]
			if two == "==" || two == "!=" || two == "<=" || two == ">=" {
				toks = append(toks, exprToken{kind: exprOp, value: two})
				i += 2
				continue
			}
		}
		if strings.ContainsRune("()[].,|<>", rune(src[i])) {
			toks = append(toks, exprToken{kind: exprOp, value: string(src[i])})
			i++
			continue
		}
		return nil, &TemplateSyntaxError{Message: fmt.Sprintf("unexpected character %q in expression: %s", src[i], src)}
	}
	return toks, nil
}

func utf8Rune(s string) (rune, int) {
	return utf8.DecodeRuneInString(s)
}

func isDigit(b byte) bool { return b >= '0' && b <= '9' }

type exprParser struct {
	toks []exprToken
	src  string
	pos  int
}

func parseExpression(src string) (expr, error) {
	toks, err := lexExpr(src)
	if err != nil {
		return nil, err
	}
	p := &exprParser{toks: toks, src: src}
	ex, err := p.parseOr()
	if err != nil {
		return nil, err
	}
	if p.pos != len(p.toks) {
		return nil, &TemplateSyntaxError{Message: "trailing tokens in expression: " + src}
	}
	return ex, nil
}

func (p *exprParser) peek() (exprToken, bool) {
	if p.pos >= len(p.toks) {
		return exprToken{}, false
	}
	return p.toks[p.pos], true
}

func (p *exprParser) next() exprToken {
	t := p.toks[p.pos]
	p.pos++
	return t
}

func (p *exprParser) is(kind exprTokenKind, value any) bool {
	t, ok := p.peek()
	return ok && t.kind == kind && t.value == value
}

func (p *exprParser) parseOr() (expr, error) {
	left, err := p.parseAnd()
	if err != nil {
		return nil, err
	}
	for p.is(exprKeyword, "or") {
		p.next()
		right, err := p.parseAnd()
		if err != nil {
			return nil, err
		}
		left = binaryExpr{op: "or", left: left, right: right}
	}
	return left, nil
}

func (p *exprParser) parseAnd() (expr, error) {
	left, err := p.parseNot()
	if err != nil {
		return nil, err
	}
	for p.is(exprKeyword, "and") {
		p.next()
		right, err := p.parseNot()
		if err != nil {
			return nil, err
		}
		left = binaryExpr{op: "and", left: left, right: right}
	}
	return left, nil
}

func (p *exprParser) parseNot() (expr, error) {
	if p.is(exprKeyword, "not") {
		p.next()
		operand, err := p.parseNot()
		if err != nil {
			return nil, err
		}
		return unaryExpr{op: "not", operand: operand}, nil
	}
	return p.parseComparison()
}

func (p *exprParser) parseComparison() (expr, error) {
	left, err := p.parseFilter()
	if err != nil {
		return nil, err
	}
	if t, ok := p.peek(); ok && t.kind == exprOp {
		if op, _ := t.value.(string); op == "==" || op == "!=" || op == "<" || op == ">" || op == "<=" || op == ">=" {
			p.next()
			right, err := p.parseFilter()
			if err != nil {
				return nil, err
			}
			return binaryExpr{op: op, left: left, right: right}, nil
		}
	}
	if p.is(exprKeyword, "in") {
		p.next()
		right, err := p.parseFilter()
		if err != nil {
			return nil, err
		}
		return binaryExpr{op: "in", left: left, right: right}, nil
	}
	return left, nil
}

func (p *exprParser) parseFilter() (expr, error) {
	ex, err := p.parsePrimary()
	if err != nil {
		return nil, err
	}
	for p.is(exprOp, "|") {
		p.next()
		nameTok, ok := p.peek()
		if !ok || nameTok.kind != exprName {
			return nil, &TemplateSyntaxError{Message: "expected filter name in: " + p.src}
		}
		name := p.next().value.(string)
		args := []expr{}
		if p.is(exprOp, "(") {
			p.next()
			if !p.is(exprOp, ")") {
				arg, err := p.parseOr()
				if err != nil {
					return nil, err
				}
				args = append(args, arg)
				for p.is(exprOp, ",") {
					p.next()
					arg, err := p.parseOr()
					if err != nil {
						return nil, err
					}
					args = append(args, arg)
				}
			}
			if !p.is(exprOp, ")") {
				return nil, &TemplateSyntaxError{Message: "unclosed filter args in: " + p.src}
			}
			p.next()
		}
		ex = filterExpr{name: name, input: ex, args: args}
	}
	return ex, nil
}

func (p *exprParser) parsePrimary() (expr, error) {
	t, ok := p.peek()
	if !ok {
		return nil, &TemplateSyntaxError{Message: "unexpected end of expression: " + p.src}
	}
	if t.kind == exprOp && t.value == "(" {
		p.next()
		ex, err := p.parseOr()
		if err != nil {
			return nil, err
		}
		if !p.is(exprOp, ")") {
			return nil, &TemplateSyntaxError{Message: "unclosed parenthesis in: " + p.src}
		}
		p.next()
		return ex, nil
	}
	if t.kind == exprString || t.kind == exprNumber {
		p.next()
		return litExpr{value: t.value}, nil
	}
	if t.kind == exprKeyword {
		switch t.value {
		case "true":
			p.next()
			return litExpr{value: true}, nil
		case "false":
			p.next()
			return litExpr{value: false}, nil
		case "null":
			p.next()
			return litExpr{value: nil}, nil
		}
	}
	if t.kind == exprName {
		return p.parseAccessor()
	}
	return nil, &TemplateSyntaxError{Message: fmt.Sprintf("unexpected token %q in expression: %s", t.value, p.src)}
}

func (p *exprParser) parseAccessor() (expr, error) {
	root := p.next().value.(string)
	path := []pathSeg{}
	for {
		if p.is(exprOp, ".") {
			p.next()
			t, ok := p.peek()
			if !ok || (t.kind != exprName && t.kind != exprKeyword) {
				return nil, &TemplateSyntaxError{Message: "expected attribute name in: " + p.src}
			}
			path = append(path, attrSeg{name: t.value.(string)})
			p.next()
			continue
		}
		if p.is(exprOp, "[") {
			p.next()
			idx, err := p.parseOr()
			if err != nil {
				return nil, err
			}
			if !p.is(exprOp, "]") {
				return nil, &TemplateSyntaxError{Message: "unclosed index in: " + p.src}
			}
			p.next()
			path = append(path, indexSeg{expr: idx})
			continue
		}
		break
	}
	return varExpr{root: root, path: path}, nil
}

type templateParser struct {
	tokens []token
	pos    int
}

func (p *templateParser) parse() ([]node, error) { return p.parseNodes(nil) }

func (p *templateParser) parseNodes(terminators map[string]bool) ([]node, error) {
	nodes := []node{}
	for p.pos < len(p.tokens) {
		tok := p.tokens[p.pos]
		if tok.typ == tokenStmt {
			head, _ := stmtHead(tok.value)
			if terminators != nil && terminators[head] {
				return nodes, nil
			}
			switch head {
			case "if":
				n, err := p.parseIf()
				if err != nil {
					return nil, err
				}
				nodes = append(nodes, n)
			case "for":
				n, err := p.parseFor()
				if err != nil {
					return nil, err
				}
				nodes = append(nodes, n)
			default:
				return nil, &TemplateSyntaxError{Message: "unexpected statement " + tok.value}
			}
			continue
		}
		if tok.typ == tokenText {
			p.pos++
			nodes = append(nodes, textNode{value: tok.value})
			continue
		}
		if tok.typ == tokenExpr {
			p.pos++
			ex, err := parseExpression(tok.value)
			if err != nil {
				return nil, err
			}
			nodes = append(nodes, interpNode{expr: ex})
			continue
		}
		return nil, &TemplateSyntaxError{Message: "unexpected token type"}
	}
	if terminators != nil {
		return nil, &TemplateSyntaxError{Message: "unclosed block"}
	}
	return nodes, nil
}

func (p *templateParser) parseIf() (node, error) {
	branches := []branch{}
	_, rest := stmtHead(p.tokens[p.pos].value)
	p.pos++
	test, err := parseExpression(rest)
	if err != nil {
		return nil, err
	}
	body, err := p.parseNodes(map[string]bool{"elif": true, "else": true, "endif": true})
	if err != nil {
		return nil, err
	}
	branches = append(branches, branch{test: test, body: body})
	var elseBody []node
	for {
		if p.pos >= len(p.tokens) {
			return nil, &TemplateSyntaxError{Message: "unclosed 'if' block"}
		}
		head, rest := stmtHead(p.tokens[p.pos].value)
		switch head {
		case "elif":
			p.pos++
			test, err := parseExpression(rest)
			if err != nil {
				return nil, err
			}
			body, err := p.parseNodes(map[string]bool{"elif": true, "else": true, "endif": true})
			if err != nil {
				return nil, err
			}
			branches = append(branches, branch{test: test, body: body})
		case "else":
			p.pos++
			elseBody, err = p.parseNodes(map[string]bool{"endif": true})
			if err != nil {
				return nil, err
			}
		case "endif":
			p.pos++
			return ifNode{branches: branches, elseBody: elseBody}, nil
		default:
			return nil, &TemplateSyntaxError{Message: "unexpected statement in if block: " + p.tokens[p.pos].value}
		}
	}
}

func (p *templateParser) parseFor() (node, error) {
	_, rest := stmtHead(p.tokens[p.pos].value)
	p.pos++
	loopVar, seqSrc, ok := parseForRest(rest)
	if !ok {
		return nil, &TemplateSyntaxError{Message: "malformed for statement: for " + rest}
	}
	seq, err := parseExpression(seqSrc)
	if err != nil {
		return nil, err
	}
	body, err := p.parseNodes(map[string]bool{"endfor": true})
	if err != nil {
		return nil, err
	}
	if p.pos >= len(p.tokens) {
		return nil, &TemplateSyntaxError{Message: "unclosed 'for' block"}
	}
	head, _ := stmtHead(p.tokens[p.pos].value)
	if head != "endfor" {
		return nil, &TemplateSyntaxError{Message: "unclosed 'for' block"}
	}
	p.pos++
	return forNode{loopVar: loopVar, seq: seq, body: body}, nil
}

func stmtHead(inner string) (string, string) {
	trimmed := strings.TrimSpace(inner)
	for i, r := range trimmed {
		if unicode.IsSpace(r) {
			return trimmed[:i], strings.TrimSpace(trimmed[i:])
		}
	}
	return trimmed, ""
}

func parseForRest(rest string) (string, string, bool) {
	fields := strings.Fields(rest)
	if len(fields) < 3 || fields[1] != "in" {
		return "", "", false
	}
	needle := fields[0] + " " + fields[1]
	idx := strings.Index(rest, needle)
	if idx < 0 {
		return "", "", false
	}
	seq := strings.TrimSpace(rest[idx+len(needle):])
	return fields[0], seq, seq != ""
}
