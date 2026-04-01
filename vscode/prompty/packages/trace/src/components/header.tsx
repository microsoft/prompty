import styled from "styled-components";
import { TraceItem } from "../store";
import NodeIcon from "./nodeIcon";

const Context = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const TitleBlock = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
`;

const Title = styled.div`
  font-size: 16px;
  font-weight: 700;
  color: var(--vscode-foreground);
`;

const SubTitle = styled.div`
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
`;

const Grow = styled.div`
  flex-grow: 1;
`;

const RuntimePill = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 12px;
  padding: 4px 10px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  white-space: nowrap;
  flex-shrink: 0;
`;

interface Props {
  trace: TraceItem;
  runtime: string;
  version: string;
}

const Header = ({ trace, runtime, version }: Props) => {
  return (
    <Context>
      <NodeIcon trace={trace} size={26} />
      <TitleBlock>
        <Title>{trace.name}</Title>
        {trace.signature && <SubTitle>{trace.signature}</SubTitle>}
      </TitleBlock>
      <Grow />
      <RuntimePill>
        {runtime} {version}
      </RuntimePill>
    </Context>
  );
};

export default Header;
