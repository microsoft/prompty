import * as vscode from "vscode";

// ─── Connection Profile Types ─────────────────────────────────────────

/** Authentication method for a connection */
export type ConnectionAuthType =
	| "api-key"
	| "azure-default-credential"
	| "anonymous";

/** Supported AI provider types */
export type ConnectionProviderType =
	| "openai"
	| "azure-openai"
	| "anthropic"
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

/** OpenAI connection profile */
export interface OpenAIConnectionProfile extends BaseConnectionProfile {
	providerType: "openai";
	authType: "api-key";
	/** API base URL (defaults to https://api.openai.com/v1) */
	baseUrl?: string;
	/** Default model to use */
	model?: string;
}

/** Azure OpenAI connection with API key */
export interface AzureKeyConnectionProfile extends BaseConnectionProfile {
	providerType: "azure-openai";
	authType: "api-key";
	/** Azure OpenAI endpoint (e.g., https://{resource}.openai.azure.com/) */
	endpoint: string;
	/** Default deployment name */
	deployment?: string;
	/** API version (defaults to latest) */
	apiVersion?: string;
}

/** Azure OpenAI connection with DefaultAzureCredential */
export interface AzureCredentialConnectionProfile
	extends BaseConnectionProfile {
	providerType: "azure-openai";
	authType: "azure-default-credential";
	/** Azure OpenAI endpoint */
	endpoint: string;
	/** Default deployment name */
	deployment?: string;
	/** API version */
	apiVersion?: string;
}

/** Anthropic connection profile */
export interface AnthropicConnectionProfile extends BaseConnectionProfile {
	providerType: "anthropic";
	authType: "api-key";
	/** API base URL (defaults to https://api.anthropic.com) */
	baseUrl?: string;
	/** Default model to use */
	model?: string;
}

/** Union of all built-in connection profile types */
export type ConnectionProfile =
	| OpenAIConnectionProfile
	| AzureKeyConnectionProfile
	| AzureCredentialConnectionProfile
	| AnthropicConnectionProfile
	| BaseConnectionProfile;

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
