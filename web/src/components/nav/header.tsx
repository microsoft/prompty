"use client";
import Block from "@/components/block";
import { useTheme } from "next-themes";
import { usePathname } from "next/navigation";
import { HiBars3, HiXMark, HiSun, HiMoon } from "react-icons/hi2";
import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
} from "@headlessui/react";

import Link from "next/link";

import styles from "./header.module.scss";
import { navigation } from "@/lib/navigation";

const Header = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const otherTheme = resolvedTheme === "dark" ? "light" : "dark";
  const pathname = usePathname();

  const isCurrent = (src: string) =>
    pathname.toLowerCase().includes(src.toLowerCase());

  return (
    <header>
      <Disclosure as="nav">
        {({ open }) => (
          <>
            <Block innerClassName={styles.header}>
              <div className={styles.disclosure}>
                <DisclosureButton className={styles.disclosureButton}>
                  {open ? (
                    <HiXMark className={styles.icon} aria-hidden="true" />
                  ) : (
                    <HiBars3 className={styles.icon} aria-hidden="true" />
                  )}
                </DisclosureButton>
              </div>

              <div className={styles.logo}>
                <Link href="/">
                  <img src="/assets/images/prompty32x32.png" />
                </Link>
              </div>
              <div className={styles.menu}>
                <div className={styles.menuItems}>
                  <nav>
                    {navigation.map((item) => (
                      <a
                        key={item.title}
                        href={
                          item.href.endsWith("/") ? item.href : `${item.href}/`
                        }
                        className={styles.menuItem}
                        aria-current={isCurrent(item.href) ? "page" : undefined}
                      >
                        {item.title}
                      </a>
                    ))}
                  </nav>
                </div>
              </div>
              <div
                className={styles.themeSwitcher}
                onClick={() => setTheme(otherTheme)}
              >
                <HiSun className={styles.themeLight} />
                <HiMoon className={styles.themeDark} />
              </div>
            </Block>
            <DisclosurePanel className={styles.disclosurePanel}>
              <div className={styles.panel}>
                {navigation.map((item) => (
                  <DisclosureButton
                    key={item.title}
                    as="a"
                    href={item.href.endsWith("/") ? item.href : `${item.href}/`}
                    className={styles.panelMenuItem}
                    aria-current={isCurrent(item.href) ? "page" : undefined}
                  >
                    {item.title}
                  </DisclosureButton>
                ))}
              </div>
            </DisclosurePanel>
          </>
        )}
      </Disclosure>
    </header>
  );
};

export default Header;
