const http = require("http");

const port = Number(process.env.PORT || 3000);

http.createServer((req, res) => {
  const body =
`✅ MAIN(3000)
time: ${new Date().toISOString()}
method: ${req.method}
url: ${req.url}
`;
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}).listen(port, "0.0.0.0", () => {
  console.log(`MAIN listening on :${port}`);
});
