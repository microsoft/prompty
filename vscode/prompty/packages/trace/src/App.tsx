import {
  useEffect,
  useState,
  MouseEvent as ReactMouseEvent,
  useRef,
} from "react";
import { v4 as uuidv4 } from "uuid";
import styled from "styled-components";
import Header from "./components/header";
import TraceTree from "./components/tracetree";
import TraceDetail from "./components/tracedetail";
import ModalCollection from "./components/modal";
import { TraceItem, useTraceStore, useCurrentStore, Trace } from "./store";
import { GlobalStyle } from "./utilities/styles";
import Collapser from "./components/collapser";
import usePersistStore from "./store/usepersiststore";
import { vscode } from "./utilities/vscode";

const Frame = styled.div`
  display: flex;
  height: 100%;
  width: 100%;
`;

interface ResizerProps {
  size?: number;
}
const Sidebar = styled.div.attrs<ResizerProps>((props) => ({
  style: { width: props.size ? `${props.size}px` : "500px" },
}))`
  overflow: auto;
  border-right: 1px solid var(--vscode-textBlockQuote-border);
`;

const SideBarResizer = styled.div.attrs<ResizerProps>((props) => ({
  style: { width: props.size ? `${props.size}px` : "4px" },
}))`
  cursor: ew-resize;
  background-color: var(--vscode-textBlockQuote-border);
  height: 100%;

  &:hover {
    background-color: var(--vscode-focusBorder);
  }
  &:active {
    background-color: var(--vscode-sash-hoverBorder);
  }
  &:focus {
    background-color: var(--vscode-sash-hoverBorder);
  }
`;

const Content = styled.div.attrs<ResizerProps>((props) => ({
  style: {
    width: props.size ? `calc(100vw - ${props.size}px)` : `calc(100vw - 500px)`,
  },
}))`
  display: flex;
  flex-direction: column;
  user-select: none;
`;

const HeaderFrame = styled.div`
  border-bottom: 1px solid var(--vscode-textBlockQuote-border);
`;

const CollapserDiv = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  &:hover {
    color: var(--vscode-focusBorder);
    border: solid 1px var(--vscode-focusBorder);
  }
  bottom: 8px;
  left: 8px;
  position: absolute;
  border-radius: 9999px;
  border: solid 1px var(--vscode-foreground);
  height: 32px;
  width: 32px;
`;

const BodyFrame = styled.div`
  flex: flex-grow;
  height: calc(100vh - 80px);
`;

const Container = styled.div`
  padding: 18px;
`;

const Tree = styled.div.attrs<ResizerProps>((props) => ({
  style: {
    width: props.size ? `${props.size}px` : "calc(100% - 18px)",
  },
}))`
  padding-top: 18px;
  padding-bottom: 18px;
  padding-left: 8px;
  padding-right: 8px;
