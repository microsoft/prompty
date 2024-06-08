"use client";
import clsx from "clsx";
import { ReactNode } from "react";
import React, { useEffect, useState } from "react";
import { HiMoon, HiSun } from "react-icons/hi2";
import { FaGithub } from "react-icons/fa";
import { useTheme } from "next-themes";
import { navigation } from "@/lib/navigation";

type Props = {
  children: ReactNode;
  outerClassName?: string;
  innerClassName?: string;
};

const Header = ({ children, outerClassName, innerClassName }: Props) => {
    const { resolvedTheme, setTheme } = useTheme();
    const otherTheme = resolvedTheme === "dark" ? "light" : "dark";
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
      setMounted(true);
    }, []);
  return (
    <header className={clsx(outerClassName)}>
      <div
        className={clsx("max-w-screen-xl pl-3 pr-3 xl:mx-auto", innerClassName)}
      >
        <div className="text-slate-200">
          <a href="/">
            <img src="assets/images/prompty32x32.png" />
          </a>
        </div>
        {children}
        <div className="grow" />

        <div className="flex flex-row items-center gap-2">
          <button
            type="button"
            aria-label={
              mounted ? `Switch to ${otherTheme} theme` : "Toggle theme"
            }
            onClick={() => setTheme(otherTheme)}
          >
            <HiSun className="h-6 w-6 dark:hidden fill-sky-600" />
            <HiMoon className="hidden h-6 w-6 transition dark:block fill-sky-600" />
          </button>
        </div>
        <div className="flex flex-row items-center hover:cursor-pointer">
          <a href="https://github.com/Microsoft/prompty/" target="_blank">
            <FaGithub className="h-6 w-6 fill-stone-950 dark:fill-stone-50" />
          </a>
        </div>
      </div>
    </header>
  );
};

export default Header;
