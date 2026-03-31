import * as vscode from "vscode";

// ─── Connection Profile Types ─────────────────────────────────────────

/** Authentication method for a connection — maps to AgentSchema Connection.kind */
export type ConnectionAuthType =
	| "key"                        // AgentSchema: ApiKeyConnection
	| "foundry"                    // AgentSchema: FoundryConnection (Entra ID)
	| "anonymous";                 // AgentSchema: AnonymousConnection

/** Supported AI provider types */
export type ConnectionProviderType =
	| "openai"
	| "anthropic"
	| "foundry"
	| string; // extensible for external providers

/** Connection health status */
export type ConnectionStatus =
	| "configured"
	| "missing-secret"
	| "error"
	| "untested";

/** Base connection profile — stored in .prompty/connections.json */
export interface BaseConnectionProfile {
	/** Unique identifier for this connection */
	id: string;
	/** Human-readable display name */
	name: string;
	/** Provider type (openai, azure-openai, anthropic, or custom) */
	providerType: ConnectionProviderType;
	/** Authentication method */
	authType: ConnectionAuthType;
	/** Whether this is the default connection for its provider type */
	isDefault?: boolean;
	/** Optional metadata */
	metadata?: Record<string, unknown>;
}

/** OpenAI connection profile — maps to AgentSchema ApiKeyConnection */
export interface OpenAIConnectionProfile extends BaseConnectionProfile {
	providerType: "openai";
	authType: "key";
	/** API base URL (defaults to https://api.openai.com/v1) — maps to ApiKeyConnection.endpoint */
	endpoint?: string;
	/** Default model to use */
	model?: string;
}

/** Anthropic connection profile — maps to AgentSchema ApiKeyConnection */
export interface AnthropicConnectionProfile extends BaseConnectionProfile {
	providerType: "anthropic";
	authType: "key";
	/** API base URL (defaults to https://api.anthropic.com) — maps to ApiKeyConnection.endpoint */
	endpoint?: string;
	/** Default model to use */
	model?: string;
}

/** Microsoft Foundry connection profile — maps to AgentSchema FoundryConnection */
export interface FoundryConnectionProfile extends BaseConnectionProfile {
	providerType: "foundry";
	authType: "foundry";
	/** Foundry project endpoint — maps to FoundryConnection.endpoint */
	endpoint: string;
	/** Named connection within the Foundry project — maps to FoundryConnection.name */
	connectionName?: string;
	/** Azure AD tenant ID — use when the resource is in a different tenant than the default credential */
	tenantId?: string;
	/** Always "model" for Foundry connections in Prompty */
	connectionType: "model";
}

/** Union of all built-in connection profile types */
export type ConnectionProfile =
	| OpenAIConnectionProfile
	| AnthropicConnectionProfile
	| FoundryConnectionProfile
	| BaseConnectionProfile;

// ─── Model Discovery Types ───────────────────────────────────────────

/** Discovered model from a connection */
export interface ModelInfo {
	/** Model ID / deployment name */
	id: string;
	/** Underlying model name (e.g., "gpt-4o" for a deployment named "my-gpt4") */
	modelName?: string;
	/** Owner or publisher */
	ownedBy?: string;
	/** Capabilities (e.g., chat_completion, embeddings) */
	capabilities?: Record<string, string>;
}

// ─── Connection Provider Interface ────────────────────────────────────

/** Result of testing a connection */
export interface ConnectionTestResult {
	success: boolean;
	message: string;
	/** Response time in ms (if successful) */
	latencyMs?: number;
}

/**
 * A connection provider contributes one or more connection types.
 * Built-in providers handle OpenAI, Azure, Anthropic.
 * External extensions can register additional providers via the API.
 */
export interface IConnectionProvider {
	/** Unique provider identifier */
	readonly id: string;
	/** Human-readable label for the sidebar */
	readonly label: string;
	/** Icon for the sidebar (ThemeIcon name or Uri) */
	readonly iconId: string;
	/** Provider types this provider handles */
	readonly providerTypes: ConnectionProviderType[];

	/**
	 * Get the fields required to create a connection of this type.
	 * Used by the wizard to build the input form.
	 */
	getConfigurationFields(
		providerType: ConnectionProviderType
	): ConnectionField[];

	/**
	 * Test whether a connection is working.
	 * @param profile The connection profile
	 * @param secret The API key (if applicable)
	 */
	testConnection(
		profile: ConnectionProfile,
		secret?: string
	): Promise<ConnectionTestResult>;

	/**
	 * Create an SDK client instance for the given profile.
	 * This client will be registered into the prompty runtime.
	 * @param profile The connection profile
	 * @param secret The API key (if applicable)
	 */
	createClient(profile: ConnectionProfile, secret?: string): Promise<unknown>;

	/**
	 * List available models for this connection.
	 * Returns undefined if model discovery is not supported.
	 */
	listModels?(
		profile: ConnectionProfile,
		secret?: string
	): Promise<ModelInfo[] | undefined>;
}

/** Field definition for the connection wizard */
export interface ConnectionField {
	/** Field key (maps to profile property) */
	key: string;
	/** Display label */
	label: string;
	/** Placeholder text */
	placeholder?: string;
	/** Whether the field is required */
	required: boolean;
	/** Whether this is a secret field (stored in SecretStorage) */
	isSecret?: boolean;
	/** Default value */
	defaultValue?: string;
	/** Validation pattern */
	validationPattern?: string;
	/** Validation message */
	validationMessage?: string;
}

// ─── Connection Store Types ───────────────────────────────────────────

/** Persisted connections file format (.prompty/connections.json) */
export interface ConnectionsFile {
	version: 1;
	connections: ConnectionProfile[];
}

// ─── Extension API Types ──────────────────────────────────────────────

/** Disposable registration handle */
export type ProviderRegistration = vscode.Disposable;

/** Event fired when connections change */
export interface ConnectionsChangedEvent {
	added?: ConnectionProfile[];
	removed?: ConnectionProfile[];
	updated?: ConnectionProfile[];
}
