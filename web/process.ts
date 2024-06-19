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

const statPath = async (path: string): Promise<string> => {
  try {
    await pfs.access(path);
  } catch (e) {
    await pfs.mkdir(path);
  }
  return path;
};

const fetchAuthor = (author: string): Promise<void> => {
  return new Promise(async (resolve, reject) => {
    const imageUrl = `https://github.com/${author}.png`;
    https.get(imageUrl, (res) => {
      if (res.statusCode === 302) {
        if (res.headers.location) {
          console.log("fetching image for author", author, imageUrl);
          https.get(res.headers.location, (res) => {
            const file = fs.createWriteStream(
              path.posix.join(docsDir, "authors", `${author}.png`)
            );

            res.pipe(file);

            file.on("finish", () => {
              file.close();
              resolve();
            });

            file.on("error", (err) => {
              console.error("Error writing data:", err);
              reject(err);
            });
          });
        }
      }
    });
  });
};

const processAuthors = async (index: Index, processed: string[] = []) => {
  if (index.document && index.document.authors) {
    // check if authors directory exists

    for (const author of index.document.authors) {
      if (processed.includes(author)) continue;
      // fetch authors image
      await fetchAuthor(author);
    }
    processed.push(...index.document.authors);
  }

  if (index.children) {
    index.children.forEach(async (child) => {
      await processAuthors(child, processed);
    });
  }
};

indexdocs().then(async (items) => {
  console.log("pre-processing complete");
  // write the index to a file
  await pfs.writeFile("./docs/docs.json", JSON.stringify(items, null, 2));
  console.log("index written to file");

  const args = process.argv.slice(2);
  if (args.includes("--authors") && items) {
    // check authors directory
    const authorDir = path.posix.join(docsDir, "authors");
    try {
      await pfs.access(authorDir);
    } catch (e) {
      await pfs.mkdir(authorDir);
    }
    console.log("processing authors");
    await processAuthors(items);
    console.log("author processing complete");
  }
});
