namespace Prompty {
	model Prop {
		type: "string" | "number" | "array" | "object" | "boolean" = "string";
		description?: string = "";
	}

	model Property {
		name: string = "";
		...Prop;
	}

	model Input {
		...Property;
		required?: boolean = false;
		strict?: boolean = false;
		default?: unknown = null;
		sample?: unknown = null;
	}

	model Output {
		...Property;
		items?: Output[] = #[];
	}

	model Connection {
		type: string;
		...Record<unknown>;
	}

	model Model {
		id?: string = "";
		api: string = "";
		connection: Connection;
		options?: Record<unknown> = #{};
	}

	model Template {
		@doc("Template used for slot filling prompts")
		format: string;

		@doc("Parser used to process the rendered template")
		parser: string;

		@doc("Whether the template is strict or not")
		strict?: boolean = false;

		@doc("Options for the template")
		options?: Record<unknown> = #{};
	}

	model ToolParameter {
		...Property;
		required?: boolean = true;
		`enum`?: unknown[] = #[];
	}

	model FunctionTool {
		name: string;
		type: "function";
		description?: string = "";
		parameters: ToolParameter[] | Record<ToolParameter> = #[];
	}

	model ServerTool {
		name: string;
		type: string;
		description?: string = "";
		options: Record<unknown> = #{};
	}

	union Tool {
		function: FunctionTool,
		server: ServerTool,
	}

	model Prompty {
		// Prompty metadata
		@doc("Unique identifier for the Prompty document")
		id?: string = "";

		version?: string = "";
		name: string = "";
		description?: string = "";
		metadata?: Record<unknown> = #{};

		// model execution
		@doc("Model used for execution")
		`model`: Model;

		// Inputs and Outputs
		inputs: Input[] | Record<Input> = #[];

		outputs?: Output[] | Record<Output> = #[];

		// tools
		tools?: Tool[] | Record<Tool> = #[];

		// template values
		template?: Template;
	}
}
