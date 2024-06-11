"use client";
import React, { ReactNode, useState } from "react";
import Block from "../block";
import { VERSION } from "@/lib/version";
import { Index, navigation } from "@/lib/navigation";
import clsx from "clsx";
import { HiChevronDoubleRight, HiChevronDoubleDown } from "react-icons/hi2";

type Props = {
  index: Index[];
  depth?: number;
  visible?: boolean;
};

const Toc = ({ index, depth, visible }: Props) => {
  const [expanded, setExpanded] = useState<boolean>(true);
  const hasChildren = (index: Index) =>
    index.children && index.children.length > 0;

  const toggleExpansion = (index: Index) => {
    if (hasChildren(index)) {
      setExpanded(!expanded);
    }
  };

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
        <div key={`main_${item.path}_${i}`}>
          <div
            className={clsx(
              "flex flex-row p-2 dark:hover:bg-zinc-600 hover:bg-zinc-200 align-middle items-center",
              depth === 0 ? "" : "ml-4",
              visible ? "block" : "hidden"
            )}
            onClick={() => toggleExpansion(item)}
          >
            <a href={item.path} onClick={(e) => e.stopPropagation()}>{item.document?.title}</a>
            <div className="grow items"></div>
            {hasChildren(item) && (
              <div>
                {expanded ? (
                  <HiChevronDoubleDown
                    className="h-4 w-4 hover:cursor-pointer"
                    onClick={() => setExpanded(false)}
                  />
                ) : (
                  <HiChevronDoubleRight
                    className="h-4 w-4 hover:cursor-pointer"
                    onClick={() => setExpanded(true)}
                  />
                )}
              </div>
            )}
          </div>
          {hasChildren(item) && (
            <Toc
              index={item.children}
              depth={depth + 1}
              visible={expanded}
              key={`toc_${item.path}`}
            />
          )}
        </div>
      ))}
    </>
  );
};

export default Toc;
