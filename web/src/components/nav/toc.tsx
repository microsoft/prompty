"use client";
import clsx from "clsx";
import { Index } from "@/lib/navigation";
import { usePathname } from "next/navigation";
import React, { useState, useRef } from "react";
import { HiChevronDoubleRight, HiChevronDoubleDown } from "react-icons/hi2";

type Props = {
  index: Index[];
  depth?: number;
  visible?: boolean;
};

const Toc = ({ index, depth, visible }: Props) => {
  const pathname = usePathname();
  const sorted = index.sort(
    (a, b) =>
      (a.document ? a.document.index : 0) - (b.document ? b.document.index : 0)
  );

  const hasCurrentChild = (index: Index) => {
    if (index.path === pathname) {
      return true;
    }
    if (index.children) {
      for (const child of index.children) {
        if (hasCurrentChild(child)) {
          return true;
        }
      }
    }
    return false;
  };

  const [expanded, setExpanded] = useState<boolean[]>(
    sorted.map((value, index) => hasCurrentChild(value))
  );
  const divRef = useRef<HTMLDivElement>(null);

  const hasChildren = (index: Index) =>
    index.children && index.children.length > 0;

  const toggleExpansion = (i: number) => {
    const index = [...expanded];
    index[i] = !index[i];
    setExpanded(index);
  };

  if (!depth) {
    depth = 0;
    visible = true;
  }

  return (
    <>
      {sorted.map((item, i) => (
        <div
          key={`main_${item.path}`}
          className={clsx(`ml-${depth * 2 + 2}`)}
          style={{ marginLeft: `${depth}rem` }}
        >
          <div
            className={clsx(
              "flex flex-row p-2 dark:hover:bg-zinc-600 hover:bg-zinc-200 align-middle items-center",
              visible ? "block" : "hidden"
            )}
            onClick={() => toggleExpansion(i)}
          >
            <a href={item.path} onClick={(e) => e.stopPropagation()}>
              {item.document?.title}
            </a>
            <div className="grow items"></div>
            {hasChildren(item) && (
              <div>
                {expanded[i] ? (
                  <HiChevronDoubleDown
                    className="h-4 w-4 hover:cursor-pointer"
                    onClick={() => toggleExpansion(i)}
                  />
                ) : (
                  <HiChevronDoubleRight
                    className="h-4 w-4 hover:cursor-pointer"
                    onClick={() => toggleExpansion(i)}
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
                visible={expanded[i]}
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
