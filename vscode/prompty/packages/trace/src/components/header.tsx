import styled from "styled-components";
import { TraceItem } from "../store";
import NodeIcon from "./nodeIcon";

const Context = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const IconDiv = styled.div`
  width: 32px;
  height: 32px;
  padding: 8px;
  border: 1px solid var(--vscode-badge-background);
  border-radius: 50%;
  border-style: solid;
  color: var(--vscode-icon-foreground);
`;

const Title = styled.div`
  font-size: larger;
  font-weight: 600;
`;

const SubTitle = styled.div`
  font-size: smaller;
  color: var(--vscode-descriptionForeground);
`;

const Righty = styled.div`
  text-align: right;
`;

const Grow = styled.div`
  flex-grow: 1;
`;

interface Props {
  trace: TraceItem;
  runtime: string;
  version: string;
}

const Header = ({ trace, runtime, version }: Props) => {
  return (
    <Context>
      <IconDiv>
        <NodeIcon trace={trace} size={32} />
      </IconDiv>
      <div>
        <Title>{trace.name}</Title>
        <SubTitle>{trace.signature}</SubTitle>
      </div>
      <Grow />
      <Righty>
        <Title>{runtime}</Title>
        <SubTitle>{version}</SubTitle>
      </Righty>
    </Context>
  );
};

export default Header;
