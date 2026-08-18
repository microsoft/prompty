package com.microsoft.prompty;

import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.Role;
import com.microsoft.prompty.model.TextPart;
import com.microsoft.prompty.model.TypraJson;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Trims a conversation to fit a character budget.
 *
 * <p>The budget is measured in characters rather than tokens on purpose: tokenization is
 * provider- and model-specific, and a turn has to decide what to drop before it knows which
 * tokenizer applies. A character estimate is stable across providers and errs toward keeping
 * the conversation smaller than the real limit.
 *
 * <p>Character counts use UTF-16 code units, where the Rust reference counts UTF-8 bytes. The two
 * agree for ASCII and diverge for non-ASCII text, which shifts only where the trim boundary falls,
 * never which messages are structurally preserved.
 */
public final class Context {

  /** Per-message formatting overhead, on top of the role name. */
  private static final int ROLE_OVERHEAD = 4;

  /** What a non-text part (image, file, audio) is assumed to cost. */
  private static final int RICH_PART_CHARS = 200;

  /** Longest per-message excerpt kept in a summary. */
  private static final int SUMMARY_EXCERPT_CHARS = 200;

  /** Hard cap on a generated summary. */
  private static final int SUMMARY_MAX_CHARS = 4000;

  /** Ceiling on the share of the budget reserved for the summary message. */
  private static final int SUMMARY_BUDGET_CAP = 5000;

  /** Fraction of the budget reserved for the summary, as a divisor (20 → 5%). */
  private static final int SUMMARY_BUDGET_DIVISOR = 20;

  /** Non-system messages that are never dropped, however tight the budget. */
  private static final int MIN_KEPT_MESSAGES = 2;

  private Context() {}

  /** The result of a trim: what was dropped, and what remains. */
  public record Trimmed(List<Message> dropped, List<Message> messages) {}

  /** Estimate the character cost of a conversation. */
  public static int estimateChars(List<Message> messages) {
    if (messages == null) {
      return 0;
    }
    int total = 0;
    for (Message message : messages) {
      total += roleName(message).length() + ROLE_OVERHEAD;
      if (message.parts != null) {
        for (Object part : message.parts) {
          if (part instanceof TextPart text) {
            total += text.value == null ? 0 : text.value.length();
          } else {
            total += RICH_PART_CHARS;
          }
        }
      }
      if (message.metadata != null) {
        Object toolCalls = message.metadata.get("tool_calls");
        if (toolCalls != null) {
          total += TypraJson.stringify(toolCalls).length();
        }
      }
    }
    return total;
  }

  /** Summarize messages that are about to be dropped. */
  public static String summarizeDropped(List<Message> messages) {
    if (messages == null || messages.isEmpty()) {
      return "";
    }
    List<String> parts = new ArrayList<>(messages.size());
    for (Message message : messages) {
      String role = roleName(message);
      String text = Messages.text(message);
      if (text.isEmpty()) {
        parts.add("[" + role + " message]");
      } else {
        String truncated =
            text.length() > SUMMARY_EXCERPT_CHARS
                ? text.substring(0, SUMMARY_EXCERPT_CHARS) + "..."
                : text;
        parts.add("[" + role + "]: " + truncated);
      }
    }
    String summary = String.join("\n", parts);
    return summary.length() > SUMMARY_MAX_CHARS
        ? summary.substring(0, SUMMARY_MAX_CHARS) + "..."
        : summary;
  }

  /**
   * Trim a conversation to fit {@code budgetChars}.
   *
   * <p>Leading system messages are always preserved — they carry the agent's identity and
   * instructions, so dropping them changes what the agent is rather than merely what it remembers.
   * Beyond those, the oldest messages are dropped first and replaced by a single synthetic summary,
   * and at least {@value #MIN_KEPT_MESSAGES} non-system messages always survive so the model still
   * sees a real exchange.
   *
   * <p>Returns the input unchanged when it already fits, when there is too little to trim, or when
   * no single drop would help.
   */
  public static Trimmed trimToContextWindow(List<Message> messages, int budgetChars) {
    List<Message> all = messages == null ? List.of() : messages;
    if (estimateChars(all) <= budgetChars) {
      return new Trimmed(List.of(), new ArrayList<>(all));
    }

    int systemCount = 0;
    while (systemCount < all.size() && all.get(systemCount).role == Role.SYSTEM) {
      systemCount++;
    }
    List<Message> systemMessages = all.subList(0, systemCount);
    List<Message> rest = all.subList(systemCount, all.size());

    if (rest.size() <= MIN_KEPT_MESSAGES) {
      return new Trimmed(List.of(), new ArrayList<>(all));
    }

    int systemChars = estimateChars(systemMessages);
    int summaryBudget = Math.min(SUMMARY_BUDGET_CAP, budgetChars / SUMMARY_BUDGET_DIVISOR);
    int available = Math.max(0, budgetChars - (systemChars + summaryBudget));

    int dropCount = 0;
    int restChars = estimateChars(rest);
    int droppable = Math.max(0, rest.size() - MIN_KEPT_MESSAGES);
    while (restChars > available && dropCount < droppable) {
      restChars -= estimateChars(List.of(rest.get(dropCount)));
      dropCount++;
    }

    if (dropCount == 0) {
      return new Trimmed(List.of(), new ArrayList<>(all));
    }

    List<Message> dropped = new ArrayList<>(rest.subList(0, dropCount));
    List<Message> kept = rest.subList(dropCount, rest.size());

    List<Message> result = new ArrayList<>(systemMessages.size() + 1 + kept.size());
    result.addAll(systemMessages);
    result.add(
        Messages.user(
            "[Context summary: "
                + summarizeDropped(dropped)
                + "\n... ("
                + dropCount
                + " messages omitted)]"));
    result.addAll(kept);

    return new Trimmed(dropped, result);
  }

  /**
   * Render dropped messages as prompt text for a compaction summarizer.
   *
   * <p>Unlike {@link #summarizeDropped}, nothing is truncated: this feeds a model that is being
   * asked to produce the summary, so withholding content would degrade the very thing being built.
   */
  public static String formatDroppedMessages(List<Message> messages) {
    List<String> lines = new ArrayList<>();
    if (messages == null) {
      return "";
    }
    for (Message message : messages) {
      String role = roleName(message);
      String text = Messages.text(message);

      if (message.metadata != null
          && message.metadata.get("tool_calls") instanceof List<?> calls) {
        for (Object call : calls) {
          if (call instanceof Map<?, ?> map) {
            Object name = map.get("name");
            Object arguments = map.get("arguments");
            lines.add(
                "["
                    + role
                    + "]: Called: "
                    + (name instanceof String value ? value : "unknown")
                    + "("
                    + (arguments instanceof String value ? value : "{}")
                    + ")");
          }
        }
      }

      if (!text.isEmpty()) {
        lines.add("[" + role + "]: " + text);
      } else if (lines.isEmpty() || !lines.get(lines.size() - 1).startsWith("[" + role + "]")) {
        lines.add("[" + role + " message]");
      }
    }
    return String.join("\n", lines);
  }

  private static String roleName(Message message) {
    return message.role == null ? "" : message.role.value;
  }
}
