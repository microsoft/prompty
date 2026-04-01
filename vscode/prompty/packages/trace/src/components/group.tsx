import styled from "styled-components";
import { BiExpandAlt } from "react-icons/bi";
import { MouseEventHandler } from "react";
import { useModalStore } from "../store";
import Inspector from "./inspector";

const Frame = styled.div<{ $fill?: boolean }>`
  display: flex;
  flex-direction: column;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  background: var(--vscode-editor-background);
  padding: 8px 10px;
  overflow: hidden;
  ${(props) => props.$fill ? "flex: 1; min-height: 0;" : ""}
`;

const Header = styled.div`
  display: flex;
  margin-bottom: 4px;
  flex-shrink: 0;
`;

const Item = styled.div`
  flex-grow: 1;
  overflow-y: auto;
`;

const Grow = styled.div`
  flex-grow: 1;
`;

const Title = styled.div`
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const Expand = styled.div`
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  color: var(--vscode-descriptionForeground);
  &:hover {
    color: var(--vscode-textLink-foreground);
  }
`;

interface Props {
  title: string;
  item: unknown;
  fill?: boolean;
}

const Group = ({ title, item, fill }: Props) => {
  const pushModal = useModalStore((state) => state.pushModal);

  const handleExpand: MouseEventHandler<HTMLDivElement> = () => {
    pushModal({
      title: title.toLowerCase(),
      children: (
        <Inspector
          title={title.toLowerCase()}
          value={item}
          level={0}
          signature={title.toLowerCase()}
					expand={true}
        />
      ),
    });
  };

  return (
    <Frame $fill={fill}>
      <Header>
        <Title>{title}</Title>
        <Grow />
        <Expand onClick={handleExpand}>
          <BiExpandAlt />
        </Expand>
      </Header>
      <Item>
        <Inspector
          title={title}
          value={item}
          level={0}
          signature={title.toLowerCase()}
          expandLevel={0}
        />
      </Item>
    </Frame>
  );
};

export default Group;
