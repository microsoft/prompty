import * as vscode from "vscode";
import {
	IConnectionProvider,
	ConnectionProfile,
	ConnectionProviderType,
	ProviderRegistration,
	ConnectionsChangedEvent,
} from "./types";

/**
 * Central registry for connection providers.
 * Built-in providers are registered at activation.
 * External extensions can register via the exported API.
 */
export class ConnectionProviderRegistry {
	private readonly providers = new Map<string, IConnectionProvider>();
	private readonly _onProvidersChanged =
		new vscode.EventEmitter<IConnectionProvider[]>();

	/** Fires when providers are added or removed */
	readonly onProvidersChanged = this._onProvidersChanged.event;

	/**
	 * Register a connection provider.
	 * @returns A disposable that unregisters the provider when disposed.
	 */
	registerProvider(provider: IConnectionProvider): ProviderRegistration {
		if (this.providers.has(provider.id)) {
			throw new Error(
				`Connection provider "${provider.id}" is already registered.`
			);
		}
		this.providers.set(provider.id, provider);
		this._onProvidersChanged.fire(this.getAllProviders());

		return new vscode.Disposable(() => {
			this.providers.delete(provider.id);
			this._onProvidersChanged.fire(this.getAllProviders());
		});
	}

	/** Get a provider by its ID */
	getProvider(id: string): IConnectionProvider | undefined {
		return this.providers.get(id);
	}

	/** Get the provider that handles a given provider type */
	getProviderForType(
		providerType: ConnectionProviderType
	): IConnectionProvider | undefined {
		for (const provider of this.providers.values()) {
			if (provider.providerTypes.includes(providerType)) {
				return provider;
			}
		}
		return undefined;
	}

	/** Get all registered providers */
	getAllProviders(): IConnectionProvider[] {
		return Array.from(this.providers.values());
	}

	/** Test a connection using its provider */
	async testConnection(
		profile: ConnectionProfile,
		secret?: string
	): Promise<{ success: boolean; message: string }> {
		const provider = this.getProviderForType(profile.providerType);
		if (!provider) {
			return {
				success: false,
				message: `No provider registered for type "${profile.providerType}"`,
			};
		}
		return provider.testConnection(profile, secret);
	}

	/** Create a client for a connection */
	async createClient(
		profile: ConnectionProfile,
		secret?: string
	): Promise<unknown> {
		const provider = this.getProviderForType(profile.providerType);
		if (!provider) {
			throw new Error(
				`No provider registered for type "${profile.providerType}"`
			);
		}
		return provider.createClient(profile, secret);
	}

	dispose(): void {
		this._onProvidersChanged.dispose();
	}
}
