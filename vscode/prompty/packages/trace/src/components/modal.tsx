import { VscClose, VscCloseAll } from "react-icons/vsc";
import styled from "styled-components";
import { useModalStore } from "../store";
import usePersistStore from '../store/usepersiststore';

const modalPadding = 32;
const modalMargin = 6;

const ModalWrapper = styled.div`
  display: ${(props) => (props.hidden ? "none" : "flex")};
  position: fixed;
  top: 0;
  left: 0;
  z-index: 10;
  width: 100%;
  height: 100%;
  background-color: hsl(var(--vscode-editor-background) / 0.1);
  -webkit-backdrop-filter: blur(3px);
  backdrop-filter: blur(2px);
`;

const ModalFrame = styled.div<{
  $index?: number;
  $count?: number;
}>`
  display: flex;
  flex-direction: column;
  border: 1px solid var(--vscode-textBlockQuote-border);
  border-radius: 8px;
  overflow: hidden;
  z-index: 20;
  background-color: var(--vscode-editor-background);
  color: var(--vscode-foreground);
  position: fixed;
  top: ${(props) => (props.$index ?? 0) * modalMargin + modalPadding}px;
  left: ${(props) => (props.$index ?? 0) * modalMargin + modalPadding}px;
  width: calc(
    100vw - ${(props) => modalPadding * 2 + (props.$count ?? 0) * modalMargin}px
  );
  height: calc(
    100vh - ${(props) => modalPadding * 2 + (props.$count ?? 0) * modalMargin}px
  );
`;

const Header = styled.div`
  font-size: smaller;
  font-size: larger;
  font-weight: 600;
  display: flex;
  padding: 18px;
`;

const Item = styled.div`
  flex-grow: 1;
  overflow-y: auto;
  padding: 0 18px 18px 18px;
`;

const Grow = styled.div`
  flex-grow: 1;
`;

const Title = styled.div`
  font-size: smaller;
  color: var(--vscode-descriptionForeground);
`;

const Close = styled.div`
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  &:hover {
    color: var(--vscode-focusBorder);
  }
`;

interface Props {
  title: string;
  children: React.ReactNode;
  index: number;
  count: number;
}

const Modal = ({ title, children, index, count }: Props) => {
  const popModal = useModalStore((state) => state.popModal);
  return (
    <ModalFrame $index={index} $count={count}>
      <Header>
        <Title>{title}</Title>
        <Grow />
        <Close onClick={() => popModal()}>
          <VscClose />
        </Close>
      </Header>
      <Item>{children}</Item>
    </ModalFrame>
  );
};

const CloseAll = styled.div`
  cursor: pointer;
  user-select: none;
  position: absolute;
  height: 24px;
  width: 24px;
  display: ${(props) => (props.hidden ? "none" : "flex")};
  justify-content: center;
  align-items: center;
  background-color: var(--vscode-editor-background);
  color: var(--vscode-foreground);
  border: 1px solid var(--vscode-textBlockQuote-border);
  border-radius: 50%;
  top: 10px;
  right: 10px;
  &:hover {
    color: var(--vscode-focusBorder);
    border: 1px solid var(--vscode-focusBorder);
  }
`;

const ModalCollection = () => {

	const modalStore = usePersistStore(useModalStore, (state) => state);

  return (
    <ModalWrapper hidden={modalStore?.isEmpty}>
      <CloseAll
        onClick={() => modalStore?.closeAll()}
        hidden={modalStore?.modals && modalStore?.modals.length < 2}
      >
        <VscCloseAll size={20} />
      </CloseAll>
      {modalStore?.modals.map((modal, index) => (
        <Modal
          key={index}
          index={index}
          count={modalStore.modals.length}
          {...modal}
        />
      ))}
    </ModalWrapper>
  );
};

export default ModalCollection;
