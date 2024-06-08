"use client";
import React, { useEffect, useState } from "react";
import { HiMoon, HiSun } from "react-icons/hi2";
import { FaGithub } from "react-icons/fa";
import { useTheme } from "next-themes";

const Main = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const otherTheme = resolvedTheme === "dark" ? "light" : "dark";
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      <div className="text-slate-200">
        <a href="/">
          <img src="assets/images/prompty32x32.png" />
        </a>
      </div>
      <div>
        <a href="/docs">Docs</a>
      </div>
      <div>
        <a href="/blog">Blog</a>
      </div>
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
    </>
  );
};

export default Main;
