"use client";
import clsx from "clsx";
import { useEffect, useState } from "react";
import mermaid from "mermaid";
import { useTheme } from "next-themes";

type Props = {
  code: string;
};

let loaded = false;

const Mermaid = ({ code }: Props) => {
  const { theme } = useTheme();
  const [svg, setSvg] = useState<string>("");

  useEffect(() => {
    const init = async () => {
      mermaid.initialize({
        startOnLoad: false,
        //theme: "base",
        //darkMode: false,
        themeVariables: {
          //fontFamily: 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji',    
          //fontSize: "32px",    
        },
      });
      const { svg } = await mermaid.render("graphDiv", code);
      setSvg(svg);
    };

    if (!loaded) {
      console.log(theme);
      init();
      loaded = true;
    }

  }, [code]);

  return (
    <div
      className={clsx(
        "bg-zinc-50 rounded-xl p-3 mb-3 dark:border dark:border-zinc-800",
        svg === "" ? "hidden" : "block"
      )}
      dangerouslySetInnerHTML={{ __html: svg }}
    ></div>
  );
};

export default Mermaid;
