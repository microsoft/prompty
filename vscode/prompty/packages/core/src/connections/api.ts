import { IConnectionProvider, ConnectionProfile, ProviderRegistration } from "./types";
import type { Executor, Processor } from "@prompty/core";

/**
 * Public API exported by the Prompty extension.
 * External extensions can use this to register connection providers
 * and runtime executor/processor implementations.
 *
 * Usage from another extension:
 * ```typescript
 * const prompty = vscode.extensions.getExtension('microsoft.prompty');
 * const api: PromptyExtensionAPI = await prompty.activate();
 *
 * // Register connection UI
 * const registration = api.registerConnectionProvider(myProvider);
 *
 * // Register runtime executor/processor
 * api.registerExecutor('my-provider', new MyExecutor());
 * api.registerProcessor('my-provider', new MyProcessor());
 *
 * // Later: registration.dispose() to unregister
 * ```
 */
export interface PromptyExtensionAPI {
	/**
	 * Register a connection provider.
	 * The provider will appear in the Connections sidebar and its
	 * connections will be available for prompt execution.
	 * @returns A disposable that unregisters the provider when disposed.
	 */
	registerConnectionProvider(
		provider: IConnectionProvider
	): ProviderRegistration;

	/**
	 * Register a runtime executor for a provider key.
	 * The executor handles sending messages to an LLM provider.
	 * @param key - Provider key (e.g., "google", "anthropic")
	 * @param executor - Executor implementation
	 */
	registerExecutor(key: string, executor: Executor): void;

	/**
	 * Register a runtime processor for a provider key.
	 * The processor extracts clean results from raw LLM responses.
	 * @param key - Provider key (e.g., "google", "anthropic")
	 * @param processor - Processor implementation
	 */
	registerProcessor(key: string, processor: Processor): void;

	/**
	 * Get all configured connection profiles.
	 */
	getConnections(): Promise<ConnectionProfile[]>;

	/**
	 * Event fired when connections are added, removed, or updated.
	 */
	onConnectionsChanged: (
		listener: (profiles: ConnectionProfile[]) => void
	) => { dispose(): void };
}
