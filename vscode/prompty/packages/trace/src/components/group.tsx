import styled from "styled-components";
import { BiExpandAlt } from "react-icons/bi";
import { MouseEventHandler } from "react";
import { useModalStore } from "../store";
import Inspector from "./inspector";

const Frame = styled.div`
  display: flex;
  flex-direction: column;
  border: 1px solid var(--vscode-textBlockQuote-border);
  border-radius: 8px;
  padding: 12px;
  margin: 0 18px 18px 18px;
  overflow: hidden;
`;

const Header = styled.div`
  font-size: smaller;
  font-size: larger;
  font-weight: 600;
  margin-bottom: 9px;
  display: flex;
`;

const Item = styled.div`
  flex-grow: 1;
  overflow-y: auto;
`;

const Grow = styled.div`
  flex-grow: 1;
`;

const Title = styled.div`
  font-size: smaller;
  color: var(--vscode-descriptionForeground);
`;

const Expand = styled.div`
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  &:hover {
    color: var(--vscode-focusBorder);
  }
`;

type Props = {
  title: string;
  item: unknown;
};

const Group = ({ title, item }: Props) => {
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
    <Frame>
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
          expand={false}
        />
      </Item>
    </Frame>
  );
};

export default Group;
