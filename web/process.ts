import path from "path";
import { promises as pfs } from "fs";
import fs from "fs";
import * as matter from "gray-matter";
import { IDocument, Index } from "./src/lib/navigation";
import https from "https";

const docsDir = path.posix.join(process.cwd(), "docs");

export const indexdocs = async (dir?: string) => {
  // if no directory is provided, use the current working directory
  if (!dir) {
    dir = docsDir;
  }

  const docs = await pfs.readdir(dir, {
    encoding: "utf-8",
  });

  let index: Index | undefined = undefined;
  if (docs && docs.includes("page.mdx")) {
    const page = path.posix.join(dir, "page.mdx");
    const content = await pfs.readFile(page, "utf-8");
    const items = matter.default(content).data as IDocument;

    index = {
      path:
        dir === docsDir
          ? "/docs"
          : `/docs/${dir.replace(docsDir, "").replace("/", "")}`,
      document: items,
      children: [],
    };

    for (const doc of docs) {
      const docPath = path.posix.join(dir, doc);
      const stats = await pfs.stat(docPath);
      const relativePath = docPath.replace(docsDir, "").replace("/", "");
      if (stats.isDirectory()) {
        if (!relativePath.startsWith("_")) {
          const children = await indexdocs(docPath);
          if (children) {
            index.children.push(children);
          }
        }
      }
    }
  }

  return index;
};

const processAuthors = (index: Index) => {
  if (index.document && index.document.authors) {
    // check if folder exists for each author
    index.document.authors.forEach(async (author) => {
      const authorDir = path.posix.join(docsDir, "authors", author);
      try {
        await pfs.access(authorDir);
      } catch (e) {
        await pfs.mkdir(authorDir);
      }
      // fetch authors image
      const imageUrl = `https://github.com/${author}.png`;
      const image = https.get(imageUrl, (res) => {
        const file = fs.createWriteStream(path.posix.join(authorDir, `${author}.png`));
        res.pipe(file);

        file.on("finish", () => {
          file.close();
        });

        file.on("error", (err) => {
          console.error("Error writing data:", err);
        });
      });
    });

    console.log(index.document.authors);
  }
  if (index.children) {
    index.children.forEach((child) => {
      processAuthors(child);
    });
  }
};

indexdocs().then(async (items) => {
  console.log("pre-processing complete");
  // write the index to a file
  await pfs.writeFile("./docs/docs.json", JSON.stringify(items, null, 2));
  console.log("index written to file");
});
