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
import { TraceItem, useTraceStore, useCurrentStore } from "./store";
import { GlobalStyle } from "./utilities/styles";
import Collapser from "./components/collapser";

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
  align-items: flex-start;
  padding-bottom: 8px;
	
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
  const [trace, setTrace] = useTraceStore((state) => [
    state.trace,
    state.setTrace,
  ]);
  const [traceItem, setTraceItem] = useCurrentStore((state) => [
    state.traceItem,
    state.setTraceItem,
  ]);

  const treeRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof acquireVsCodeApi !== "function") {
      fetch("/example.tracy")
        .then((response) => response.json())
        .then((t) => {
          // add ids to trace
          ensureIds(t.trace);
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
        setTrace(t);
        setTraceItem(t.trace);
      }
    });
  }, [setTrace, setTraceItem]);

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
		if(collapsed) {
			setWidth(38);
			if(sidebarRef.current) {
				sidebarRef.current.style.cursor = "pointer";
			}
		} else {
			setWidth(treeWidth ? treeWidth : 500);
		}
	}, [collapsed]);

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseDown = () => {
    setIsDragging(true);
  };

	function activateSidebar(): void {
		if(collapsed && sidebarRef.current) {
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
            <CollapserDiv>
              <Collapser collapsed={collapsed} setCollapsed={setCollapsed} />
            </CollapserDiv>
            {!collapsed && trace && trace.trace && (
              <TraceTree
                trace={trace?.trace}
                level={0}
                hidden={false}
                setTraceItem={(t) => setTraceItem(t)}
              />
            )}
          </Tree>
        </Sidebar>
        {!collapsed && (
          <SideBarResizer size={4} onMouseDown={handleMouseDown} />
        )}
        <Content size={width}>
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
          <BodyFrame>
            {traceItem && <TraceDetail trace={traceItem!} />}
          </BodyFrame>
        </Content>
        <ModalCollection />
      </Frame>
    </>
  );
}

export default App;
