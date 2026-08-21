package jinjasubset

type expr interface{ exprNode() }

type litExpr struct{ value any }
type varExpr struct {
	root string
	path []pathSeg
}
type filterExpr struct {
	name  string
	input expr
	args  []expr
}
type unaryExpr struct {
	op      string
	operand expr
}
type binaryExpr struct {
	op          string
	left, right expr
}

func (litExpr) exprNode()    {}
func (varExpr) exprNode()    {}
func (filterExpr) exprNode() {}
func (unaryExpr) exprNode()  {}
func (binaryExpr) exprNode() {}

type pathSeg interface{ pathNode() }

type attrSeg struct{ name string }
type indexSeg struct{ expr expr }

func (attrSeg) pathNode()  {}
func (indexSeg) pathNode() {}

type node interface{ nodeMarker() }

type textNode struct{ value string }
type interpNode struct{ expr expr }
type branch struct {
	test expr
	body []node
}
type ifNode struct {
	branches []branch
	elseBody []node
}
type forNode struct {
	loopVar string
	seq     expr
	body    []node
}

func (textNode) nodeMarker()   {}
func (interpNode) nodeMarker() {}
func (ifNode) nodeMarker()     {}
func (forNode) nodeMarker()    {}
