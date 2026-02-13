#!/usr/bin/env node

const apiKey = process.env.RECALL_API_KEY || "";
const region = process.env.RECALL_REGION || "us-west-2";
const baseUrl = process.env.RECALL_BASE_URL || `https://${region}.recall.ai`;
const meetingUrl = process.env.RECALL_MEETING_URL || "";
const outputMediaUrl = process.env.OUTPUT_MEDIA_URL || "";
const webhookUrl = process.env.RECALL_REALTIME_WEBHOOK_URL || "";
const webhookToken = process.env.RECALL_WEBHOOK_TOKEN || "";
const botName = process.env.RECALL_BOT_NAME || "Snake Host";

if (!apiKey) {
  console.error("Missing RECALL_API_KEY");
  process.exit(1);
}

if (!meetingUrl) {
  console.error("Missing RECALL_MEETING_URL");
  process.exit(1);
}

if (!outputMediaUrl) {
  console.error("Missing OUTPUT_MEDIA_URL");
  process.exit(1);
}

if (!webhookUrl) {
  console.error("Missing RECALL_REALTIME_WEBHOOK_URL");
  process.exit(1);
}

const webhookWithToken = webhookToken
  ? `${webhookUrl}${webhookUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(webhookToken)}`
  : webhookUrl;

function authHeader(value) {
  if (
    value.startsWith("Token ") ||
    value.startsWith("Bearer ") ||
    value.startsWith("token ")
  ) {
    return value;
  }
  return `Token ${value}`;
}

const payload = {
  meeting_url: meetingUrl,
  bot_name: botName,
  output_media: {
    camera: {
      kind: "webpage",
      config: {
        url: outputMediaUrl
      }
    }
  },
  recording_config: {
    transcript: {
      provider: {
        meeting_captions: {}
      }
    },
    video_separate_png: {},
    realtime_endpoints: [
      {
        type: "webhook",
        url: webhookWithToken,
        events: [
          "transcript.partial_data",
          "transcript.data",
          "video_separate_png.data"
        ]
      }
    ]
  },
  variant: {
    google_meet: "web_4_core"
  }
};

const response = await fetch(`${baseUrl}/api/v1/bot/`, {
  method: "POST",
  headers: {
    Authorization: authHeader(apiKey),
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
});

if (!response.ok) {
  const text = await response.text();
  console.error(`Create bot failed (${response.status}): ${text}`);
  process.exit(1);
}

const bot = await response.json();
console.log(JSON.stringify(bot, null, 2));
