import styled from "styled-components";
import { VscSearch } from "react-icons/vsc";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MouseEventHandler, useState } from "react";
import { useModalStore } from "../store";
import { isExpandable } from "../utilities/format";
import Expander from "./expander";
const marginMultiple = 20;

const ItemValue = styled.div<{
  $level?: number;
  $hidden?: boolean;
}>`
  margin-left: ${(props) => (props.$level ?? 0) + 1 * marginMultiple}px;
  font-size: 14px;
  display: ${(props) => (props.$hidden ? "none" : "block")};
`;

const ItemKey = styled.div<{
  $hidden?: boolean;
}>`
  font-size: 16px;
  display: ${(props) => (props.$hidden ? "none" : "block")};
  display: flex;
  flex-direction: row;
`;

const ItemTitle = styled.div<{
  $hidden?: boolean;
}>`
  font-size: 16px;
  color: var(--vscode-editorInfo-foreground);
  display: ${(props) => (props.$hidden ? "none" : "block")};
  user-select: none;
  cursor: pointer;
  font-weight: 600;
`;

const ItemColon = styled.div<{
  $hidden?: boolean;
}>`
  font-size: 16px;
  display: ${(props) => (props.$hidden ? "none" : "block")};
  color: var(--vscode-descriptionForeground);
`;

const ItemDescription = styled.div`
  font-size: 16px;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  padding: 4px;
`;

const ItemString = styled.div`
  font-size: 14px;
  overflow: hidden;
  white-space: nowrap;
  color: var(--vscode-descriptionForeground);
  flex-shrink: 1;
`;

const ItemIcon = styled.div<{
  $hidden?: boolean;
}>`
  font-size: 16px;
  align-items: center;
  justify-content: center;
  margin-top: 4px;
  user-select: none;
  cursor: pointer;
  display: ${(props) => (props.$hidden ? "none" : "block")};
`;

const Gap = styled.div`
  margin-right: 10px;
`;

interface Props {
  title: string;
  signature: string;
  value: unknown;
  level: number;
  expand?: boolean;
  expandLevel?: number;
}

const Inspector = ({
  title,
  signature,
  value,
  level,
  expand,
  expandLevel,
}: Props) => {
  const [expanded, setExpanded] = useState(
    expand ?? (expandLevel === level ? true : false)
  );
  const pushModal = useModalStore((state) => state.pushModal);

  const isString = typeof value === "string";

  const stringify = (value: unknown) => {
    try {
      return JSON.stringify(value).substring(0, 1000);
    } catch {
      return "";
    }
  };

  const valueString = stringify(value);
  const isExpandableValue = isExpandable(title, value);

  const handleExpand: MouseEventHandler<HTMLDivElement> = () => {
    if (!isExpandableValue) {
      return;
    }
    pushModal({
      title: signature,
      children: (
        <Inspector
          title={title}
          value={value}
          signature={signature}
          level={0}
          expand={expand}
          expandLevel={expandLevel}
        />
      ),
    });
  };

  return (
    <>
      {isString && level === 0 ? (
        <Markdown remarkPlugins={[remarkGfm]}>{value}</Markdown>
      ) : (
        <>
          <ItemDescription>
            <ItemIcon>
              <Expander
                expanded={expanded}
                color={
                  isExpandableValue
                    ? "var(--vscode-descriptionForeground)"
                    : "var(--vscode-editor-background)"
                }
                setExpanded={setExpanded}
              />
            </ItemIcon>
            <ItemKey $hidden={level === 0}>
              <ItemTitle $hidden={level === 0} onClick={handleExpand}>
                {title}
              </ItemTitle>
              <ItemColon $hidden={level === 0}>:</ItemColon>
            </ItemKey>
            <ItemString>{valueString}</ItemString>
            <ItemIcon
              $hidden={level === 0 || !isExpandableValue}
              onClick={handleExpand}
            >
              <VscSearch size={16} />
            </ItemIcon>
            <Gap />
          </ItemDescription>
          <ItemValue $level={level} $hidden={!expanded}>
            {isString ? (
              <ItemValue $level={level}>
                {isExpandableValue ? (
                  <Markdown remarkPlugins={[remarkGfm]}>
                    {isString ? value : ""}
                  </Markdown>
                ) : (
                  <></>
                )}
              </ItemValue>
            ) : (
              Object.entries(value || {}).map(([k, v]) => (
                <Inspector
                  key={k}
                  title={k}
                  value={v}
                  level={level + 1}
                  signature={`${signature}.${k}`}
                  expand={expand}
                  expandLevel={expandLevel}
                />
              ))
            )}
          </ItemValue>
        </>
      )}
    </>
  );
};

export default Inspector;
