import { useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import styled from "styled-components";
import Header from "./components/header";
import TraceTree from "./components/tracetree";
import TraceDetail from "./components/tracedetail";
import ModalCollection from "./components/modal";
import { TraceItem, useTraceStore, useCurrentStore } from "./store";
import { GlobalStyle } from "./utilities/styles";

const Frame = styled.div`
  display: flex;
  height: 100%;
  width: 100%;
`;

const Sidebar = styled.div`
  border-right: 1px solid var(--vscode-textBlockQuote-border);
  width: 500px;
  overflow-y: auto;
`;

const Content = styled.div`
  display: flex;
  flex-direction: column;
  width: calc(100% - 500px);
`;

const HeaderFrame = styled.div`
  border-bottom: 1px solid var(--vscode-textBlockQuote-border);
`;

const BodyFrame = styled.div`
  flex: flex-grow;
  height: calc(100vh - 80px);
`;

const Container = styled.div`
  padding: 18px;
`;

const Tree = styled.div`
  padding-top: 18px;
  padding-bottom: 18px;
  padding-left: 8px;
  padding-right: 8px;
`;

const ensureIds = (trace: TraceItem) => {
  if (!trace.id) trace.id = uuidv4().toString();
  if (trace.__frames) trace.__frames.forEach(ensureIds);
};

function App() {
  const [trace, setTrace] = useTraceStore((state) => [state.trace, state.setTrace]);
  const [traceItem, setTraceItem] = useCurrentStore((state) => [
    state.traceItem,
    state.setTraceItem,
  ]);

  useEffect(() => {
    if (typeof acquireVsCodeApi !== "function") {
      fetch("/example.tracy")
        .then((response) => response.json())
        .then((t) => {
          // add ids to trace
          ensureIds(t.trace);
          console.log(t);
          setTrace(t);
          setTraceItem(t.trace);
        });
    }

    window.addEventListener("message", (event) => {
      const message = event.data;
      if (message.command === "trace") {
        // add ids to trace
        const t = JSON.parse(message.text);
        ensureIds(t.trace);
        console.log(t);
        setTrace(t);
        setTraceItem(t.trace);
      }
    });
  }, [setTrace, setTraceItem]);

  return (
    <>
      <GlobalStyle />
      <Frame>
        <Sidebar>
          <Tree>
            {trace && trace.trace && (
              <TraceTree
                trace={trace?.trace}
                level={0}
                hidden={false}
                setTraceItem={(t) => setTraceItem(t)}
              />
            )}
          </Tree>
        </Sidebar>
        <Content>
          <HeaderFrame>
            <Container>
              {trace && traceItem && (
                <Header
                  trace={traceItem}
                  runtime={trace?.runtime}
                  version={trace?.version}
                />
              )}
            </Container>
          </HeaderFrame>
          <BodyFrame>{traceItem && <TraceDetail trace={traceItem!} />}</BodyFrame>
        </Content>
        <ModalCollection />
      </Frame>
    </>
  );
}

export default App;
