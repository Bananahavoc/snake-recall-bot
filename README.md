# Recall Snake Output-Media App

Snake web app designed for Recall output media:

- waits in a simple lobby until someone says `start` (or `resume`)
- steers on new utterances of `up`, `down`, `left`, `right`
- uses only the most recent queued direction between ticks
- tracks who issued the last direction
- on death, freezes and overlays that participant's most recent PNG frame with red `LOSER`
- stays on death frame until someone says `restart`
- sends Recall chat messages for rules, command acknowledgements, and death blame

## Why 16:9

Recall output media webpage rendering is fixed to **1280x720** (16:9).  
This app's stage is locked to 16:9 so framing is stable in Recall recordings.

## Endpoints

- `GET /` -> snake UI
- `GET /api/events` -> SSE stream for frontend (`transcript`, `participant_frame`)
- `POST /api/recall/events` -> Recall realtime webhook receiver
- `POST /api/chat` -> relay to Recall `send_chat_message`
- `GET /health` -> basic health check

## Environment

Set these before running:

- `PORT` (optional, default `3030`)
- `RECALL_API_KEY` (required for chat relay and bot creation)
- `RECALL_BOT_ID` (required for `/api/chat`, set after bot creation)
- `RECALL_REGION` (default `us-west-2`)
- `RECALL_BASE_URL` (optional override)
- `RECALL_WEBHOOK_TOKEN` (optional shared secret for `/api/recall/events`)
- `RECALL_CHAT_CHAR_LIMIT` (optional, default `500`)

For bot creation script:

- `RECALL_MEETING_URL`
- `OUTPUT_MEDIA_URL` (public URL to this app, e.g. your tunnel URL)
- `RECALL_REALTIME_WEBHOOK_URL` (public URL to `/api/recall/events`)
- `RECALL_BOT_NAME` (optional)

## Run

```bash
npm start
```

## Create a Google Meet bot

```bash
npm run create-bot
```

The script creates a bot with:

- `output_media.camera.kind = webpage` pointing at `OUTPUT_MEDIA_URL`
- transcript enabled (`meeting_captions`)
- realtime webhook events:
  - `transcript.partial_data`
  - `transcript.data`
  - `video_separate_png.data`
- `variant.google_meet = web_4_core`

After bot creation, export the returned bot id into `RECALL_BOT_ID` so the app can send chat messages.
