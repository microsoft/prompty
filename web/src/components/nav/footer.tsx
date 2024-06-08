import React, { ReactNode } from "react";
import Block from "../block";
import { VERSION } from "@/lib/version";
import { navigation } from "@/lib/navigation";
import clsx from "clsx";

type Props = {
  children: ReactNode;
  outerClassName?: string;
  innerClassName?: string;
};

const Footer = ({ children, outerClassName, innerClassName }: Props) => {
  return (
    <footer className={clsx(outerClassName)}>
      <div
        className={clsx("max-w-screen-xl pl-3 pr-3 xl:mx-auto", innerClassName)}
      >
        <div className="flex flex-row gap-5 mt-6">
          {children}
          <div className="grow"></div>
          <div className="flex flex-col gap-1">
            <div className="text-right mr-1">Sponsored by:</div>
            <img
              src="/assets/images/microsoft-dark.png"
              className="hidden dark:block"
            />
            <img
              src="/assets/images/microsoft-light.png"
              className="block dark:hidden"
            />
            <div className="text-right mr-1 text-zinc-300 dark:text-zinc-700">
              {VERSION}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
