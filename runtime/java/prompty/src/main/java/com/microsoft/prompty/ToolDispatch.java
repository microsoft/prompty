package com.microsoft.prompty;

import com.microsoft.prompty.model.Binding;
import com.microsoft.prompty.model.Agent;
import com.microsoft.prompty.model.Tool;
import com.microsoft.prompty.model.ToolCall;
import com.microsoft.prompty.model.TypraJson;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Resolves a tool call to an implementation and runs it.
 *
 * <p>Dispatch is deliberately total: every path returns text, including the failures. A tool that
 * is missing, that was called with unparseable arguments, or that threw is reported back to the
 * model as an {@code "Error: ..."} string rather than raised. The model is the component best
 * placed to recover — it can correct the arguments, choose a different tool, or explain the
 * limitation to the user — and a turn that unwound instead would throw that opportunity away.
 *
 * <p>Implementations are resolved in three layers, most specific first: handlers passed in
 * {@link TurnOptions}, then globally registered handlers by tool name, then a handler registered
 * for the tool's {@code kind} (falling back to a {@code "*"} wildcard). This lets a caller override
 * one tool for one turn without disturbing anything registered process-wide.
 */
public final class ToolDispatch {

  private static final Map<String, ToolHandler> NAMED = new ConcurrentHashMap<>();
  private static final Map<String, KindHandler> BY_KIND = new ConcurrentHashMap<>();

  /** Longest prefix of unparseable arguments quoted back in an error. */
  private static final int ERROR_EXCERPT_CHARS = 200;

  private static final Pattern CODE_FENCE =
      Pattern.compile("^\\s*```(?:json)?\\s*\\n?(.*?)\\n?\\s*```\\s*$", Pattern.DOTALL);

  private static final Pattern TRAILING_COMMA = Pattern.compile(",\\s*([}\\]])");

  private ToolDispatch() {}

  /** Runs any tool of a given {@code kind}, using its declaration from the agent. */
  public interface KindHandler {
    String execute(Tool definition, Object arguments, Agent agent, Object parentInputs);
  }

  /** Register a handler for one tool name, visible to every turn in this process. */
  public static void registerTool(String name, ToolHandler handler) {
    NAMED.put(name, handler);
  }

  /** Whether a handler is registered for {@code name}. */
  public static boolean hasTool(String name) {
    return NAMED.containsKey(name);
  }

  /** Remove every globally registered tool handler. */
  public static void clearTools() {
    NAMED.clear();
  }

  /** Register a handler for every tool of one {@code kind}, or {@code "*"} for any kind. */
  public static void registerToolHandler(String kind, KindHandler handler) {
    BY_KIND.put(kind, handler);
  }

  /** Whether a handler is registered for {@code kind}. */
  public static boolean hasToolHandler(String kind) {
    return BY_KIND.containsKey(kind);
  }

  /** Remove every registered kind handler. */
  public static void clearToolHandlers() {
    BY_KIND.clear();
  }

  /**
   * Resolve and run one tool call.
   *
   * @param parentInputs the enclosing turn's inputs, used to satisfy the tool's bindings
   * @return the text to return to the model; never null, and prefixed {@code "Error: "} on failure
   */
  public static String dispatch(
      ToolCall toolCall,
      Map<String, ToolHandler> callerTools,
      Agent agent,
      Object parentInputs) {
    Object arguments;
    try {
      arguments = parseArguments(toolCall.arguments);
    } catch (IllegalArgumentException failure) {
      return "Error: Invalid tool arguments JSON: " + failure.getMessage();
    }

    if (parentInputs != null && arguments instanceof Map<?, ?>) {
      arguments = resolveBindings(agent, toolCall.name, arguments, parentInputs);
    }

    ToolHandler caller = callerTools == null ? null : callerTools.get(toolCall.name);
    if (caller != null) {
      return guard(caller, arguments);
    }

    ToolHandler named = NAMED.get(toolCall.name);
    if (named != null) {
      return guard(named, arguments);
    }

    Tool definition = findTool(agent, toolCall.name);
    if (definition != null) {
      KindHandler handler = BY_KIND.get(definition.kind == null ? "" : definition.kind);
      if (handler == null) {
        handler = BY_KIND.get("*");
      }
      if (handler != null) {
        try {
          return handler.execute(definition, arguments, agent, parentInputs);
        } catch (RuntimeException failure) {
          return "Error: " + describe(failure);
        }
      }
    }

    return "Error: No handler registered for tool '" + toolCall.name + "'";
  }

