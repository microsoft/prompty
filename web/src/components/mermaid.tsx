"use client";
import clsx from "clsx";
import { useEffect, useState } from "react";
import mermaid from "mermaid";

type Props = {
  code: string;
};

let loaded = false;

const Mermaid = ({ code }: Props) => {
  useEffect(() => {
    if (!loaded) {
      mermaid.initialize({
        startOnLoad: true,
        darkMode: true,
      });
      loaded = true;
    }
  }, []);

  return (
    <div>
      <pre className="mermaid">{code}</pre>
    </div>
  );
};

export default Mermaid;
