import { resolve, sep } from "node:path";

const siteRoot = resolve(import.meta.dir, "../dist");
const port = Number(Bun.env.LILYPOND_EDITOR_PORT ?? Bun.env.PORT ?? 3000);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    let pathname: string;

    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    if (pathname.endsWith("/")) {
      pathname += "index.html";
    }

    const filePath = resolve(siteRoot, `.${pathname}`);
    const isInsideSite =
      filePath === siteRoot || filePath.startsWith(`${siteRoot}${sep}`);

    if (!isInsideSite) {
      return new Response("Forbidden", { status: 403 });
    }

    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return new Response("Not found", { status: 404 });
    }

    return new Response(request.method === "HEAD" ? null : file, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": file.type,
      },
    });
  },
});

console.log(`Serving ${siteRoot} at ${server.url}`);