  /**
   * Inject values from the enclosing turn's inputs into a tool's arguments.
   *
   * <p>Bindings let a tool receive something the model was never told about — a tenant id, a
   * caller's identity — so it cannot be spoofed by the model choosing a different value. Bound
   * arguments therefore overwrite whatever the model supplied under the same name.
   */
  public static Object resolveBindings(
      Agent agent, String toolName, Object arguments, Object parentInputs) {
    if (!(parentInputs instanceof Map<?, ?> parents) || !(arguments instanceof Map<?, ?> args)) {
      return arguments;
    }
    Tool definition = findTool(agent, toolName);
    if (definition == null || definition.bindings == null || definition.bindings.isEmpty()) {
      return arguments;
    }
    Map<String, Object> merged = new LinkedHashMap<>();
    for (Map.Entry<?, ?> entry : args.entrySet()) {
      merged.put(String.valueOf(entry.getKey()), entry.getValue());
    }
    for (Binding binding : definition.bindings) {
      if (binding == null || binding.name == null || binding.input == null) {
        continue;
      }
      if (parents.containsKey(binding.input)) {
        merged.put(binding.name, parents.get(binding.input));
      }
    }
    return merged;
  }

  /**
   * Parse tool arguments, tolerating the ways models commonly mangle JSON.
   *
   * <p>Models wrap JSON in markdown fences, prepend explanations, and leave trailing commas.
   * Rejecting those outright would fail a turn over formatting when the intent is unambiguous, so
   * each is recovered in turn: exact parse, then fence stripping, then extracting the first
   * balanced object, then removing trailing commas.
   *
   * @throws IllegalArgumentException if no strategy yields valid JSON
   */
  public static Object parseArguments(String raw) {
    String text = raw == null ? "" : raw;
    if (text.isBlank()) {
      return new LinkedHashMap<String, Object>();
    }

    Object direct = tryParse(text);
    if (direct != NOT_JSON) {
      return direct;
    }

    Matcher fenced = CODE_FENCE.matcher(text);
    if (fenced.matches()) {
      String stripped = fenced.group(1);
      if (!stripped.equals(text)) {
        Object parsed = tryParse(stripped);
        if (parsed != NOT_JSON) {
          return parsed;
        }
      }
    }

    String block = firstJsonObject(text);
    if (block != null) {
      Object parsed = tryParse(block);
      if (parsed != NOT_JSON) {
        return parsed;
      }
    }

    String cleaned = TRAILING_COMMA.matcher(text).replaceAll("$1");
    if (!cleaned.equals(text)) {
      Object parsed = tryParse(cleaned);
      if (parsed != NOT_JSON) {
        return parsed;
      }
    }

    throw new IllegalArgumentException(
        "All JSON parse strategies failed for: "
            + text.substring(0, Math.min(ERROR_EXCERPT_CHARS, text.length())));
  }

  /** Sentinel distinguishing "parsed to null" from "did not parse". */
  private static final Object NOT_JSON = new Object();

  private static Object tryParse(String text) {
    try {
      return TypraJson.parse(text);
    } catch (RuntimeException notJson) {
      return NOT_JSON;
    }
  }

  /** Extract the first balanced {@code {...}} block, respecting strings and escapes. */
  private static String firstJsonObject(String text) {
    int start = text.indexOf('{');
    if (start < 0) {
      return null;
    }
    int depth = 0;
    boolean inString = false;
    boolean escaped = false;
    for (int i = start; i < text.length(); i++) {
      char ch = text.charAt(i);
      if (escaped) {
        escaped = false;
        continue;
      }
      if (inString) {
        if (ch == '\\') {
          escaped = true;
        } else if (ch == '"') {
          inString = false;
        }
        continue;
      }
      switch (ch) {
        case '"' -> inString = true;
        case '{' -> depth++;
        case '}' -> {
          depth--;
          if (depth == 0) {
            return text.substring(start, i + 1);
          }
        }
        default -> {}
      }
    }
    return null;
  }

  private static String guard(ToolHandler handler, Object arguments) {
    try {
      String result = handler.call(arguments);
      return result == null ? "" : result;
    } catch (RuntimeException failure) {
      return "Error: " + describe(failure);
    }
  }

  private static String describe(Throwable failure) {
    String message = failure.getMessage();
    return message == null || message.isEmpty() ? failure.getClass().getSimpleName() : message;
  }

  private static Tool findTool(Agent agent, String name) {
    if (agent == null || agent.tools == null || name == null) {
      return null;
    }
    for (Tool tool : agent.tools) {
      if (tool != null && name.equals(tool.name)) {
        return tool;
      }
    }
    return null;
  }
}
