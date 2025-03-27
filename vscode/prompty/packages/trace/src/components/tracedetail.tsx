import styled from "styled-components";
import { TraceItem } from "../store";
import Detail from "./detail";
import Group from "./group";

const ItemCollection = styled.div`
  display: grid;
  grid-template-rows: 107px auto auto;
  height: 100%;
`;

type Props = {
  trace: TraceItem;
};

const TraceDetail = ({ trace }: Props) => {
  return (
    <ItemCollection>
      <Detail time={trace.__time} usage={trace.__usage} />
      <Group title="Input" item={trace.inputs} />
      <Group title="Output" item={trace.result} />
    </ItemCollection>
  );
};

export default TraceDetail;
