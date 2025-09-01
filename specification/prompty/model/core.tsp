namespace Prompty.Core {
  model Named<Item, StringValue extends valueof string = "Name of the item"> {
    @doc(StringValue)
    name: string = "";

    ...Item;
  }

  /**
   * Generic options available for certain models, configurations, or tools.
   * This can include additional settings or parameters that are not strictly defined
   * and are used by various providers to specify custom behavior or metadata.
   * 
   * Example:
   * ```yaml
   * options:
   *   customSetting: true
   *   timeout: 5000
   *   retryAttempts: 3
   *  ```
   */
  model Options {
    ...Record<unknown>;
  }

  alias SimpleTypes = "string" | "number" | "array" | "object" | "boolean" | string;
}
