namespace Prompty.Core {
  /**
   *
   * Metadata model that can be used to store additional information about the model.
   * This can include arbitrary key-value pairs that provide context or configuration
   * for the model's behavior or usage.
   *
   * Example:
   * ```yaml
   * metadata:
   *   organization: Example Corp
   *   authors:
   *     - name: John Doe
   *       email: john.doe@example.com
   *       affiliation: Example Corp
   *   tags:
   *     - tag1
   *     - tag2
   *     - tag3
   * ```
   */
  model Metadata {
    ...Record<unknown>;
  }
}
