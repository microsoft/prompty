import { VscChevronLeft, VscChevronRight } from "react-icons/vsc";

const Collapser = ({
  collapsed,
  setCollapsed,
}: {
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
}) => {
  return collapsed ? (
    <VscChevronRight
      size={24}
      onClick={() => setCollapsed(false)}
      style={{ cursor: "pointer" }}
    />
  ) : (
    <VscChevronLeft
      size={24}
      onClick={() => setCollapsed(true)}
      style={{ cursor: "pointer" }}
    />
  );
};

export default Collapser;
