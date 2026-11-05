
const http = require("http");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.TV_WEBHOOK_TOKEN;
const BOT_TOKEN = process.env.BOT_READ_TOKEN;

const signals = new Map();
const MAX_AGE_MS = 15 * 60 * 1000;

const SUPPORTED_TIMEFRAMES = new Set([
  "1", "2", "3", "5", "10",
  "15", "30", "45", "60"
]);

function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });

  res.end(JSON.stringify(data));
}

function authorized(actual, expected) {
  if (
    typeof actual !== "string" ||
    typeof expected !== "string" ||
    !actual ||
    !expected
  ) {
    return false;
  }

  const a = Buffer.from(actual);
  const b = Buffer.from(expected);

  return a.length === b.length &&
    crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;

    req.on("data", chunk => {
      if (tooLarge) return;

      body += chunk;

      if (Buffer.byteLength(body, "utf8") > 4096) {
        tooLarge = true;
        reject(new Error("Payload too large"));
      }
    });

    req.on("end", () => {
      if (!tooLarge) resolve(body);
    });

    req.on("error", reject);
  });
}

function normalizeTimeframe(value) {
  const raw = String(value ?? "").trim().toUpperCase();

  let timeframe = raw;

  if (raw === "H1" || raw === "1H") {
    timeframe = "60";
  } else if (/^M\d+$/.test(raw)) {
    timeframe = raw.substring(1);
  }

  return SUPPORTED_TIMEFRAMES.has(timeframe)
    ? timeframe
    : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  // HEALTH CHECK
  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, {
      success: true,
      service: "DG-TradingView-Receiver",
      version: "universal-v3",
      ready: Boolean(TOKEN && BOT_TOKEN),
      checks: {
        webhookTokenLoaded: Boolean(TOKEN),
        botTokenLoaded: Boolean(BOT_TOKEN)
      },
      supportedTimeframes: [...SUPPORTED_TIMEFRAMES],
      cachedTimeframes: [...signals.keys()],
      time: new Date().toISOString()
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
      ).trim().toUpperCase();

      const timeframe = normalizeTimeframe(
        data.timeframe
      );

      const symbol = String(
        data.symbol || ""
      ).trim().toUpperCase();

      if (
        !["BUY", "SELL"].includes(action) ||
        !timeframe ||
        !["XAUUSD", "XAU/USD"].includes(symbol)
      ) {
        return send(res, 400, {
          error: "Invalid signal",
          supportedTimeframes: [...SUPPORTED_TIMEFRAMES]
        });
      }

      const signal = {
        id: crypto.randomUUID(),
        action,
        symbol: "XAUUSD",
        timeframe,
        receivedAt: new Date().toISOString()
      };

      // Independent signal storage for every timeframe
      signals.set(timeframe, signal);

      console.log(
        `[TradingView] M${timeframe} ${action} received: ${signal.id}`
      );

      return send(res, 200, {
        success: true,
        signal
      });

    } catch (error) {
      return send(res, 400, {
        error: "Invalid JSON or payload"
      });
    }
  }

  // CTRADER SIGNAL ENDPOINT
  if (req.method === "GET" && url.pathname === "/signal") {
    const token = req.headers["x-bot-token"];

    if (!authorized(token, BOT_TOKEN)) {
      return send(res, 401, {
        error: "Unauthorized"
      });
    }

    const timeframe = normalizeTimeframe(
      url.searchParams.get("timeframe")
    );

    if (!timeframe) {
      return send(res, 400, {
        error: "Invalid timeframe",
        supportedTimeframes: [...SUPPORTED_TIMEFRAMES]
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
    `DG TradingView Universal Receiver V3 listening on ${PORT}`
  );

  console.log(
    "Supported timeframes:",
    [...SUPPORTED_TIMEFRAMES].join(", ")
  );
});
