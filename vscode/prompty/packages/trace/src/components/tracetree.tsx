import styled from "styled-components";
import { TraceItem, useCurrentStore, useCollapseStore } from "../store";
import { VscChevronDown, VscChevronRight } from "react-icons/vsc";
import { MouseEventHandler } from "react";
import { formatDuration, formatTokens } from "../utilities/format";
import NodeIcon from "./nodeIcon";

interface Props {
  trace: TraceItem;
  level: number;
  hidden: boolean;
  setTraceItem: (trace: TraceItem) => void;
}

const TreeItem = styled.div<{ $hidden?: boolean }>`
  display: ${(props) => (props.$hidden ? "none" : "flex")};
  flex-direction: column;
  width: 100%;
`;

const TreeRow = styled.div<{ $selected?: boolean; $level: number }>`
  display: flex;
  align-items: center;
  min-height: 28px;
  padding: 3px 8px 3px ${(props) => 4 + props.$level * 16}px;
  gap: 4px;
  cursor: pointer;
  user-select: none;
  border-left: 3px solid ${(props) => (props.$selected ? "var(--vscode-textLink-foreground)" : "transparent")};
  background: ${(props) => (props.$selected ? "var(--vscode-editor-background)" : "transparent")};

  &:hover {
    background: ${(props) => (props.$selected ? "var(--vscode-editor-background)" : "var(--vscode-list-hoverBackground)")};
  }
`;

const NameBlock = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
`;

const NameLabel = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: var(--vscode-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
`;

const Subtitle = styled.div`
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
`;

const Grow = styled.div`
  flex-grow: 1;
  flex-shrink: 1;
  min-width: 0;
`;

const TokenPill = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  background: color-mix(in srgb, var(--vscode-charts-green) 8%, transparent);
  color: var(--vscode-charts-green);
  font-size: 10px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  padding: 1px 5px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
`;

const DurationPill = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  background: color-mix(in srgb, var(--vscode-descriptionForeground) 8%, transparent);
  color: var(--vscode-descriptionForeground);
  font-size: 10px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  padding: 1px 5px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
`;

const ChevronSlot = styled.div<{ $clickable?: boolean }>`
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--vscode-descriptionForeground);
  cursor: ${(props) => (props.$clickable ? "pointer" : "default")};

  &:hover {
    color: ${(props) => (props.$clickable ? "var(--vscode-foreground)" : "inherit")};
  }
`;

const TraceTree = ({ trace, level, hidden, setTraceItem }: Props) => {
  const currentTraceItem = useCurrentStore((state) => state.traceItem);
  const toggle = useCollapseStore((state) => state.toggle);
  const isCollapsed = useCollapseStore((state) => state.collapsed.has(trace.id ?? ""));
  const frames = trace.__frames ?? [];
  const hasChildren = frames.length > 0;
  const show = !isCollapsed;

  const duration = formatDuration(trace.__time.duration);
  const tokens = trace.__usage ? formatTokens(trace.__usage.total_tokens) : null;

  const toggleVisibility: MouseEventHandler<HTMLDivElement> = (e) => {
    e.stopPropagation();
    if (trace.id) toggle(trace.id);
  };

  const handleRowClick = () => {
    setTraceItem(trace);
  };

  const isSelected = trace.id === currentTraceItem?.id;
  const iconSize = level === 0 ? 22 : 18;

  return (
    <TreeItem $hidden={hidden}>
      <TreeRow $selected={isSelected} $level={level} onClick={handleRowClick}>
        <ChevronSlot $clickable={hasChildren} onClick={hasChildren ? toggleVisibility : undefined}>
          {hasChildren && (show ? <VscChevronDown size={14} /> : <VscChevronRight size={14} />)}
        </ChevronSlot>
        <NodeIcon trace={trace} size={iconSize} />
        <NameBlock>
          <NameLabel>{trace.name}</NameLabel>
          {trace.signature && <Subtitle>{trace.signature}</Subtitle>}
        </NameBlock>
        <Grow />
        {tokens && (
          <TokenPill>
            {tokens.measure}{tokens.unit}
          </TokenPill>
        )}
        <DurationPill>
          {duration.measure}{duration.unit}
        </DurationPill>
      </TreeRow>
      {hasChildren && show && (
        frames.map((t, i) => (
          <TraceTree
            key={i}
            trace={t}
            level={level + 1}
            hidden={false}
            setTraceItem={setTraceItem}
          />
        ))
      )}
    </TreeItem>
  );
};

export default TraceTree;
