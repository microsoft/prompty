// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextDocument } from "vscode-languageserver-textdocument";
import { Range, SemanticTokens } from "vscode-languageserver";
import { SemanticTokenProvider } from "./index";

export class YAMLTokenProvider implements SemanticTokenProvider {
  private static instance?: YAMLTokenProvider;

  private constructor() {}

  public static getInstance(): YAMLTokenProvider {
    if (!YAMLTokenProvider.instance) {
      YAMLTokenProvider.instance = new YAMLTokenProvider();
    }
    return YAMLTokenProvider.instance;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  full(document: TextDocument, range: Range): SemanticTokens {
    return {
      data: [],
      resultId: "",
    };
  }
}
