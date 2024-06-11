"use client";
import clsx from "clsx";
import { useEffect, useState } from "react";

type Props = {
  code: string;
};

const Mermaid = ({ code }: Props) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);



  if (!mounted) {
    return (
      <pre className="rounded-xl bg-zinc-100 dark:bg-zinc-900 p-3 flex flex-col relative text-sm">
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div>{code}</div>
  );
};

export default Mermaid;
