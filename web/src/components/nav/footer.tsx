import React, { ReactNode } from "react";
import { VERSION } from "@/lib/version";
import Block from "@/components/block";
import clsx from "clsx";
import { navigation } from "@/lib/navigation";
import styles from "./footer.module.scss";
import Image from "next/image";

const Footer = () => {
  return (
    <footer>
      <Block
        outerClassName={styles.footer}
        innerClassName={styles.footerContainer}
      >
        <div className={styles.menuItems}>
          <nav>
            {navigation.map((item) => (
              <a key={item.href} className={styles.menuItem} href={item.href}>
                {item.title}
              </a>
            ))}
          </nav>
        </div>
        <div className={styles.grow}></div>
        <div className={styles.sponsored}>
          <div className={styles.sponsoredText}>Sponsored by:</div>
          <Image
            src="/assets/images/microsoft-dark.png"
            className={styles.darkIcon}
            title="Microsoft"
            height={40}
            width={150}
            alt="Microsoft"
          />
          <Image
            src="/assets/images/microsoft-light.png"
            className={styles.lightIcon}
            title="Microsoft"
            height={40}
            width={150}
            alt="Microsoft"
          />
          <div className={styles.version}>
            {VERSION}
          </div>
        </div>
      </Block>
    </footer>
  );
};

export default Footer;
