import Block from "@/components/block";
import Header from "@/components/nav/header";
import Main from "@/components/nav/main";
import { VERSION } from "@/lib/version";

export default function Home() {
  return (
    <>
      <Header innerClassName="h-12 flex flex-row center items-center gap-5">
        <Main />
      </Header>
      <Block>
        <h1 className="text-4xl font-bold">Welcome to Prompty.ai</h1>
        <p className="text-lg mt-2">
          This is a starter template for a Next.js app with Tailwind CSS.
        </p>
        <p className="text-lg mt-2">
          <a href="">wwj</a>
        </p>
      </Block>
      <Block>
        <h1 className="text-4xl font-bold">Welcome to Prompty.ai</h1>
        <p className="text-lg mt-2">
          This is a starter template for a Next.js app with Tailwind CSS.
        </p>
        <p className="text-lg mt-2">
          <a href="">wwj</a>
        </p>
      </Block>
    </>
  );
}