`;

const ensureIds = (trace: TraceItem) => {
  if (!trace.id) {
    trace.id = uuidv4().toString();
  }
  if (trace.__frames) {
    trace.__frames.forEach(ensureIds);
  }
};

function App() {
  const [isDragging, setIsDragging] = useState(false);
  const [width, setWidth] = useState(500);
  const [treeWidth, setTreeWidth] = useState<number | undefined>(undefined);
  const [collapsed, setCollapsed] = useState(false);

  const traceStore = usePersistStore(useTraceStore, (state) => state);
  const traceItemStore = usePersistStore(useCurrentStore, (state) => state);

  const treeRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<HTMLDivElement | null>(null);

  const refreshView = (trace: object) => {
    // Ensure trace is of type Trace
    if (!("trace" in trace) || typeof trace.trace !== "object") {
      vscode.postMessage({
        command: "error",
        text: "Invalid trace data structure.",
      });
      return;
    }

    if (!trace || !trace.trace) {
      vscode.postMessage({
        command: "error",
        text: "No trace data available.",
      });
      return;
    }

    const t = trace as Trace;
    ensureIds(t.trace);
    traceStore?.setTrace(t);
    traceItemStore?.setTraceItem(t.trace);

    vscode.postMessage({
      command: "trace",
      text: "Loaded trace data successfully.",
    });
  };

  const fetchLocalTrace = () => {
    fetch("/example.tracy")
      .then((response) => response.json())
      .then((trace) => {
        refreshView(trace);
      })
      .catch((error) => {
        vscode.postMessage({
          command: "error",
          text: `Failed to fetch local trace: ${error instanceof Error ? error.message : String(error)}`,
        });
      });
  };

  const handleMessage = (event: MessageEvent) => {
    const message = event.data;
    if (message.command === "trace") {
      const t = JSON.parse(message.text);
      refreshView(t);
    } else if (message.command === "error") {
      vscode.postMessage({
        command: "error",
        text: message.text,
      });
    }
  };

  useEffect(() => {
    if (vscode.isVSCodeContext()) {
      vscode.registerCallback(handleMessage);
      vscode.postMessage({
        command: "ready",
      });
    } else {
      console.warn(vscode.warningMessage);
      fetchLocalTrace();
    }
  }, [traceStore?.setTrace, traceItemStore?.setTraceItem]);

  const handleResize = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (isDragging) {
      setWidth((prevWidth) => Math.max(100, prevWidth + e.movementX));
    }
  };

  useEffect(() => {
    if (treeRef.current && sidebarRef.current) {
      if (
        sidebarRef.current.scrollWidth > sidebarRef.current.clientWidth &&
        !treeWidth
      ) {
        setTreeWidth(sidebarRef.current.scrollWidth);
      }
      if (
        sidebarRef.current.scrollWidth === sidebarRef.current.clientWidth &&
        treeWidth
      ) {
        setTreeWidth(undefined);
      }
    }
  }, [width, treeRef, sidebarRef]);

  useEffect(() => {
    if (collapsed) {
      setWidth(48);
      if (sidebarRef.current) {
        sidebarRef.current.style.cursor = "pointer";
      }
    } else {
      setWidth(treeWidth ? treeWidth + 18 : 500);
    }
  }, [collapsed]);

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseDown = () => {
    setIsDragging(true);
  };

  function activateSidebar(): void {
    if (collapsed && sidebarRef.current) {
      if (sidebarRef.current) {
        sidebarRef.current.style.cursor = "default";
      }
      setCollapsed(false);
    }
  }

  return (
    <>
      <GlobalStyle />
      <Frame onMouseUp={handleMouseUp} onMouseMove={handleResize}>
        <Sidebar ref={sidebarRef} size={width} onClick={activateSidebar}>
          <Tree ref={treeRef} size={treeWidth}>
            {!collapsed && traceStore?.trace && traceStore?.trace.trace && (
              <TraceTree
                trace={traceStore?.trace.trace}
                level={0}
                hidden={false}
                setTraceItem={(t) => traceItemStore?.setTraceItem(t)}
              />
            )}
          </Tree>
          <CollapserDiv onClick={() => setCollapsed(!collapsed)}>
            <Collapser collapsed={collapsed} setCollapsed={setCollapsed} />
          </CollapserDiv>
        </Sidebar>
        {!collapsed && (
          <SideBarResizer size={4} onMouseDown={handleMouseDown} />
        )}
        <Content size={width}>
          <HeaderFrame>
            <Container>
              {traceStore?.trace && traceItemStore?.traceItem && (
                <Header
                  trace={traceItemStore?.traceItem}
                  runtime={traceStore?.trace.runtime}
                  version={traceStore?.trace.version}
                />
              )}
            </Container>
          </HeaderFrame>
          <BodyFrame>
            {traceItemStore?.traceItem && (
              <TraceDetail trace={traceItemStore?.traceItem} />
            )}
          </BodyFrame>
        </Content>
        <ModalCollection />
      </Frame>
    </>
  );
}

export default App;
