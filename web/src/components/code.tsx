"use client";
import clsx from "clsx";
import { ReactNode, useEffect, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  vscDarkPlus,
  vs,
} from "react-syntax-highlighter/dist/cjs/styles/prism";
import { VscCopy } from "react-icons/vsc";
import { useTheme } from "next-themes";

type Props = {
  language: string;
  code: string;
};

const CodeBlock = ({ language, code }: Props) => {
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
      <pre className="rounded-xl bg-zinc-100 dark:bg-zinc-900 p-3 flex flex-col relative text-sm">
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div className="rounded-xl bg-zinc-100 dark:bg-zinc-900 p-3 flex flex-col relative mt-3 mb-3">
      <div className="flex flex-row absolute right-3 top-3 gap-1 items-centered align-middle">
        <div className="grow"></div>
        <div
          className={clsx(
            "text-sm text-zinc-500 dark:text-zinc-400 ",
            copied
              ? "transition-all duration-100 opacity-100"
              : "transition-all duration-1000 opacity-0"
          )}
        >
          Copied!
        </div>
        <div>
          <button
            type="button"
            onClick={copyToClipboard}
            className="hover:cursor-pointer"
          >
            <VscCopy className="h-5 w-5 fill-sky-600 " />
          </button>
        </div>
      </div>
      <SyntaxHighlighter
        codeTagProps={{
          className: "text-xs md:text-sm xl:text-base text-zinc-800 dark:text-sky-200 text-left",
        }}
        customStyle={{
          background: theme === "dark" ? "#18181b" : "#f4f4f5",
          border: "none",
          padding: "0",
        }}
        style={theme === "dark" ? vscDarkPlus : vs}
        language={language}
        showLineNumbers={true}
        wrapLongLines={true}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
};

export default CodeBlock;
