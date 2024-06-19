"use client";
import clsx from "clsx";
import { useEffect, useState } from "react";
import mermaid from "mermaid";

type Props = {
  code: string;
};

const Graph = ({ code }: Props) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);



  if (!mounted) {
    return (
      <pre>
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div>{code}</div>
  );
};

export default Graph;
