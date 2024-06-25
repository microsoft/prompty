"use client";
import React, { useState, useRef } from "react";
import { Index } from "@/lib/navigation";
import clsx from "clsx";
import { HiChevronDoubleRight, HiChevronDoubleDown } from "react-icons/hi2";
import { set } from "mermaid/dist/diagrams/state/id-cache.js";

type Props = {
  index: Index[];
  depth?: number;
  visible?: boolean;
};

const Toc = ({ index, depth, visible }: Props) => {
  const [expanded, setExpanded] = useState<boolean>(true);
  const divRef = useRef<HTMLDivElement>(null);

  const hasChildren = (index: Index) =>
    index.children && index.children.length > 0;

  const toggleExpansion = (index: Index) => {
    if (hasChildren(index)) {
      setExpanded(!expanded);
    }
  };

  const toggleChildren = () => {
    if (divRef.current) {
      setExpanded(!expanded);
      divRef.current.style.display = expanded ? "none" : "block";
    }
  }

  if (!depth) {
    depth = 0;
    visible = true;
  }
  const sorted = index.sort(
    (a, b) =>
      (a.document ? a.document.index : 0) - (b.document ? b.document.index : 0)
  );

  return (
    <>
      {sorted.map((item, i) => (
        <div key={`main_${item.path}`} className={clsx(`ml-${depth * 2 + 2}`)}
        style={{"marginLeft": `${depth}rem`}}>
          <div
            className={clsx(
              "flex flex-row p-2 dark:hover:bg-zinc-600 hover:bg-zinc-200 align-middle items-center",
              visible ? "block" : "hidden"
            )}
            onClick={() => toggleChildren()}
          >
            <a href={item.path} onClick={(e) => e.stopPropagation()}>
              {item.document?.title}
            </a>
            <div className="grow items"></div>
            {hasChildren(item) && (
              <div>
                {expanded ? (
                  <HiChevronDoubleDown
                    className="h-4 w-4 hover:cursor-pointer"
                    onClick={() => toggleChildren()}
                  />
                ) : (
                  <HiChevronDoubleRight
                    className="h-4 w-4 hover:cursor-pointer"
                    onClick={() => toggleChildren()}
                  />
                )}
              </div>
            )}
          </div>
          {hasChildren(item) && (
            <div ref={divRef}>
              <Toc
                index={item.children}
                depth={depth + 1}
                visible={expanded}
                key={`toc_${item.path}`}
              />
            </div>
          )}
        </div>
      ))}
    </>
  );
};

export default Toc;
