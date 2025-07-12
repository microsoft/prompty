import { VscSymbolMethod, VscPackage, VscGithubInverted } from "react-icons/vsc";
import { TraceItem } from "../store";
import PromptyIcon from "./prompty";
import AzureModelIcon from "./azureModelIcon";

interface Props {
  trace: TraceItem;
  size: number;
  color?: string;
}

const NodeIcon = ({ trace, size, color }: Props) => {
  if (trace.type && trace.type.toLowerCase() === "llm") {
    if (trace.signature && trace.signature.startsWith("AzureOpenAI")) {
      return <AzureModelIcon size={size} />;
    } else if (trace.signature && trace.signature.startsWith("azure.ai.inference")) {
      return <VscGithubInverted size={size} color={color} />;
    } else {
      return <VscPackage size={size} color={color} />;
    }
  } else if (
    (trace.signature && trace.signature.startsWith("prompty")) ||
    trace.name.includes("PromptyStream")
  ) {
    return <PromptyIcon size={size} />;
  } else {
    return <VscSymbolMethod size={size} color={color} />;
  }
};

export default NodeIcon;
