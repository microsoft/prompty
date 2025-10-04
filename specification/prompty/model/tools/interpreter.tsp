import "../core.tsp";
import "../tools.tsp";

namespace Prompty.Core {
  /**
   * A tool for interpreting and executing code.
   * This tool allows an AI agent to run code snippets and analyze data files.
   */
  model CodeInterpreterTool extends Tool {
    @doc("The kind identifier for code interpreter tools")
    @sample(#{ kind: "code_interpreter" })
    kind: "code_interpreter";

    @doc("The IDs of the files to be used by the code interpreter tool.")
    @sample(#{ fileIds: #["file1", "file2"] })
    fileIds: string[];
  }
}
