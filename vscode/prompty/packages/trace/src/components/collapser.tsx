import { VscChevronLeft, VscChevronRight } from "react-icons/vsc";

const Collapser = ({
  collapsed,
}: {
  collapsed: boolean;
}) => {
  return collapsed ? (
    <VscChevronRight
      size={24}
      aria-hidden="true"
    />
  ) : (
    <VscChevronLeft
      size={24}
      aria-hidden="true"
    />
  );
};

export default Collapser;
