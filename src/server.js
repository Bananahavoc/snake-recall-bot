import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");

const port = Number(process.env.PORT || 3030);
const recallRegion = process.env.RECALL_REGION || "us-west-2";
const recallBaseUrl =
  process.env.RECALL_BASE_URL || `https://${recallRegion}.recall.ai`;
const recallApiKey = process.env.RECALL_API_KEY || "";
const recallBotId = process.env.RECALL_BOT_ID || "";
const recallWebhookToken = process.env.RECALL_WEBHOOK_TOKEN || "";
const chatMessageLimit = Number(process.env.RECALL_CHAT_CHAR_LIMIT || 500);

const sseClients = new Set();
const participantFrames = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function json(res, code, payload) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
  for (const res of sseClients) {
    sendSse(res, event, data);
  }
}

async function readJsonBody(req, maxBytes = 8 * 1024 * 1024) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}

function toAuthHeader(apiKey) {
  if (
    apiKey.startsWith("Token ") ||
    apiKey.startsWith("Bearer ") ||
    apiKey.startsWith("token ")
  ) {
    return apiKey;
  }
  return `Token ${apiKey}`;
}

async function sendRecallChatMessage(message, pin = false, to = "everyone") {
  if (!recallApiKey || !recallBotId) {
    return {
      ok: false,
      skipped: true,
      reason: "RECALL_API_KEY or RECALL_BOT_ID is not configured"
    };
  }

  const trimmedMessage = String(message || "").trim();
  if (!trimmedMessage) {
    return { ok: false, skipped: true, reason: "Empty message" };
  }

  const capped = trimmedMessage.slice(0, chatMessageLimit);
  const response = await fetch(
    `${recallBaseUrl}/api/v1/bot/${recallBotId}/send_chat_message/`,
    {
      method: "POST",
      headers: {
        Authorization: toAuthHeader(recallApiKey),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to,
        message: capped,
        pin: Boolean(pin)
      })
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Recall chat failed (${response.status}): ${text}`);
  }

  return { ok: true };
}

function extractParticipant(data) {
  const participant = data?.participant || {};
  return {
    id: String(participant.id || "unknown"),
    name: participant.name || participant.display_name || "Unknown participant"
  };
}

function routeRealtimeEvent(payload) {
  const event = payload?.event;
  if (!event) {
    return { ignored: true, reason: "Missing event key" };
  }

  if (event === "video_separate_png.data") {
    const data = payload?.data?.data || {};
    const participant = extractParticipant(data);
    if (typeof data.buffer === "string" && data.buffer.length > 0) {
      const imageDataUrl = `data:image/png;base64,${data.buffer}`;
      const frame = {
        participantId: participant.id,
        participantName: participant.name,
        imageDataUrl,
        updatedAt: Date.now()
      };
      participantFrames.set(participant.id, frame);
      broadcast("participant_frame", frame);
      return { ok: true, routed: "participant_frame" };
    }
    return { ignored: true, reason: "Missing PNG buffer" };
  }

  if (event === "transcript.partial_data" || event === "transcript.data") {
    const data = payload?.data?.data || {};
    const participant = extractParticipant(data);
    const words = Array.isArray(data.words) ? data.words : [];
    const text = words.map((word) => word?.text || "").join(" ").trim();
    const firstWord = words[0] || null;
    const utteranceKey = `${participant.id}:${firstWord?.start_timestamp?.relative ?? "no_ts"}`;

    broadcast("transcript", {
      event,
      participant,
      words,
      text,
      utteranceKey,
      receivedAt: Date.now()
    });
    return { ok: true, routed: "transcript" };
  }

  return { ignored: true, reason: `Unsupported event: ${event}` };
}

function shouldAllowWebhook(urlObj, req) {
  if (!recallWebhookToken) {
    return true;
  }

  const queryToken = urlObj.searchParams.get("token");
  const headerToken = req.headers["x-recall-token"];
  return queryToken === recallWebhookToken || headerToken === recallWebhookToken;
}

async function serveStatic(pathname, res) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, cleanPath));

  if (!filePath.startsWith(publicDir)) {
    json(res, 403, { error: "Forbidden path" });
    return;
  }

  if (!existsSync(filePath)) {
    json(res, 404, { error: "Not found" });
    return;
  }

  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) {
    json(res, 404, { error: "Not found" });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType =
    mimeTypes[ext] || "application/octet-stream; charset=utf-8";

  res.writeHead(200, { "Content-Type": contentType });
  createReadStream(filePath).pipe(res);
}

function routeSse(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });

  sseClients.add(res);
  sendSse(res, "snapshot", {
    participants: Array.from(participantFrames.values())
  });

  const heartbeat = setInterval(() => {
    sendSse(res, "heartbeat", { ts: Date.now() });
  }, 20000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
}

const server = createServer(async (req, res) => {
  const urlObj = new URL(req.url || "/", `http://${req.headers.host}`);
  const { pathname } = urlObj;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization"
    });
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && pathname === "/health") {
      json(res, 200, {
        ok: true,
        sseClients: sseClients.size,
        participantsTracked: participantFrames.size
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/events") {
      routeSse(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/api/recall/events") {
      if (!shouldAllowWebhook(urlObj, req)) {
        json(res, 401, { ok: false, error: "Invalid webhook token" });
        return;
      }

      const payload = await readJsonBody(req);
      const result = routeRealtimeEvent(payload);
      json(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === "POST" && pathname === "/api/chat") {
      const body = await readJsonBody(req);
      const chatResult = await sendRecallChatMessage(
        body.message,
        Boolean(body.pin),
        body.to || "everyone"
      );
      json(res, 200, chatResult);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(pathname, res);
      return;
    }

    json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    json(res, 500, { error: error.message || "Internal server error" });
  }
});

server.listen(port, () => {
  console.log(`Snake output-media app listening on http://localhost:${port}`);
});
