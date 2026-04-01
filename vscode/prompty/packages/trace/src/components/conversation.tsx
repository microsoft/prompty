import styled from "styled-components";
import { TraceItem } from "../store";

interface ConversationMessage {
  role: string;
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
  parts?: Array<{ kind: string; value: string }>;
  metadata?: Record<string, unknown>;
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
`;

const Bubble = styled.div<{ $role: string }>`
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  background: ${(p) =>
    p.$role === "system"
      ? "var(--vscode-editor-background)"
      : p.$role === "assistant"
        ? "var(--vscode-editor-background)"
        : p.$role === "tool"
          ? "color-mix(in srgb, var(--vscode-charts-green) 8%, var(--vscode-editor-background))"
          : "color-mix(in srgb, var(--vscode-textLink-foreground) 8%, var(--vscode-editor-background))"};
  border: 1px solid ${(p) =>
    p.$role === "system"
      ? "var(--vscode-panel-border)"
      : p.$role === "assistant"
        ? "var(--vscode-panel-border)"
        : p.$role === "tool"
          ? "color-mix(in srgb, var(--vscode-charts-green) 20%, var(--vscode-panel-border))"
          : "color-mix(in srgb, var(--vscode-textLink-foreground) 20%, var(--vscode-panel-border))"};
`;

const RoleTag = styled.span<{ $role: string }>`
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 2px;
  display: inline-block;
  color: ${(p) =>
    p.$role === "system"
      ? "var(--vscode-descriptionForeground)"
      : p.$role === "assistant"
        ? "var(--vscode-textLink-foreground)"
        : p.$role === "tool"
          ? "var(--vscode-charts-green)"
          : "var(--vscode-charts-yellow)"};
`;

const ToolCallBox = styled.div`
  margin-top: 4px;
  padding: 6px 8px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 11px;
`;

const ToolName = styled.span`
  color: var(--vscode-charts-green);
  font-weight: 600;
`;

const ToolArgs = styled.div`
  color: var(--vscode-charts-orange);
  margin-top: 2px;
  white-space: pre-wrap;
`;

const IterationDivider = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  color: var(--vscode-descriptionForeground);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;

  &::before,
  &::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--vscode-panel-border);
  }
`;

/** Extract the text content from a message (handles both flat content and parts[] format) */
function getContent(msg: ConversationMessage): string {
  if (typeof msg.content === "string" && msg.content) return msg.content;
  if (Array.isArray(msg.content)) {
    return (msg.content as Array<{ kind?: string; value?: string; text?: string }>)
      .map((p) => p.value ?? p.text ?? "")
      .join("");
  }
  if (msg.parts && msg.parts.length > 0) {
    return msg.parts.map((p) => p.value).join("");
  }
  return "";
}

/**
 * Extract the full conversation from an executeAgent trace.
 *
 * Strategy:
 * 1. Start with the prepare result (initial messages after rendering)
 * 2. Walk each executor frame — its result shows what the LLM returned
 *    (including tool_calls). Its inputs.data shows any injected tool results.
 * 3. Build a linear message list with iteration markers.
 */
function extractConversation(trace: TraceItem): { messages: ConversationMessage[]; iterations: number } {
  const frames = trace.__frames ?? [];
  const allMessages: ConversationMessage[] = [];
  let iteration = 0;

  // Get initial messages from prepare result
  const prepareFrame = frames.find((f) => f.signature === "prompty.prepare");
  const initialMessages = (prepareFrame?.result ?? []) as ConversationMessage[];
  allMessages.push(...initialMessages);

  // Walk executor frames to build the conversation
  const executorFrames = frames.filter(
    (f) => f.signature?.includes("executor") && f.signature?.includes("invoke")
  );

  for (const execFrame of executorFrames) {
    iteration++;

    // Check if the executor input has tool messages that aren't in our list yet
    const inputData = (execFrame.inputs as Record<string, unknown>)?.data as ConversationMessage[] | undefined;
    if (inputData && iteration > 1) {
      // Find new messages (tool results) not in initial set
      for (const msg of inputData) {
        if (msg.role === "tool" || (msg.role === "assistant" && hasToolCalls(msg))) {
          const alreadyHas = allMessages.some(
            (m) => m.role === msg.role && getContent(m) === getContent(msg) && sameToolCalls(m, msg)
          );
          if (!alreadyHas) {
            allMessages.push(msg);
          }
        }
      }
    }

    // Get the LLM's response from the result
    const result = execFrame.result as Record<string, unknown> | undefined;
    const choices = result?.choices as Array<{ message: ConversationMessage }> | undefined;
    if (choices?.[0]?.message) {
      allMessages.push(choices[0].message);
    }
  }

  return { messages: allMessages, iterations: iteration };
}

function hasToolCalls(msg: ConversationMessage): boolean {
  if (msg.tool_calls && msg.tool_calls.length > 0) return true;
  if (msg.metadata && Array.isArray((msg.metadata as Record<string, unknown>).tool_calls)) return true;
  return false;
}

function getToolCalls(msg: ConversationMessage): ConversationMessage["tool_calls"] {
  if (msg.tool_calls) return msg.tool_calls;
  if (msg.metadata && Array.isArray((msg.metadata as Record<string, unknown>).tool_calls)) {
    return (msg.metadata as Record<string, unknown>).tool_calls as ConversationMessage["tool_calls"];
  }
  return undefined;
}

function sameToolCalls(a: ConversationMessage, b: ConversationMessage): boolean {
  const aCalls = getToolCalls(a);
  const bCalls = getToolCalls(b);
  if (!aCalls && !bCalls) return true;
  if (!aCalls || !bCalls) return false;
  return JSON.stringify(aCalls) === JSON.stringify(bCalls);
}

function formatArgs(argsStr: string): string {
  try {
    return JSON.stringify(JSON.parse(argsStr), null, 2);
  } catch {
    return argsStr;
  }
}

/** Check if this trace should show the Conversation tab */
export function isAgentTrace(trace: TraceItem): boolean {
  return trace.signature === "prompty.executeAgent" || trace.signature === "prompty.chatSession";
}

interface Props {
  trace: TraceItem;
}

const Conversation = ({ trace }: Props) => {
  if (trace.signature === "prompty.chatSession") {
    return <SessionConversation trace={trace} />;
  }
  return <AgentConversation trace={trace} />;
};

/** Render a chatSession trace — walks child executeAgent frames for full detail */
const SessionConversation = ({ trace }: { trace: TraceItem }) => {
  const elements: React.ReactNode[] = [];
  const frames = trace.__frames ?? [];

  // Find all executeAgent child frames
  const agentFrames = frames.filter((f) => f.signature === "prompty.executeAgent");

  for (let turnIdx = 0; turnIdx < agentFrames.length; turnIdx++) {
    const agentFrame = agentFrames[turnIdx];

    elements.push(
      <IterationDivider key={`turn-${turnIdx}`}>
        Turn {turnIdx + 1} of {agentFrames.length}
      </IterationDivider>
    );

    // Extract conversation from this turn
    const { messages } = extractConversation(agentFrame);
    const prepareCount = extractPrepareCount(agentFrame);

    // For the first turn, show all messages (including system).
    // For subsequent turns, skip messages already shown (the thread history).
    const startIdx = turnIdx === 0 ? 0 : prepareCount;

    for (let i = startIdx; i < messages.length; i++) {
      const msg = messages[i];
      const key = `turn-${turnIdx}-msg-${i}`;
      elements.push(renderMessage(msg, key));
    }
  }

  // If no agent frames, fall back to result.conversation
  if (agentFrames.length === 0) {
    const result = trace.result as Record<string, unknown> | undefined;
    const conversation = result?.conversation as ConversationMessage[] | undefined;
    if (conversation) {
      for (let i = 0; i < conversation.length; i++) {
        elements.push(renderMessage(conversation[i], `fallback-${i}`));
      }
    }
  }

  return <Container>{elements}</Container>;
};

/** Render an executeAgent trace — single invocation */
const AgentConversation = ({ trace }: { trace: TraceItem }) => {
  const { messages, iterations } = extractConversation(trace);
  let currentIteration = 0;
  let executorIndex = 0;

  const elements: React.ReactNode[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const toolCalls = getToolCalls(msg);
    const content = getContent(msg);

    // Insert iteration dividers before assistant responses from executor
    if (msg.role === "assistant" && (content || toolCalls)) {
      const isFromPrepare = i < (extractPrepareCount(trace) ?? 0);
      if (!isFromPrepare && executorIndex < iterations) {
        currentIteration++;
        executorIndex++;
        if (iterations > 1) {
          elements.push(
            <IterationDivider key={`iter-${currentIteration}`}>
              LLM Call {currentIteration} of {iterations}
            </IterationDivider>
          );
        }
      }
    }

    elements.push(renderMessage(msg, `msg-${i}`));
  }

  return <Container>{elements}</Container>;
};

function renderMessage(msg: ConversationMessage, key: string): React.ReactNode {
  const toolCalls = getToolCalls(msg);
  const content = getContent(msg);

  if (msg.role === "assistant" && toolCalls && toolCalls.length > 0 && !content) {
    return (
      <Bubble key={key} $role="assistant">
        <RoleTag $role="assistant">assistant</RoleTag>
        {toolCalls.map((tc, j) => (
          <ToolCallBox key={j}>
            <ToolName>{tc.function.name}</ToolName>({tc.id?.slice(-8)})
            <ToolArgs>{formatArgs(tc.function.arguments)}</ToolArgs>
          </ToolCallBox>
        ))}
      </Bubble>
    );
  }

  if (msg.role === "tool") {
    const toolName = msg.name ?? (msg.metadata?.name as string) ?? "tool";
    return (
      <Bubble key={key} $role="tool">
        <RoleTag $role="tool">{toolName}</RoleTag>
        <div>{content}</div>
      </Bubble>
    );
  }

  return (
    <Bubble key={key} $role={msg.role}>
      <RoleTag $role={msg.role}>{msg.role}</RoleTag>
      <div>{content}</div>
    </Bubble>
  );
}

function extractPrepareCount(trace: TraceItem): number {
  const frames = trace.__frames ?? [];
  const prepareFrame = frames.find((f) => f.signature === "prompty.prepare");
  const result = prepareFrame?.result;
  return Array.isArray(result) ? result.length : 0;
}

export default Conversation;
