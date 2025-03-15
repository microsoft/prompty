// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
  createConnection,
  InitializeParams,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  Range,
  Position,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { Logger } from "./util/logger";
import { Language, getCompletionProvider, getTokensProvider } from "./languages/index";
import { getSemanticTokenLegend } from "./util/semantic-tokens";
import { DocumentMetadataStore } from "./util/document-metadata";
import { getLanguageService as getYAMLLanguageServer } from "yaml-language-server";
import { URI } from "vscode-uri";
import * as fs from "fs/promises";
import { VirtualDocument } from "./util/virtual-document";


// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

const logger = new Logger(connection.console);

const schemaRequestService = async (uri: string): Promise<string> => {
  logger.debug(`Fetching schema for ${uri}`);
  if (/^file:\/\//.test(uri)) {
    const fsPath = URI.parse(uri).fsPath;
    const schema = await fs.readFile(fsPath, { encoding: "utf-8"});
    return schema;
  }
  throw new Error(`Unsupported schema URI: ${uri}`);
};

const yamlLanguageServer = getYAMLLanguageServer({
  schemaRequestService,
  workspaceContext: {
    resolveRelativePath: (relativePath: string) => {
      return URI.file(relativePath).toString();
    },
  },
});

// Create a simple text document manager. The text document manager
// supports full document sync only
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

const documentMetadata = new DocumentMetadataStore(logger);

connection.onInitialize((params: InitializeParams) => {
  logger.debug(`Initializing server for ${params.clientInfo?.name || "unknown"}`);
  documents.onDidOpen((e) => {
    logger.debug(`Document opened: ${e.document.uri}`);
    documentMetadata.set(e.document);
  });

  documents.onDidClose((e) => {
    logger.debug(`Document closed: ${e.document.uri}`);
    documentMetadata.delete(e.document.uri);
  });

  connection.onShutdown(() => {
    logger.debug("Shutting down...");
  });

  connection.onRequest("textDocument/semanticTokens/full", async (params) => {
    logger.debug("Received request for semantic tokens");

    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return null;
    }
    const metadata = documentMetadata.get(document);

    if (!metadata.frontMatterStart && !metadata.frontMatterEnd) {
      return null;
    }

		/*
    const yamlRange = Range.create(
      Position.create(metadata.frontMatterStart! + 1, 0),
      Position.create(metadata.frontMatterEnd! - 1, 0)
    );
		*/

    const markdownRange = Range.create(
      Position.create(metadata.frontMatterEnd! + 1, 0),
      Position.create(document.lineCount, 0)
    );

    const markdownTokens = getTokensProvider(Language.Markdown).full(document, markdownRange);

    return {
      data: [...markdownTokens.data],
      resultId: markdownTokens.resultId,
    };
  });

  const { yamlSchemaPath } = params.initializationOptions;

  yamlLanguageServer.configure({
    customTags: [],
    completion: true,
    validate: true,
    hover: true,
    format: true,
    schemas: [
      {
        fileMatch: ["*.prompty"],
        uri: URI.file(yamlSchemaPath).toString(),
        name: "prompty",
      },
    ],
  });

  return {
    capabilities: {
      semanticTokensProvider: {
        documentSelector: { scheme: "file", language: "prompty" },
        legend: getSemanticTokenLegend(),
        full: true,
      },
      textDocumentSync: TextDocumentSyncKind.Full,
      hoverProvider: true,
      documentOnTypeFormattingProvider: {
        firstTriggerCharacter: ":",
        moreTriggerCharacter: ["\n"],
      },
      // Tell the client that the server supports code completion
      completionProvider: {
        resolveProvider: false,
        /* This config should come from the config of the document (template engine) */
        triggerCharacters: ["{", ":"],
      },
    },
  };
});

connection.onDidChangeConfiguration(() => {
  logger.debug("Configuration changed");
  // Revalidate all open text documents
  documents.all().forEach(validateTextDocument);
});

documents.onDidChangeContent((change) => {
  documentMetadata.set(change.document);
  validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument) {
  const metadata = documentMetadata.get(textDocument);
  if (metadata.frontMatterStart === undefined) {
    return;
  }
  if (metadata.frontMatterEnd === undefined) {
    return;
  }
  const virtualDocument = new VirtualDocument(
    textDocument,
    metadata.frontMatterStart + 1,
    metadata.frontMatterEnd - 1
  );
  await validateYAMLDocument(virtualDocument);
}

async function validateYAMLDocument(textDocument: VirtualDocument) {
  logger.debug(`Validating document: ${textDocument.uri}`);
  const virtualYamlDiagnostics = await yamlLanguageServer.doValidation(textDocument, false);
  const yamlDiagnostics = virtualYamlDiagnostics
    .filter((d) => {
      const diagnosticText = textDocument.getText(d.range).trim();
      return !/\$\{[^}]+\}/.test(diagnosticText);
    })
    .map((s) => {
      return {
        ...s,
        range: {
          start: textDocument.toRealPosition(s.range.start),
          end: textDocument.toRealPosition(s.range.end),
        },
      };
    });
  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: yamlDiagnostics });
}

connection.onCompletion(async (textDocumentPosition) => {
  const document = documents.get(textDocumentPosition.textDocument.uri);
  if (!document) {
    return null;
  }
  const metadata = documentMetadata.get(document);

  if (metadata.frontMatterStart === undefined) {
    return [
      {
        label: "---\n",
      },
    ];
  }

  if (metadata.frontMatterEnd === undefined) {
    const yamlCompletions = await yamlLanguageServer.doComplete(
      document,
      textDocumentPosition.position,
      false
    );
    return [
      {
        label: "---\n",
      },
    ].concat(yamlCompletions.items || []);
  }

  const { line } = textDocumentPosition.position;

  if (line <= metadata.frontMatterStart) {
    return null;
  } else if (line < metadata.frontMatterEnd) {
    const yamlCompletions = await yamlLanguageServer.doComplete(
      document,
      textDocumentPosition.position,
      false
    );
    return yamlCompletions.items || [];
  } else if (line > metadata.frontMatterEnd) {
    return getCompletionProvider(Language.Markdown).provideCompletionItems(
      document,
      metadata,
      textDocumentPosition.position
    );
  }
  return null;
});

connection.onHover(async (textDocumentPosition) => {
  const document = documents.get(textDocumentPosition.textDocument.uri);
  if (!document) {
    return null;
  }
  const metadata = documentMetadata.get(document);

  if (metadata.frontMatterStart === undefined) {
    return null;
  }

  if (metadata.frontMatterEnd === undefined) {
    return null;
  }

  const { line } = textDocumentPosition.position;

  if (line <= metadata.frontMatterStart) {
    return null;
  } else if (line < metadata.frontMatterEnd) {
    const hover = await yamlLanguageServer.doHover(document, textDocumentPosition.position);
    return hover;
  }
  return null;
});

connection.onDocumentOnTypeFormatting(async (params) => {
  const { textDocument, position } = params;
  const document = documents.get(textDocument.uri);
  if (!document) {
    return null;
  }
  const metadata = documentMetadata.get(document);

  if (metadata.frontMatterStart === undefined) {
    return null;
  }

  if (metadata.frontMatterEnd === undefined) {
    return null;
  }

  const { line } = position;

  if (line <= metadata.frontMatterStart) {
    return null;
  } else if (line < metadata.frontMatterEnd) {
    return await yamlLanguageServer.doDocumentOnTypeFormatting(document, params);
  }
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
