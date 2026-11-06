const server = Bun.serve({
  port: 5899,
  fetch(req) {
    const url = new URL(req.url);
    const filePath = `docs${url.pathname === "/" ? "/architecture-ai.html" : url.pathname}`;
    const file = Bun.file(filePath);
    return new Response(file);
  },
});
console.log(`Diagram server listening on http://localhost:${server.port}`);
