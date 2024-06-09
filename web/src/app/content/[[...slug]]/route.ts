import { promises as fs } from "fs";

export async function GET(
  request: Request,
  { params }: { params: { slug?: string[] } }
) {
  //console.log("params", params.slug);
  const image = await fs.readFile(process.cwd() + "/docs/runtime.png");

  return new Response(image, {
    headers: {
      "Content-Type": "image/png",
    },
  });
}
