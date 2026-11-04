
const http = require("http");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.TV_WEBHOOK_TOKEN;
const BOT_TOKEN = process.env.BOT_READ_TOKEN;

const signals = new Map();
const MAX_AGE_MS = 15 * 60 * 1000;

function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function authorized(actual, expected) {
  if (!actual || !expected) return false;

  const a = Buffer.from(actual);
  const b = Buffer.from(expected);

  return a.length === b.length &&
    crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;

      if (body.length > 4096) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  // HEALTH CHECK - DIAGNOSTIC V2
  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, {
      success: true,
      service: "DG-TradingView-Receiver",
      ready: Boolean(TOKEN && BOT_TOKEN),
      checks: {
        webhookTokenLoaded: Boolean(TOKEN),
        botTokenLoaded: Boolean(BOT_TOKEN)
      },
      version: "diagnostic-v2"
    });
  }

  // TRADINGVIEW WEBHOOK
  if (req.method === "POST" && url.pathname === "/webhook") {
    try {
      const data = JSON.parse(await readBody(req));

      if (!authorized(data.token, TOKEN)) {
        return send(res, 401, {
          error: "Unauthorized"
        });
      }

      const action = String(
        data.action || ""
      ).toUpperCase();

      const timeframe = String(
        data.timeframe || ""
      );

      const symbol = String(
        data.symbol || ""
      ).toUpperCase();

      if (
        !["BUY", "SELL"].includes(action) ||
        !["5", "15"].includes(timeframe) ||
        !["XAUUSD", "XAU/USD"].includes(symbol)
      ) {
        return send(res, 400, {
          error: "Invalid signal"
        });
      }

      const key = timeframe;

      const signal = {
        id: crypto.randomUUID(),
        action,
        symbol: "XAUUSD",
        timeframe,
        receivedAt: new Date().toISOString()
      };

      signals.set(key, signal);

      return send(res, 200, {
        success: true,
        signal
      });

    } catch (error) {
      return send(res, 400, {
        error: "Invalid JSON"
      });
    }
  }

  // CTRADER BOT SIGNAL ENDPOINT
  if (req.method === "GET" && url.pathname === "/signal") {
    const token = req.headers["x-bot-token"];

    if (!authorized(token, BOT_TOKEN)) {
      return send(res, 401, {
        error: "Unauthorized"
      });
    }

    const timeframe = url.searchParams.get("timeframe");

    if (!["5", "15"].includes(timeframe)) {
      return send(res, 400, {
        error: "Invalid timeframe"
      });
    }

    const signal = signals.get(timeframe);

    if (
      !signal ||
      Date.now() - Date.parse(signal.receivedAt) > MAX_AGE_MS
    ) {
      return send(res, 200, {
        success: true,
        signal: null
      });
    }

    return send(res, 200, {
      success: true,
      signal
    });
  }

  return send(res, 404, {
    error: "Not found"
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `DG TradingView Receiver listening on ${PORT}`
  );
});
