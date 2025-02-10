import path from "path";
import { cache } from "react";
import { BASE } from "@/lib/base";
import { promises as fs } from "fs";
import Code from "@/components/code";
import Block from "@/components/block";
import Mermaid from "@/components/mermaid";
import { IDocument, Index } from "@/lib/navigation";
import { compileMDX } from "next-mdx-remote/rsc";
import { Metadata, ResolvingMetadata } from "next";
import { HiOutlinePencilSquare, HiOutlinePencil } from "react-icons/hi2";
import Toc from "@/components/nav/toc";
import styles from "./page.module.scss";

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
      <Block innerClassName={styles.page}>
        <div className={styles.toc}>
          <Toc index={index.children} visible={true} />
        </div>
        <div className={styles.contentContainer}>
          <div className={styles.titleSection}>
            <div className={styles.title}>{metadata.title}</div>
            <div className={styles.links}>
              <a
                href={`https://github.com/microsoft/prompty/edit/main/web/docs/${slug.join(
                  "/"
                )}/page.mdx`}
                className={styles.linkIcon}
                title="Edit this page on GitHub"
                target="_blank"
              >
                <HiOutlinePencil className={styles.icon} />
              </a>
              <a
                href={`https://github.dev/microsoft/prompty/blob/main/web/docs/${slug.join(
                  "/"
                )}/page.mdx`}
                className={styles.linkIcon}
                title="Edit this page on GitHub.dev"
                target="_blank"
              >
                <HiOutlinePencilSquare className={styles.icon} />
              </a>
            </div>
          </div>
          <div className={styles.authorContainer}>
            {metadata.authors && (
              <div className={styles.authorIcons}>
                {metadata.authors.map((author) => {
                  return (
                    <a
                      href={`https://github.com/${author}`}
                      key={author}
                      target="_blank"
                    >
                      <img
                        className={styles.authorIcon}
                        src={`/content/authors/${author}.png`}
                        alt={author}
                      />
                    </a>
                  );
                })}
              </div>
            )}
              {metadata.date && (
                <div className={styles.date}>
                  <div>{new Date(Date.parse(metadata.date)).toLocaleDateString()}</div>
                </div>
              )}
          </div>
          <div className={styles.content}>
            {content}
          </div>
        </div>
      </Block>
    </>
  );
}
