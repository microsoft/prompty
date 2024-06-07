"use client";

import React from "react";
import Image from "next/image";
import {
  ArrowTopRightOnSquareIcon,
  NewspaperIcon,
} from "@heroicons/react/24/solid";

const Main = () => {
  return (
    <>
      <div className="text-slate-200">
        <img src="assets/images/prompty32x32.png" />
      </div>
      <div
        className="text-sky-300 hover:text-sky-700 hover:cursor-pointer"
        onClick={() => alert("ME!dfgvdfgbvdfgbdfgdfgb!!!")}
      >
        Docs
      </div>
      <div>Blog</div>
      <div className="grow" />
      <div className="flex flex-row items-center gap-2">
        <Image
          src="/assets/github_icon.svg"
          alt="GitHub logo icon of Octocat"
          width={24}
          height={24}
        />
        <div>GitHub</div>
        <ArrowTopRightOnSquareIcon className="w-6 h-6 stroke-slate-400 rounded-full hover:cursor-pointer" />
      </div>
    </>
  );
};

export default Main;
