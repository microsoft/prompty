import Block from "@/components/block";
import Footer from "@/components/nav/footer";
import Header from "@/components/nav/header";
import { promises as fs } from "fs";
import path from "path";
import CodeBlock from "@/components/code";
import { IDocument } from "@/lib/navigation";
import { compileMDX } from "next-mdx-remote/rsc";
import { cache } from "react";
import { Metadata, ResolvingMetadata } from "next";
import { headers } from "next/headers";
import { BASE } from "@/lib/base";

type Props = {
  params: { slug?: string[] };
};

const getComponents = (slug: string[]) => {
  return {
    img: (props: any) => {
      const { src, ...rest } = props;
      if (src.startsWith("http")) {
        return <img src={src} {...rest} />;
      } else {
        const file = path.normalize(path.join("/content", ...slug, src));
        return <img src={file} {...rest} />;
      }
    },
    pre: (props: any) => {
      const { children, ...rest } = props;
      if (children.type === "code") {
        const code = children.props.children.trim();
        const lang = children.props.className || "";
        const items = lang.split("-");
        if (items.length === 2) {
          return <CodeBlock language={items[1]} code={code} />;
        }
        return <pre {...rest}>{children}</pre>;
      } else {
        return <pre {...rest}>{children}</pre>;
      }
    },
  };
};

const fetchMDX = async (slug: string[]) => {
  const source = await fs.readFile(
    process.cwd() + "/docs/" + slug.join("/") + "/page.mdx",
    "utf-8"
  );

  return source;
};

const getContent = async (slug: string[]) => {
  const source = await fetchMDX(slug);
  const components = getComponents(slug);

  const { content, frontmatter } = await compileMDX({
    source: source,
    options: { parseFrontmatter: true },
    components: components,
  });

  const metadata = frontmatter as IDocument;
  return {
    content,
    metadata,
  };
};

const getCachedContent = cache(getContent);

export async function generateMetadata(
  { params }: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const slug = params.slug ? params.slug : [];
  const { metadata } = await getCachedContent(slug);
  const previousImages = (await parent).openGraph?.images || [];
  const currentImages = metadata.images.map((image) => {
    return image.startsWith("http")
      ? image
      : `${BASE}/${["content", ...slug, image].join("/")}`;
  });

  return {
    title: metadata.title,
    description: metadata.description,
    authors: metadata.authors.map((author) => {
      return {
        name: author,
        url: `https://github.com/${author}`,
      };
    }),
    openGraph: {
      images: [...previousImages, ...currentImages],
    },
  };
}

export default async function Page({ params }: Props) {
  const slug = params.slug ? params.slug : [];
  const { content, metadata } = await getCachedContent(slug);

  return (
    <>
      <Header innerClassName="h-12 flex flex-row center items-center gap-3">
        <div>My thing</div>
      </Header>
      <Block>
        <div className="flex flex-row gap-1">
          <div className="bg-zinc-100 dark:bg-zinc-700 rounded-md w-[250px] p-2">
            LEFT
          </div>
          <div className="p-2 grow">
            <div className="text-2xl md:text-4xl font-bold mb-4">
              {metadata.title} - lorem ipsum dolor consequetor imlat fogtkison
            </div>
            <div className="flex flex-row">
              <div className="isolate flex -space-x-2 overflow-hidden p-1">
                {metadata.authors.map((author) => {
                  return (
                    <a
                      href={`https://github.com/${author}`}
                      key={author}
                      className="hover:cursor-pointer"
                    >
                      <img
                        className="relative z-30 inline-block h-10 w-10 rounded-full ring-2 ring-zinc-300 dark:ring-zinc-100"
                        src={`https://github.com/${author}.png`}
                        alt={author}
                      />
                    </a>
                  );
                })}
              </div>
              <div className="ml-3 mb-6">
                <div className="text-sm text-zinc-500 dark:text-zinc-400">
                  {new Date(Date.parse(metadata.date)).toLocaleDateString()}
                </div>
                <div className="text-sm text-zinc-500 dark:text-zinc-400">
                  {metadata.tags.join(", ")}
                </div>
              </div>
            </div>
            <div>{content}</div>
          </div>
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
