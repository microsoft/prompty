import "./prompty.tsp";

@service(#{ title: "Prompty" })
namespace Prompty {
	/**
	 * Load a Prompty document from a file path.
	 * @param path The file path to load the Prompty document from.
	 * @param config Optional configuration name to use for hoisting from a config file.
	 * @returns The loaded Prompty model.
	 */
	op load(path: string, config?: string = "default"): Prompty.Core.Prompty;

	/**
	 * Prepare a Prompty document for execution.
	 * This method processes the inputs and merges sample values if specified.
	 * @param prompty The Prompty model to prepare.
	 * @param inputs  Optional inputs to merge, replace, or fill the Prompty inputs.
	 * @param mergeSample Whether to merge sample values from the inputs into the Prompty document.
	 * @returns The prepared object / array used to execute against the underlying provider.
	 */
	op prepare(
		prompty: Prompty.Core.Prompty,
		inputs?: Record<unknown> = #{},
		mergeSample?: boolean = true,
	): unknown;

	/**
	 * Run a Prompty document with the provided content and connection options.
	 * @param prompty The Prompty model or its identifier to execute.
	 * @param content The content to process, can be an object, array, or string - this represents the prepared content.
	 * @param connection Optional connection configuration for hoisting into the Model connection.
	 * @param options Optional execution options for hoisting into the Model options.
	 * @param raw Whether to return raw output without the processing step.
	 * @returns The result of the execution.
	 */
	op run(
		prompty: Prompty.Core.Prompty,
		content: Record<unknown> | Array<unknown> | string,
		connection?: Record<unknown> = #{},
		options?: Record<unknown> = #{},
		raw?: boolean = false,
	): unknown;

	/**
	 * Execute a Prompty document with the provided configuration.
	 * This method is a higher-level abstraction that combines (optionally) loading, preparing, and running the Prompty document.
	 * @param prompty The Prompty model or its identifier to execute.
	 * @param connection Optional connection configuration for hoisting into the Model connection.
	 * @param options Optional execution options for hoisting into the Model options.
	 * @param inputs Optional inputs to merge, replace, or fill the Prompty inputs.
	 * @param raw Whether to return raw output without the processing step.
	 * @param mergeSample Whether to merge sample values from the inputs into the Prompty document.
	 * @param config Optional configuration name to use for hoisting from a config file.
	 * @returns The result of the execution.
	 */
	op execute(
		prompty: Prompty.Core.Prompty | string,
		connection?: Record<unknown> = #{},
		options?: Record<unknown> = #{},
		inputs: Record<unknown> = #{},
		raw?: boolean = false,
		mergeSample: boolean = true,
		config?: string = "default",
	): unknown;



  /**
   * Publish Prompty document as a provider agent.
   * This method allows the Prompty document to be used as a standalone agent.
   * @param prompty The Prompty model or its identifier to publish.
   * @param connection Optional connection configuration for hoisting into the Model connection.
   * @param options Optional execution options for hoisting into the Model options.
   * @returns The result of the publication.
   */
  op publish(
    prompty: Prompty.Core.Prompty | string,
    connection?: Record<unknown> = #{},
    options?: Record<unknown> = #{},
    config?: string = "default",
  ): unknown;
}
