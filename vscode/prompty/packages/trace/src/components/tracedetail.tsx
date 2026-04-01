import styled from "styled-components";
import { TraceItem, useTabStore, TabId } from "../store";
import Detail from "./detail";
import Group from "./group";
import Header from "./header";
import Conversation, { isAgentTrace } from "./conversation";
import usePersistStore from "../store/usepersiststore";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
`;

const HeaderSection = styled.div`
  padding: 10px 14px 8px 14px;
`;

const TabBar = styled.div`
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--vscode-panel-border);
  padding: 0 14px;
`;

const Tab = styled.button<{ $active?: boolean }>`
  background: none;
  border: none;
  border-bottom: 2px solid ${(props) => (props.$active ? "var(--vscode-textLink-foreground)" : "transparent")};
  color: ${(props) => (props.$active ? "var(--vscode-textLink-foreground)" : "var(--vscode-descriptionForeground)")};
  font-size: 12px;
  font-family: inherit;
  padding: 6px 12px;
  cursor: pointer;
  user-select: none;
  font-weight: ${(props) => (props.$active ? "600" : "400")};

  &:hover {
    color: ${(props) => (props.$active ? "var(--vscode-textLink-foreground)" : "var(--vscode-foreground)")};
  }
`;

const TabContent = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const RawPre = styled.pre`
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  padding: 16px;
  margin: 0;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 12px;
  color: var(--vscode-foreground);
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
`;

interface Props {
  trace: TraceItem;
  runtime: string;
  version: string;
}

const ALL_TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "conversation", label: "Conversation" },
  { id: "input", label: "Input" },
  { id: "output", label: "Output" },
  { id: "raw", label: "Raw" },
];

const TraceDetail = ({ trace, runtime, version }: Props) => {
  const tabStore = usePersistStore(useTabStore, (state) => state);
  const storedTab = tabStore?.activeTab ?? "overview";
  const setActiveTab = tabStore?.setActiveTab;
  const isAgent = isAgentTrace(trace);
  const tabs = isAgent ? ALL_TABS : ALL_TABS.filter((t) => t.id !== "conversation");

  // Fall back to overview if the stored tab isn't available for this node
  const activeTab = tabs.some((t) => t.id === storedTab) ? storedTab : "overview";

  return (
    <Container>
      <HeaderSection>
        <Header trace={trace} runtime={runtime} version={version} />
      </HeaderSection>

      <TabBar>
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            $active={activeTab === tab.id}
            onClick={() => setActiveTab?.(tab.id)}
          >
            {tab.label}
          </Tab>
        ))}
      </TabBar>

      <TabContent>
        {activeTab === "overview" && (
          <>
            <Detail time={trace.__time} usage={trace.__usage} />
            <Group title="Input" item={trace.inputs} fill />
            <Group title="Output" item={trace.result} fill />
          </>
        )}

        {activeTab === "conversation" && isAgent && (
          <Conversation trace={trace} />
        )}

        {activeTab === "input" && (
          <Group title="Input" item={trace.inputs} />
        )}

        {activeTab === "output" && (
          <Group title="Output" item={trace.result} />
        )}

        {activeTab === "raw" && (
          <RawPre>{JSON.stringify(trace, null, 2)}</RawPre>
        )}
      </TabContent>
    </Container>
  );
};

export default TraceDetail;
