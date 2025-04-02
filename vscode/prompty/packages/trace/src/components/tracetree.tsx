import styled from "styled-components";
import { TraceItem, useCurrentStore } from "../store";
import { VscFoldUp, VscFoldDown } from "react-icons/vsc";
import { MouseEventHandler, useState } from "react";
import { formatDuration, formatTokens } from "../utilities/format";
import NodeIcon from "./nodeIcon";

type Props = {
  trace: TraceItem;
  level: number;
  hidden: boolean;
  setTraceItem: (trace: TraceItem) => void;
};

const TreeItem = styled.div`
  padding: 0px;
  width: 100%;
  display: ${(props) => (props.hidden ? "none" : "flex")};
  justify-content: flex-start;
  user-select: none;
`;

const TreeIcon = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  margin-top: 4px;
  cursor: pointer;
  width: 18px;
  height: 18px;
  padding: 2px;
  border: 0px solid var(--vscode-icon-foreground);
  border-radius: 50%;
  border-style: solid;
  color: var(--vscode-icon-foreground);
`;

const TreeContent = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  flex-grow: 1;
  width: 100%;
`;

const TreeRow = styled.div<{ $selected?: boolean }>`
  display: flex;
  height: 30px;
  width: 100%;
  border-width: 1px;
  border-style: solid;
  border-color: ${(props) =>
    props.$selected ? "var(--vscode-focusBorder)" : "var(--vscode-editor-background)"};
  border-radius: 6px;
  align-items: center;
  margin-left: 2px;
  &:hover {
    border-color: var(--vscode-focusBorder);
    cursor: pointer;
  }
`;

const Grow = styled.div`
  flex-grow: 1;
`;

const Label = styled.div`
  font-size: 16px;
  color: var(--vscode-descriptionForeground);
  font-weight: 600;
  margin-left: 8px;
  margin-bottom: 2px;
`;

const Badge = styled.div`
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  border: 1px solid var(--vscode-textBlockQuote-border);
  margin-right: 4px;
  padding: 2px;
  border-radius: 20px;
  width: 35px;
  text-align: center;
`;

const BlankIcon = styled.div`
  width: 16px;
  height: 16px;
`;

const IconSlot = styled.div`
  width: 24px;
  height: 24px;
  padding: 4px;
  display: flex;
  justify-content: center;
  align-items: center;
`;

const BadgeMeasure = styled.span`
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
`;

const BadgeUnit = styled.span`
  color: var(--vscode-descriptionForeground);
`;

const TraceTree = ({ trace, level, hidden, setTraceItem }: Props) => {
  const currentTraceItem = useCurrentStore((state) => state.traceItem);
  const [show, setShow] = useState(true);
  const frames = trace.__frames ?? [];

  const duration = formatDuration(trace.__time.duration);
  const tokens = trace.__usage ? formatTokens(trace.__usage.total_tokens) : formatTokens(0);
  
  const toggleVisibility: MouseEventHandler<HTMLDivElement> = (e) => {
    setShow(!show);
    e.stopPropagation();
  };



  const getToggleIcon = (children: boolean, show: boolean) => {
    if (children) {
      return show ? <VscFoldUp /> : <VscFoldDown />;
    } else {
      return <BlankIcon />;
    }
  };

  return (
    <TreeItem hidden={hidden}>
      <TreeIcon onClick={() => setTraceItem(trace)} onDoubleClick={toggleVisibility}>
        <NodeIcon trace={trace} size={24} />
      </TreeIcon>
      <TreeContent>
        <TreeRow
          onClick={() => setTraceItem(trace)}
          onDoubleClick={toggleVisibility}
          $selected={trace.id === currentTraceItem?.id}>
          <Label>{trace.name}</Label>
          <Grow />
          {trace.__usage && (
            <Badge>
              <BadgeMeasure>{tokens.measure}</BadgeMeasure>
              <BadgeUnit>{tokens.unit}</BadgeUnit>
            </Badge>
          )}
          <Badge>
            <BadgeMeasure>{duration.measure}</BadgeMeasure>
            <BadgeUnit>{duration.unit}</BadgeUnit>
          </Badge>
          <IconSlot onClick={toggleVisibility}>{getToggleIcon(frames.length > 0, show)}</IconSlot>
        </TreeRow>
        {frames.map((t, i) => (
          <TraceTree
            key={i}
            trace={t}
            level={level + 1}
            hidden={!show}
            setTraceItem={setTraceItem}
          />
        ))}
      </TreeContent>
    </TreeItem>
  );
};

export default TraceTree;
