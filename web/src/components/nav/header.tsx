import clsx from "clsx";
import { ReactNode } from "react";

type Props = {
  children: ReactNode;
  outerClassName?: string;
  innerClassName?: string;
};

const Header = ({ children, outerClassName, innerClassName }: Props) => {
  return (
    <header className={clsx(outerClassName)}>
      <div
        className={clsx("max-w-screen-xl pl-3 pr-3 xl:mx-auto", innerClassName)}
      >
        {children}
      </div>
    </header>
  );
};

export default Header;
