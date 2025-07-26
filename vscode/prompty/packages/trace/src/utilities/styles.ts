import { createGlobalStyle } from "styled-components";


export const GlobalStyle = createGlobalStyle`
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  
  ::-webkit-scrollbar-track {
    background: var(--vscode-scrollbarSlider-background);
    border-radius: 50%;
  }
  
  ::-webkit-scrollbar-thumb {
    background: var(--vscode-scrollbarSlider-activeBackground);
    border-radius: 50px;
    box-shadow:0px 0px 6px 2px var(--vscode-scrollbar-shadow);
  }

  body {
    margin: 0;
    background-color: var(--vscode-editor-background);
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    width: calc(100vw - 22px);
    height: calc(100vh);
    overflow: hidden;
  }

  #root {
    margin: 0;
    background-color: var(--vscode-editor-background);
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    height: 100%;
    width: 100%;
    overflow: hidden;
  }

  p {
    margin: 0;
  }

  a {
    color: var(--vscode-textLink-foreground);
  }
`;