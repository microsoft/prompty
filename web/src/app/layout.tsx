import "./global.scss";
import { ThemeProvider } from "next-themes";
import styles from "./layout.module.scss";
import Header from "@/components/nav/header";
import Footer from "@/components/nav/footer";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={styles.body}>
        <ThemeProvider>
          <div className={styles.container}>
            <Header />
            {children}
            <Footer />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
