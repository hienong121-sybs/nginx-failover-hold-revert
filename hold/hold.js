const http = require("http");
const net = require("net");

const HOLD_PORT = Number(process.env.PORT || 4000);

const MAIN_HOST = process.env.MAIN_HOST || "demo-app";
const MAIN_PORT = Number(process.env.MAIN_PORT || 3000);

const CHECK_INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS || 200);
const MAX_WAIT_MS = Number(process.env.MAX_WAIT_MS || 90000);

const AUTO_STOP = (process.env.AUTO_STOP_WHEN_MAIN_UP || "false") === "true";
const MAIN_STABLE_MS = Number(process.env.MAIN_STABLE_MS || 5000);
const IDLE_BEFORE_STOP_MS = Number(process.env.IDLE_BEFORE_STOP_MS || 1500);

let inflight = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function canConnect(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.removeAllListeners();
      try { socket.destroy(); } catch {}
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function waitForMainOrTimeout() {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await canConnect(MAIN_HOST, MAIN_PORT);
    if (ok) return true;
    // eslint-disable-next-line no-await-in-loop
    await sleep(CHECK_INTERVAL_MS);
  }
  return false;
}

function proxyToMain(req, res) {
  const options = {
    host: MAIN_HOST,
    port: MAIN_PORT,
    method: req.method,
    path: req.url,
    headers: {
      ...req.headers,
      host: req.headers.host,
      "x-forwarded-for": req.socket.remoteAddress || "",
      "x-forwarded-proto": req.headers["x-forwarded-proto"] || "http",
    },
  };

  const upstream = http.request(options, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });

  upstream.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end(`Upstream error: ${err.message}`);
  });

  req.pipe(upstream);
}

async function watchdogAutoStop() {
  if (!AUTO_STOP) return;

  while (true) {
    // Wait for MAIN stable continuously for MAIN_STABLE_MS
    const stableStart = Date.now();
    while (Date.now() - stableStart < MAIN_STABLE_MS) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await canConnect(MAIN_HOST, MAIN_PORT);
      if (!ok) {
        await sleep(CHECK_INTERVAL_MS);
        // reset window
        continue;
      }
      await sleep(CHECK_INTERVAL_MS);
    }

    // MAIN stable, wait until no inflight then stop
    while (inflight > 0) {
      await sleep(200);
    }
    await sleep(IDLE_BEFORE_STOP_MS);

    if (inflight === 0) {
      console.log("MAIN stable + no inflight => HOLD self-stopping to save resources.");
      process.exit(0);
    }
  }
}

const server = http.createServer(async (req, res) => {
  inflight++;

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    inflight--;
  };

  res.on("close", finish);
  res.on("finish", finish);

  const ok = await waitForMainOrTimeout();

  if (!ok) {
    res.writeHead(504, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("MAIN not ready (timeout).");
    return;
  }

  proxyToMain(req, res);
});

server.headersTimeout = 0;
server.requestTimeout = 0;

server.listen(HOLD_PORT, "0.0.0.0", () => {
  console.log(`HOLD+REVERT listening :${HOLD_PORT}, waiting MAIN ${MAIN_HOST}:${MAIN_PORT}`);
  watchdogAutoStop().catch((e) => console.error("watchdog error:", e));
});
