import path from "path";
import { cache } from "react";
import { BASE } from "@/lib/base";
import { promises as fs } from "fs";
import Code from "@/components/code";
import Block from "@/components/block";
import Mermaid from "@/components/mermaid";
import { IDocument, Index, navigation } from "@/lib/navigation";
import Footer from "@/components/nav/footer";
import Header from "@/components/nav/header";
import { compileMDX } from "next-mdx-remote/rsc";
import { Metadata, ResolvingMetadata } from "next";
import { HiOutlinePencilSquare, HiOutlinePencil } from "react-icons/hi2";
import Toc from "@/components/nav/toc";

type Props = {
  params: Promise<{ slug: string[] }>;
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
};

const getCachedIndex = cache(getIndex);
const getCachedContent = cache(getContent);

export async function generateMetadata(
  { params }: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const slug = (await params).slug || [];
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

const normalize = (index: Index): string[] => {
  const items = [index.path.replace("/docs", "")];
  if (index.children) {
    index.children.forEach((child) => {
      items.push(...normalize(child));
    });
  }
  return items;
};

export async function generateStaticParams() {
  const index = await getCachedIndex();
  const posts = normalize(index);
  return posts.map((post) => ({
    slug: post.split("/").slice(1),
  }));
}

export default async function Page({ params }: Props) {
  const slug = (await params).slug || [];
  const { content, metadata } = await getCachedContent(slug);
  const index = await getCachedIndex();

  return (
    <>
      <Block>
        <div className="flex flex-col md:flex-row gap-1">
          <div className="bg-zinc-100 dark:bg-zinc-700 md:w-[224px] w- rounded-md p-2 mb-2 md:mb-0">
            <Toc index={index.children} visible={true} />
          </div>
          <div className="ml-1 md:ml-6 md:w-[calc(100%-256px)]">
            <div className="flex flex-row mb-4 gap-4">
              <div className="text-2xl md:text-4xl font-bold ">
                {metadata.title}
              </div>
              <div className="flex flex-row gap-2">
                <a
                  href={`https://github.com/microsoft/prompty/edit/main/web/docs/${slug.join(
                    "/"
                  )}/page.mdx`}
                  className="flex flex-col align-middle justify-center"
                  title="Edit this page on GitHub"
                  target="_blank"
                >
                  <HiOutlinePencil className="w-6 h-6" />
                </a>
                <a
                  href={`https://github.dev/microsoft/prompty/blob/main/web/docs/${slug.join(
                    "/"
                  )}/page.mdx`}
                  className="flex flex-col align-middle justify-center"
                  title="Edit this page on GitHub.dev"
                  target="_blank"
                >
                  <HiOutlinePencilSquare className="w-6 h-6" />
                </a>
              </div>
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
                        target="_blank"
                      >
                        <img
                          className="relative z-30 inline-block h-8 w-8 rounded-full ring-2 ring-zinc-300 dark:ring-zinc-100"
                          src={`/content/authors/${author}.png`}
                          alt={author}
                        />
                      </a>
                    );
                  })}
                </div>
              )}
              <div className="ml-3 flex flex-col justify-center align-middle">
                {metadata.date && (
                  <div className="text-base md:text-lg text-zinc-500 dark:text-zinc-400">
                    {new Date(Date.parse(metadata.date)).toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>
            <div className="prose-lg prose-pre:mt-0 prose-pre:mb-0 prose-pre:pt-0 prose-pre:pb-0 prose-h1:mb-1 prose-h2:mb-1 prose-h1:mt-4 prose-h2:mt-3 dark:prose-invert">
              {content}
            </div>
          </div>
        </div>
      </Block>
    </>
  );
}
