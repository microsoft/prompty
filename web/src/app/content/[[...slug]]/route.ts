import path from "path";
import { promises as fs } from "fs";

type Params = Promise<{ slug?: string[] }>;

export async function GET(
  request: Request,
  segmentData: { params: Params }
) {
  const params = await segmentData.params;
  if (params.slug) {
    const file = path.normalize(
      path.join(...[process.cwd(), "docs", ...params.slug])
    );
    try {
      const content = await fs.readFile(file);
      return new Response(content);
    } catch (e) {
      // nonexistent file, check if its an author image
      if (params.slug[0] === "authors") {
        
        const content = await fs.readFile(
          path.join(
            ...[process.cwd(), "public", "assets", "prompty_p.svg"]
          )
        );
        return new Response(content, {
          headers: {
            "Content-Type": "image/svg+xml",
          },
        });
      }
      return new Response("Not Found", { status: 404 });
    }
  }
  return new Response("Not Found", { status: 404 });
}
