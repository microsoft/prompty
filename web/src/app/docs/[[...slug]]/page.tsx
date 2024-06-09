import Block from "@/components/block";
import Footer from "@/components/nav/footer";
import Header from "@/components/nav/header";
import { promises as fs } from "fs";
import { MDXRemote, compileMDX } from "next-mdx-remote/rsc";

async function getData(slug?: string[]) {
  const components = {
    img: (props: any) => {
      const { src, ...rest } = props;
      return <img src={"/content/" + src} {...rest} />;
    },
  };

  const source = await fs.readFile(
    process.cwd() + "/docs/" + "page.mdx",
    "utf-8"
  );
  const serialized = await compileMDX({
    source: source,
    options: { parseFrontmatter: true },
    components: components,
  });
  return serialized;
}

export default async function Page({
  params,
}: {
  params: { slug?: string[] };
}) {
  const { content, frontmatter } = await getData(params.slug);

  return (
    <>
      <Header innerClassName="h-12 flex flex-row center items-center gap-3">
        <div>My thing</div>
      </Header>
      <Block>
        <div className="flex flex-row gap-1">
          <div className="bg-slate-400 rounded-md w-[250px] p-2">LEFT</div>
          <div className="bg-slate-500 rounded-md grow p-2">{content}</div>
        </div>
      </Block>
      <Block>
        <div>
          <div>HERE</div>
          <div>{params.slug ? "EXISTS" : "NOT EXISTS"}</div>
          {params.slug && (
            <>
              <div>{params.slug.length}</div>
              <div>{params.slug.join("/")}</div>
            </>
          )}
        </div>
      </Block>
      <Footer
        outerClassName="mt-8 mb-8"
        innerClassName="border-t-[1px] border-zinc-300 dark:border-zinc-700"
      >
        <div>My thing</div>
      </Footer>
    </>
  );
}
