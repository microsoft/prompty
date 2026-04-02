import styled from "styled-components";
import { TraceItem } from "../store";
import PromptyIcon from "./prompty";
import { OpenAIIcon, FoundryIcon, AnthropicIcon, detectProvider } from "./providerIcons";

interface BadgeWrapperProps {
  $size: number;
  $bg: string;
  $color: string;
}

const BadgeWrapper = styled.div<BadgeWrapperProps>`
  width: ${(props) => props.$size}px;
  height: ${(props) => props.$size}px;
  min-width: ${(props) => props.$size}px;
  min-height: ${(props) => props.$size}px;
  background: ${(props) => props.$bg};
  color: ${(props) => props.$color};
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: ${(props) => Math.round(props.$size * 0.5)}px;
  line-height: 1;
`;

interface Props {
  trace: TraceItem;
  size: number;
}

const ProviderBadge = ({ provider, size }: { provider: string; size: number }) => {
  const iconSize = Math.round(size * 0.7);
  const color = "var(--vscode-foreground)";
  const bg = "color-mix(in srgb, var(--vscode-foreground) 12%, transparent)";
  switch (provider) {
    case "openai":
      return (
        <BadgeWrapper $size={size} $bg={bg} $color={color}>
          <OpenAIIcon size={iconSize} />
        </BadgeWrapper>
      );
    case "foundry":
      return (
        <BadgeWrapper $size={size} $bg={bg} $color={color}>
          <FoundryIcon size={iconSize} />
        </BadgeWrapper>
      );
    case "anthropic":
      return (
        <BadgeWrapper $size={size} $bg={bg} $color={color}>
          <AnthropicIcon size={iconSize} />
        </BadgeWrapper>
      );
    default:
      return (
        <BadgeWrapper $size={size} $bg={bg} $color={color}>
          ⚡
        </BadgeWrapper>
      );
  }
};

const NodeIcon = ({ trace, size }: Props) => {
  // Check for LLM / executor / processor traces — show provider icon
  if (trace.type?.toLowerCase() === "llm") {
    const provider = detectProvider(trace.signature);
    if (provider) return <ProviderBadge provider={provider} size={size} />;
    return (
      <BadgeWrapper $size={size} $bg="color-mix(in srgb, var(--vscode-foreground) 12%, transparent)" $color="var(--vscode-foreground)">
        ⚡
      </BadgeWrapper>
    );
  }

  // Executor/processor traces (may not have type=LLM but have provider in signature)
  const provider = detectProvider(trace.signature);
  if (provider && (trace.signature?.includes("executor") || trace.signature?.includes("processor"))) {
    return <ProviderBadge provider={provider} size={size} />;
  }

  // Prompty traces
  if (
    (trace.signature && trace.signature.startsWith("prompty")) ||
    trace.name.includes("PromptyStream")
  ) {
    return (
      <BadgeWrapper $size={size} $bg="color-mix(in srgb, var(--vscode-textLink-foreground) 12%, transparent)" $color="var(--vscode-textLink-foreground)">
        <PromptyIcon size={Math.round(size * 0.75)} />
      </BadgeWrapper>
    );
  }

  // Default: function
  return (
    <BadgeWrapper $size={size} $bg="color-mix(in srgb, var(--vscode-charts-green) 12%, transparent)" $color="var(--vscode-charts-green)">
      ƒ
    </BadgeWrapper>
  );
};

export default NodeIcon;
