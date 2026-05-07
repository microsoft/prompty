import styled from "styled-components";
import { TraceItem, useCurrentStore, useCollapseStore } from "../store";
import { VscChevronDown, VscChevronRight } from "react-icons/vsc";
import { KeyboardEventHandler, MouseEventHandler } from "react";
import { formatDuration, formatTokens, totalTokens } from "../utilities/format";
import NodeIcon from "./nodeIcon";

interface Props {
  trace: TraceItem;
  level: number;
  hidden: boolean;
  ancestorLines?: boolean[];
  setTraceItem: (trace: TraceItem) => void;
}

const TreeItem = styled.div<{ $hidden?: boolean }>`
  display: ${(props) => (props.$hidden ? "none" : "flex")};
  flex-direction: column;
  width: 100%;
`;

/* ── Tree guide lines ── */

const guideColor = "var(--vscode-tree-indentGuidesStroke, var(--vscode-panel-border))";
const activeGuideColor = "var(--vscode-tree-inactiveIndentGuidesStroke, var(--vscode-list-focusOutline))";

const GuideSlot = styled.div.attrs({ className: 'guide' })`
  width: 16px;
  align-self: stretch;
  flex-shrink: 0;
  position: relative;
`;

const GuideLine = styled(GuideSlot)`
  &::before {
    content: '';
    position: absolute;
    left: 8px;
    top: 0;
    bottom: 0;
    width: 1px;
    background: ${guideColor};
    transition: background 0.1s;
  }
`;

const GuideBranch = styled(GuideSlot)<{ $leaf?: boolean }>`
  &::before {
    content: '';
    position: absolute;
    left: 8px;
    top: 0;
    bottom: 0;
    width: 1px;
    background: ${guideColor};
    transition: background 0.1s;
  }
  &::after {
    content: '';
    position: absolute;
    left: 8px;
    top: 50%;
    width: ${(props) => (props.$leaf ? "11px" : "8px")};
    height: 1px;
    background: ${guideColor};
    transition: background 0.1s;
  }
`;

const GuideElbow = styled(GuideSlot).attrs({ className: 'guide guide-elbow' })<{ $leaf?: boolean }>`
  &::before {
    content: '';
    position: absolute;
    left: 8px;
    top: 0;
    height: 50%;
    width: ${(props) => (props.$leaf ? "11px" : "8px")};
    border-left: 1px solid ${guideColor};
    border-bottom: 1px solid ${guideColor};
    border-bottom-left-radius: 6px;
    transition: border-color 0.1s;
  }
`;

/* Leaf connector — replaces ChevronSlot for non-expandable nodes,
   draws a horizontal line through the space where the chevron would be */
const LeafConnector = styled.div.attrs({ className: 'guide' })`
  width: 16px;
  align-self: stretch;
  flex-shrink: 0;
  position: relative;

  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    width: 100%;
    height: 1px;
    background: ${guideColor};
    transition: background 0.1s;
  }
`;

const renderGuides = (ancestorLines: boolean[], isLeaf: boolean) => {
  const len = ancestorLines.length;
  if (len === 0) {return null;}

  return ancestorLines.map((hasLine, i) => {
    const isConnector = i === len - 1;
    if (isConnector) {
      return hasLine ? <GuideBranch key={i} $leaf={isLeaf} /> : <GuideElbow key={i} $leaf={isLeaf} />;
    }
    return hasLine ? <GuideLine key={i} /> : <GuideSlot key={i} />;
  });
};

/* ── Row layout ── */

