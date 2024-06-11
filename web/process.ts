import path from "path";
import { promises as fs } from "fs";
import * as matter from "gray-matter";
import { IDocument, Index } from "./src/lib/navigation";

const docsDir = path.posix.join(process.cwd(), "docs");

export const indexdocs = async (dir?: string) => {
  // if no directory is provided, use the current working directory
  if (!dir) {
    dir = docsDir;
  }

  const docs = await fs.readdir(dir, {
    encoding: "utf-8",
  });
  
  let index: Index | undefined = undefined;
  if (docs && docs.includes("page.mdx")) {
    const page = path.posix.join(dir, "page.mdx");
    const content = await fs.readFile(page, "utf-8");
    const items = matter.default(content).data as IDocument;

    index = {
      path: dir === docsDir ? "/docs" : `/docs/${dir.replace(docsDir, "").replace("/", "")}`,
      document: items,
      children: [],
    };

    for (const doc of docs) {
      const docPath = path.posix.join(dir, doc);
      const stats = await fs.stat(docPath);
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

indexdocs().then((items) => {
  console.log("\n\npre-processing complete");
  // write the index to a file
  fs.writeFile("./docs/docs.json", JSON.stringify(items, null, 2)).then(() => {
    console.log("docs.json written");
  });
});
