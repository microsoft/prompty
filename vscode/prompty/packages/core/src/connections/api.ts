import { IConnectionProvider, ConnectionProfile, ProviderRegistration } from "./types";

/**
 * Public API exported by the Prompty extension.
 * External extensions can use this to register connection providers.
 *
 * Usage from another extension:
 * ```typescript
 * const prompty = vscode.extensions.getExtension('microsoft.prompty');
 * const api: PromptyExtensionAPI = await prompty.activate();
 * const registration = api.registerConnectionProvider(myProvider);
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