const TreeRow = styled.div<{ $selected?: boolean }>`
  display: flex;
  align-items: center;
  height: 22px;
  padding: 0 8px 0 4px;
  gap: 3px;
  cursor: pointer;
  user-select: none;
  border-left: 3px solid ${(props) => (props.$selected ? "var(--vscode-textLink-foreground)" : "transparent")};
  background: ${(props) => (props.$selected ? "var(--vscode-list-activeSelectionBackground)" : "transparent")};
  color: ${(props) => (props.$selected ? "var(--vscode-list-activeSelectionForeground)" : "var(--vscode-foreground)")};
  outline: none;

  &:hover {
    background: ${(props) => (props.$selected ? "var(--vscode-list-activeSelectionBackground)" : "var(--vscode-list-hoverBackground)")};

    .guide::before { background: ${activeGuideColor}; border-color: ${activeGuideColor}; }
    .guide::after  { background: ${activeGuideColor}; }
    .guide-elbow::before { background: none; border-color: ${activeGuideColor}; }
  }

  &:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
`;

const NameBlock = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
`;

const NameLabel = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1;
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
  font-size: 9px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  padding: 0 4px;
  border-radius: 3px;
  white-space: nowrap;
  flex-shrink: 0;
`;

const DurationPill = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  background: color-mix(in srgb, var(--vscode-descriptionForeground) 8%, transparent);
  color: var(--vscode-descriptionForeground);
  font-size: 9px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  padding: 0 4px;
  border-radius: 3px;
  white-space: nowrap;
  flex-shrink: 0;
`;

const ChevronSlot = styled.button<{ $clickable?: boolean }>`
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--vscode-descriptionForeground);
  cursor: ${(props) => (props.$clickable ? "pointer" : "default")};
  background: none;
  border: 0;
  padding: 0;

  &:hover {
    color: ${(props) => (props.$clickable ? "var(--vscode-foreground)" : "inherit")};
  }

  &:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
`;

const TraceTree = ({ trace, level, hidden, ancestorLines = [], setTraceItem }: Props) => {
  const currentTraceItem = useCurrentStore((state) => state.traceItem);
  const toggle = useCollapseStore((state) => state.toggle);
  const isCollapsed = useCollapseStore((state) => state.collapsed.has(trace.id ?? ""));
  const frames = trace.__frames ?? [];
  const hasChildren = frames.length > 0;
  const show = !isCollapsed;

  const duration = formatDuration(trace.__time.duration);
  const tokens = trace.__usage ? formatTokens(totalTokens(trace.__usage)) : null;

  const toggleVisibility: MouseEventHandler<HTMLDivElement> = (e) => {
    e.stopPropagation();
    if (trace.id) {toggle(trace.id);}
  };

  const handleRowClick = () => {
    setTraceItem(trace);
  };

  const handleRowKeyDown: KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setTraceItem(trace);
    } else if (e.key === "ArrowRight" && hasChildren && isCollapsed && trace.id) {
      e.preventDefault();
      toggle(trace.id);
    } else if (e.key === "ArrowLeft" && hasChildren && !isCollapsed && trace.id) {
      e.preventDefault();
      toggle(trace.id);
    }
  };

  const isSelected = trace.id === currentTraceItem?.id;
  const iconSize = level === 0 ? 22 : 18;

  return (
    <TreeItem $hidden={hidden}>
      <TreeRow
        $selected={isSelected}
        onClick={handleRowClick}
        onKeyDown={handleRowKeyDown}
        role="treeitem"
        tabIndex={0}
        aria-expanded={hasChildren ? show : undefined}
        aria-selected={isSelected}
      >
        {renderGuides(ancestorLines, !hasChildren)}
        {hasChildren ? (
          <ChevronSlot
            $clickable
            onClick={toggleVisibility}
            aria-label={show ? `Collapse ${trace.name}` : `Expand ${trace.name}`}
            aria-expanded={show}
          >
            {show ? <VscChevronDown size={14} /> : <VscChevronRight size={14} />}
          </ChevronSlot>
        ) : (
          <LeafConnector />
        )}
        <NodeIcon trace={trace} size={iconSize} />
        <NameBlock>
          <NameLabel>{trace.name}</NameLabel>
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
            ancestorLines={[...ancestorLines, i < frames.length - 1]}
            setTraceItem={setTraceItem}
          />
        ))
      )}
    </TreeItem>
  );
};

export default TraceTree;
