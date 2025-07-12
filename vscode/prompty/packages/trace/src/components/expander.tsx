import { VscTriangleDown, VscTriangleRight } from "react-icons/vsc";

const Expander = ({
  expanded,
  color,
  setExpanded,
}: {
  expanded: boolean;
  color: string;
  setExpanded: (value: boolean) => void;
}) => {
  return expanded ? (
    <VscTriangleDown
      size={16}
      onClick={() => setExpanded(false)}
      color={color}
    />
  ) : (
    <VscTriangleRight
      size={16}
      onClick={() => setExpanded(true)}
      color={color}
    />
  );
};

export default Expander;
