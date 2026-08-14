import "@typra/emitter";

namespace Prompty;

// Behavior vectors for the Parser.parse callable seam, migrated from
// spec/vectors/parse/parse_vectors.json. Bound to:
//   parse(agent: Agent, rendered: string, context?: Record<unknown>): Message[]
// Encoding notes:
//   - parse is agent-independent (role-marker splitting), so agent = #{} (empty;
//     every Agent field is optional/defaulted).
//   - rendered maps 1:1. The JSON thread_inputs maps to the context param
//     (keyed by input name, e.g. conversation), which the thread-nonce
//     expansion consumes.
//   - expected is authored in canonical Message MODEL form: JSON content ->
//     model parts; each { kind: text, value } already matches TextPart;
//     required metadata is set to an empty record. The JSON .messages wrapper
//     is unwrapped to the bare Message[] the op returns.
const ParseVectors = #[
  #{
    name: "single_system",
    stage: "callable",
    input: #{ agent: #{}, rendered: "system:\nYou are helpful." },
    expected: #[#{ role: "system", parts: #[#{ kind: "text", value: "You are helpful." }], metadata: #{} }]
  },
  #{
    name: "system_user",
    stage: "callable",
    input: #{ agent: #{}, rendered: "system:\nYou are helpful.\n\nuser:\nHello" },
    expected: #[#{ role: "system", parts: #[#{ kind: "text", value: "You are helpful." }], metadata: #{} }, #{ role: "user", parts: #[#{ kind: "text", value: "Hello" }], metadata: #{} }]
  },
  #{
    name: "system_user_assistant",
    stage: "callable",
    input: #{ agent: #{}, rendered: "system:\nBe concise.\n\nuser:\nHi\n\nassistant:\nHello! How can I help?" },
    expected: #[#{ role: "system", parts: #[#{ kind: "text", value: "Be concise." }], metadata: #{} }, #{ role: "user", parts: #[#{ kind: "text", value: "Hi" }], metadata: #{} }, #{ role: "assistant", parts: #[#{ kind: "text", value: "Hello! How can I help?" }], metadata: #{} }]
  },
  #{
    name: "multiline_content",
    stage: "callable",
    input: #{ agent: #{}, rendered: "system:\nLine one.\nLine two.\nLine three.\n\nuser:\nQuestion" },
    expected: #[#{ role: "system", parts: #[#{ kind: "text", value: "Line one.\nLine two.\nLine three." }], metadata: #{} }, #{ role: "user", parts: #[#{ kind: "text", value: "Question" }], metadata: #{} }]
  },
  #{
    name: "multiple_user_turns",
    stage: "callable",
    input: #{ agent: #{}, rendered: "system:\nHelper\n\nuser:\nFirst question\n\nassistant:\nFirst answer\n\nuser:\nSecond question" },
    expected: #[#{ role: "system", parts: #[#{ kind: "text", value: "Helper" }], metadata: #{} }, #{ role: "user", parts: #[#{ kind: "text", value: "First question" }], metadata: #{} }, #{ role: "assistant", parts: #[#{ kind: "text", value: "First answer" }], metadata: #{} }, #{ role: "user", parts: #[#{ kind: "text", value: "Second question" }], metadata: #{} }]
  },
  #{
    name: "no_role_marker_defaults_to_system",
    stage: "callable",
    input: #{ agent: #{}, rendered: "Just a plain message with no role marker" },
    expected: #[#{ role: "system", parts: #[#{ kind: "text", value: "Just a plain message with no role marker" }], metadata: #{} }]
  },
  #{
    name: "content_trimmed",
    stage: "callable",
    input: #{ agent: #{}, rendered: "system:\n  \n  You are helpful.  \n  \n\nuser:\n  Hello  " },
    expected: #[#{ role: "system", parts: #[#{ kind: "text", value: "  \n  You are helpful.  \n  " }], metadata: #{} }, #{ role: "user", parts: #[#{ kind: "text", value: "  Hello  " }], metadata: #{} }]
  },
  #{
    name: "empty_content",
    stage: "callable",
    input: #{ agent: #{}, rendered: "system:\n\nuser:\nHello" },
    expected: #[#{ role: "system", parts: #[#{ kind: "text", value: "" }], metadata: #{} }, #{ role: "user", parts: #[#{ kind: "text", value: "Hello" }], metadata: #{} }]
  },
  #{
    name: "role_marker_at_line_start_only",
    stage: "callable",
    input: #{ agent: #{}, rendered: "system:\nThe user: said hello\n\nuser:\nHi" },
    expected: #[#{ role: "system", parts: #[#{ kind: "text", value: "The user: said hello" }], metadata: #{} }, #{ role: "user", parts: #[#{ kind: "text", value: "Hi" }], metadata: #{} }]
  },
  #{
    name: "thread_nonce_expansion",
    stage: "callable",
    input: #{ agent: #{}, rendered: "system:\nYou are helpful.\n\n__PROMPTY_THREAD_abcd1234_conversation__\n\nuser:\nHi", context: #{ conversation: #[#{ role: "user", parts: #[#{ kind: "text", value: "prev question" }], metadata: #{} }, #{ role: "assistant", parts: #[#{ kind: "text", value: "prev answer" }], metadata: #{} }] } },
    expected: #[#{ role: "system", parts: #[#{ kind: "text", value: "You are helpful." }], metadata: #{} }, #{ role: "user", parts: #[#{ kind: "text", value: "prev question" }], metadata: #{} }, #{ role: "assistant", parts: #[#{ kind: "text", value: "prev answer" }], metadata: #{} }, #{ role: "user", parts: #[#{ kind: "text", value: "Hi" }], metadata: #{} }]
  },
  #{
    name: "markdown_in_content",
    stage: "callable",
    input: #{ agent: #{}, rendered: "system:\n# Title\n\nSome **bold** text\n\n- item 1\n- item 2\n\nuser:\nHello" },
    expected: #[#{ role: "system", parts: #[#{ kind: "text", value: "# Title\n\nSome **bold** text\n\n- item 1\n- item 2" }], metadata: #{} }, #{ role: "user", parts: #[#{ kind: "text", value: "Hello" }], metadata: #{} }]
  },
  #{
    name: "consecutive_newlines_between_roles",
    stage: "callable",
    input: #{ agent: #{}, rendered: "system:\nHelper\n\n\n\nuser:\nHi" },
    expected: #[#{ role: "system", parts: #[#{ kind: "text", value: "Helper" }], metadata: #{} }, #{ role: "user", parts: #[#{ kind: "text", value: "Hi" }], metadata: #{} }]
  },
  #{
    name: "assistant_with_code_block",
    stage: "callable",
    input: #{ agent: #{}, rendered: "assistant:\nHere is code:\n```python\nprint('hello')\n```\n\nuser:\nThanks" },
    expected: #[#{ role: "assistant", parts: #[#{ kind: "text", value: "Here is code:\n```python\nprint('hello')\n```" }], metadata: #{} }, #{ role: "user", parts: #[#{ kind: "text", value: "Thanks" }], metadata: #{} }]
  },
  #{
    name: "multiple_assistant_turns",
    stage: "callable",
    input: #{ agent: #{}, rendered: "system:\nYou are helpful.\n\nuser:\nHi\n\nassistant:\nHello!\n\nuser:\nThanks\n\nassistant:\nYou're welcome!" },
    expected: #[#{ role: "system", parts: #[#{ kind: "text", value: "You are helpful." }], metadata: #{} }, #{ role: "user", parts: #[#{ kind: "text", value: "Hi" }], metadata: #{} }, #{ role: "assistant", parts: #[#{ kind: "text", value: "Hello!" }], metadata: #{} }, #{ role: "user", parts: #[#{ kind: "text", value: "Thanks" }], metadata: #{} }, #{ role: "assistant", parts: #[#{ kind: "text", value: "You're welcome!" }], metadata: #{} }]
  },
  #{
    name: "role_marker_colon_in_content",
    stage: "callable",
    input: #{ agent: #{}, rendered: "system:\nHere is a tip: always be kind.\n\nuser:\nTime is 3:30pm" },
    expected: #[#{ role: "system", parts: #[#{ kind: "text", value: "Here is a tip: always be kind." }], metadata: #{} }, #{ role: "user", parts: #[#{ kind: "text", value: "Time is 3:30pm" }], metadata: #{} }]
  }
];
