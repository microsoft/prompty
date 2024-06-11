import path from "path";
import { cache } from "react";
import { BASE } from "@/lib/base";
import { promises as fs } from "fs";
import Code from "@/components/code";
import Block from "@/components/block";
import Mermaid from "@/components/mermaid";
import { IDocument, Index } from "@/lib/navigation";
import Footer from "@/components/nav/footer";
import Header from "@/components/nav/header";
import { compileMDX } from "next-mdx-remote/rsc";
import { Metadata, ResolvingMetadata } from "next";

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
        const code = children.props.children
          ? children.props.children.trim()
          : "";
        const lang = children.props.className || "";

        const items = lang.split("-");
        if (items.length === 2) {
          const lang = items[1];
          if (lang === "mermaid") {
            return <Mermaid code={code} />;
          } else {
            return <Code language={items[1]} code={code} />;
          }
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

const getIndex = async () => {
  const contents = await fs.readFile(
    process.cwd() + "/docs/docs.json",
    "utf-8"
  );
  const index: Index = JSON.parse(contents);
  return index;
}

const getCachedIndex = cache(getIndex);
const getCachedContent = cache(getContent);

export async function generateMetadata(
  { params }: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const slug = params.slug ? params.slug : [];
  const { metadata } = await getCachedContent(slug);
  const previousImages = (await parent).openGraph?.images || [];
  const currentImages = metadata.images
    ? metadata.images.map((image) => {
        return image.startsWith("http")
          ? image
          : `${BASE}/${["content", ...slug, image].join("/")}`;
      })
    : [];

  return {
    title: metadata.title,
    description: metadata.description,
    authors: metadata.authors
      ? metadata.authors.map((author) => {
          return {
            name: author,
            url: `https://github.com/${author}`,
          };
        })
      : [],
    openGraph: {
      images: [...previousImages, ...currentImages],
    },
    icons: [
      "/assets/images/favicon-16x16.png",
      "/assets/images/favicon-32x32.png",
    ],
  };
}

export default async function Page({ params }: Props) {
  const slug = params.slug ? params.slug : [];
  const { content, metadata } = await getCachedContent(slug);
  const index = await getCachedIndex();
  const children = index.children.sort((a, b) => (a.document ? a.document.index : 0) - (b.document ? b.document.index : 0) );

  const items =
    slug.length === 0
      ? index
      : children.find((item) => item.path === `/docs/${slug[0]}`);

  return (
    <>
      <Header innerClassName="h-12 flex flex-row center items-center gap-3">
        {children.map((item) => (
          <div key={item.path}>
            <a href={item.path}>{item.document?.title}</a>
          </div>
        ))}
      </Header>
      <Block>
        <div className="flex flex-row gap-1">
          <div className="bg-zinc-100 dark:bg-zinc-700 rounded-md w-[250px] p-2">
            {items &&
              items.children.map((item) => (
                <div key={item.path}>
                  <a href={item.path}>{item.document?.title}</a>
                </div>
              ))}
          </div>
          <div className="p-2 grow">
            <div className="text-2xl md:text-4xl font-bold mb-4">
              {metadata.title}
            </div>
            <div className="flex flex-row mb-6">
              {metadata.authors && (
                <div className="isolate flex -space-x-2 overflow-hidden p-1">
                  {metadata.authors.map((author) => {
                    return (
                      <a
                        href={`https://github.com/${author}`}
                        key={author}
                        className="hover:cursor-pointer"
                      >
                        <img
                          className="relative z-30 inline-block h-8 w-8 rounded-full ring-2 ring-zinc-300 dark:ring-zinc-100"
                          src={`https://github.com/${author}.png`}
                          alt={author}
                        />
                      </a>
                    );
                  })}
                </div>
              )}
              <div className="ml-3">
                {metadata.date && (
                  <div className="text-sm text-zinc-500 dark:text-zinc-400">
                    {new Date(Date.parse(metadata.date)).toLocaleDateString()}
                  </div>
                )}
                {metadata.tags && (
                  <div className="text-sm text-zinc-500 dark:text-zinc-400">
                    {metadata.tags.join(", ")}
                  </div>
                )}
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
        {children.map((item) => (
          <div key={item.path}>
            <a href={item.path}>{item.document?.title}</a>
          </div>
        ))}
      </Footer>
    </>
  );
}
