// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PromptySemanticTokenTypes, Token } from "../util/semantic-tokens";

function jinjaVariable(baseIndex: number, match: RegExpExecArray): Token[] {
  return [
    {
      startIndex: baseIndex + match[0].indexOf(match[1]),
      length: match[1].length,
      token: PromptySemanticTokenTypes.Variable,
    },
  ];
}

const jinjaExpressionHandlers = [{ re: /\s*(\w+(?:\.\w+)*)\s*/g, handler: jinjaVariable }];

function jinjaExpression(match: RegExpExecArray): Token[] {
  const endIndex = match[0].indexOf(match[3], match[1].length);
  const startToken: Token = {
    startIndex: match.index,
    length: match[1].length,
    token: PromptySemanticTokenTypes.PunctuationTemplateBegin,
  };
  if (match[2] === undefined) {
    return [startToken];
  }
  const endToken: Token = {
    startIndex: match.index + endIndex,
    length: match[3].length,
    token: PromptySemanticTokenTypes.PunctuationTemplateEnd,
  };
  if (match[2].trim() === "") {
    return [startToken, endToken];
  }
  const contentIndex = match.index + match[0].indexOf(match[2], match[1].length);
  for (const { re, handler } of jinjaExpressionHandlers) {
    const regex = new RegExp(re);
    const expressionMatch = regex.exec(match[2]);
    if (expressionMatch) {
      return [startToken, ...handler(contentIndex, expressionMatch), endToken];
    }
  }
  return [];
}

function forLoopHandler(baseIndex: number, match: RegExpExecArray): Token[] {
  const forIndex = match[0].indexOf(match[1]);
  const variableIndex = match[0].indexOf(match[2], forIndex + match[1].length);
  const inIndex = match[0].indexOf(match[3], variableIndex + match[2].length);
  const collectionIndex = match[0].indexOf(match[4], inIndex + match[3].length);
  const tokens: Token[] = [
    {
      startIndex: baseIndex + forIndex,
      length: match[1].length,
      token: PromptySemanticTokenTypes.Keyword,
    },
    {
      startIndex: baseIndex + variableIndex,
      length: match[2].length,
      token: PromptySemanticTokenTypes.Variable,
    },
    {
      startIndex: baseIndex + inIndex,
      length: match[3].length,
      token: PromptySemanticTokenTypes.Keyword,
    },
    {
      startIndex: baseIndex + collectionIndex,
      length: match[4].length,
      token: PromptySemanticTokenTypes.Variable,
    },
  ];
  return tokens;
}

function endForHandler(baseIndex: number, match: RegExpExecArray): Token[] {
  const tokens: Token[] = [
    {
      startIndex: baseIndex,
      length: match[1].length,
      token: PromptySemanticTokenTypes.Keyword,
    },
  ];
  return tokens;
}

function ifStatementHandler(baseIndex: number, match: RegExpExecArray): Token[] {
  const ifIndex = match[0].indexOf(match[1]);
  const notIndex = match[2]
    ? match[0].indexOf(match[2], ifIndex + match[1].length)
    : ifIndex + match[1].length;
  const variableIndex = match[0].indexOf(match[3], notIndex + match[2]?.length);
  const tokens: Token[] = [
    {
      startIndex: baseIndex + ifIndex,
      length: match[1].length,
      token: PromptySemanticTokenTypes.Keyword,
    },
  ];
  if (match[2]) {
    tokens.push({
      startIndex: baseIndex + notIndex,
      length: match[2].length,
      token: PromptySemanticTokenTypes.Keyword,
    });
  }
  tokens.push({
    startIndex: baseIndex + variableIndex,
    length: match[3].length,
    token: PromptySemanticTokenTypes.Variable,
  });
  return tokens;
}

function endIfHandler(baseIndex: number, match: RegExpExecArray): Token[] {
  const tokens: Token[] = [
    {
      startIndex: baseIndex,
      length: match[1].length,
      token: PromptySemanticTokenTypes.Keyword,
    },
  ];
  return tokens;
}

const jinjaStatementHandlers = [
  { re: /(endfor)/, handler: endForHandler },
  { re: /(?:\s*(for)\s+)(\w+)(?:\s+(in)\s+)(\w+)(?:\s*)/, handler: forLoopHandler },
  { re: /(endif)/, handler: endIfHandler },
  { re: /(if)\s+(?:(not)\s+)?(\w+)?/, handler: ifStatementHandler },
];

function jinjaStatement(match: RegExpExecArray): Token[] {
  const endIndex = match[0].indexOf(match[3], match[1].length);
  const startToken: Token = {
    startIndex: match.index,
    length: match[1].length,
    token: PromptySemanticTokenTypes.PunctuationTemplateBegin,
  };
  const endToken: Token = {
    startIndex: match.index + endIndex,
    length: match[3].length,
    token: PromptySemanticTokenTypes.PunctuationTemplateEnd,
  };
  const contentIndex = match.index + match[0].indexOf(match[2], match[1].length);
  for (const { re, handler } of jinjaStatementHandlers) {
    const regex = new RegExp(re);
    const statementMatch = regex.exec(match[2]);
    if (statementMatch) {
      return [startToken, ...handler(contentIndex, statementMatch), endToken];
    }
  }
  return [];
}

const jinjaHandlers = [
  { re: /(\{\{)(?:(.*?)(\}\}))?/gs, handler: jinjaExpression },
  { re: /(\{%)\s*(?:(.+?)?\s*(%\}))/g, handler: jinjaStatement },
];

export function jinjaTokens(text: string): Token[] {
  const tokens: Token[] = [];
  for (const { re, handler } of jinjaHandlers) {
    const regex = new RegExp(re);
    let match;
    while ((match = regex.exec(text)) != null) {
      const t = handler(match);
      tokens.push(...t);
    }
  }

  return tokens.sort((a, b) => a.startIndex - b.startIndex);
}
