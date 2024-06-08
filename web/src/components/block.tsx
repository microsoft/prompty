import clsx from "clsx";
import { ReactNode } from "react";

type Props = {
  children: ReactNode;
  outerClassName?: string;
  innerClassName?: string;
};

const Block = ({ children, outerClassName, innerClassName }: Props) => {
  return (
    <div className={clsx(outerClassName)}>
      <div
        className={clsx("max-w-screen-xl pl-3 pr-3 xl:mx-auto", innerClassName)}
      >
        {children}
      </div>
    </div>
  );
};

export default Block;
