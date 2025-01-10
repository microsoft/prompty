"use client";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  oneDark,
  oneLight,
} from "react-syntax-highlighter/dist/cjs/styles/prism";
import { VscCopy } from "react-icons/vsc";
import { useTheme } from "next-themes";
import styles from "./Code.module.scss";

type Props = {
  language: string;
  code: string;
};

const Code = ({ language, code }: Props) => {
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 1000);
  };

  if (!mounted) {
    return (
      <pre className={styles.preCode}>
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div className={styles.codeContainer}>
      <div className={styles.codeHeader}>
        <div className={styles.grow}></div>
        <div
          className={clsx(
            styles.copyText,
            copied ? styles.easeIn : styles.easeOut
          )}
        >
          Copied!
        </div>
        <div>
          <button
            type="button"
            onClick={copyToClipboard}
            className={styles.copyButton}
          >
            <VscCopy className={styles.copyIcon} />
          </button>
        </div>
      </div>
      <SyntaxHighlighter
        codeTagProps={{
          className: styles.highlighter,
        }}
        customStyle={{
          background:
            theme === "dark" ? styles.darkBackground : styles.lightBackground,
          border: "none",
          padding: "0",
          fontStyle: "normal",
        }}
        style={theme === "dark" ? oneDark : oneLight}
        language={language}
        showLineNumbers={true}
        wrapLongLines={true}
        lineNumberStyle={{
          fontStyle: "normal",
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
};

export default Code;