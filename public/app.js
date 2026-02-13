const GRID_COLS = 32;
const GRID_ROWS = 18;
const TICK_MS = 150;
const MAX_LOG_ITEMS = 8;
const MAX_UTTERANCE_CACHE = 300;

const statePillEl = document.getElementById("statePill");
const scorePillEl = document.getElementById("scorePill");
const lastCommandEl = document.getElementById("lastCommand");
const waitingOverlayEl = document.getElementById("waitingOverlay");
const deathOverlayEl = document.getElementById("deathOverlay");
const loserImageEl = document.getElementById("loserImage");
const loserNameEl = document.getElementById("loserName");
const participantsEl = document.getElementById("participants");
const commandLogEl = document.getElementById("commandLog");
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const GAME_STATE = {
  WAITING: "WAITING",
  RUNNING: "RUNNING",
  DEAD: "DEAD"
};

const directionVectors = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 }
};

const oppositeDirection = {
  UP: "DOWN",
  DOWN: "UP",
  LEFT: "RIGHT",
  RIGHT: "LEFT"
};

let gameState = GAME_STATE.WAITING;
let snake = [];
let food = { x: 0, y: 0 };
let direction = "RIGHT";
let pendingDirection = null;
let score = 0;

let lastCommander = null;
let deathCommanderSnapshot = null;

const participantFrames = new Map();
const commandLog = [];
const processedUtterances = new Map();

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function resetSnakeGame() {
  snake = [
    { x: 8, y: 9 },
    { x: 7, y: 9 },
    { x: 6, y: 9 },
    { x: 5, y: 9 }
  ];
  direction = "RIGHT";
  pendingDirection = null;
  score = 0;
  food = spawnFood();
}

function spawnFood() {
  while (true) {
    const candidate = { x: randomInt(GRID_COLS), y: randomInt(GRID_ROWS) };
    const taken = snake.some((part) => part.x === candidate.x && part.y === candidate.y);
    if (!taken) {
      return candidate;
    }
  }
}

function updateStatePill() {
  statePillEl.textContent = gameState;
  statePillEl.classList.remove("waiting", "running", "dead");
  if (gameState === GAME_STATE.WAITING) {
    statePillEl.classList.add("waiting");
  } else if (gameState === GAME_STATE.RUNNING) {
    statePillEl.classList.add("running");
  } else {
    statePillEl.classList.add("dead");
  }
}

function updateScore() {
  scorePillEl.textContent = `Score: ${score}`;
}

function setWaitingOverlayVisible(visible) {
  waitingOverlayEl.classList.toggle("hidden", !visible);
}

function setDeathOverlayVisible(visible) {
  deathOverlayEl.classList.toggle("hidden", !visible);
}

function addCommandLog(message) {
  commandLog.unshift(message);
  if (commandLog.length > MAX_LOG_ITEMS) {
    commandLog.length = MAX_LOG_ITEMS;
  }

  commandLogEl.innerHTML = "";
  for (const item of commandLog) {
    const li = document.createElement("li");
    li.textContent = item;
    commandLogEl.appendChild(li);
  }
}

function renderParticipants() {
  participantsEl.innerHTML = "";
  const frames = Array.from(participantFrames.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  for (const frame of frames.slice(0, 6)) {
    const card = document.createElement("div");
    card.className = "participant-card";

    const img = document.createElement("img");
    img.src = frame.imageDataUrl;
    img.alt = frame.participantName;

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = frame.participantName;

    card.appendChild(img);
    card.appendChild(name);
    participantsEl.appendChild(card);
  }
}

function updateLastCommandText(directionName = null, participantName = null) {
  if (!directionName || !participantName) {
    lastCommandEl.textContent = "None yet";
    return;
  }
  lastCommandEl.textContent = `${participantName} -> ${directionName}`;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const nextWidth = Math.max(1, Math.floor(rect.width * dpr));
  const nextHeight = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
}

function drawGame() {
  resizeCanvas();

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const cellWidth = rect.width / GRID_COLS;
  const cellHeight = rect.height / GRID_ROWS;

  ctx.fillStyle = "#0b141b";
  ctx.fillRect(0, 0, rect.width, rect.height);

  ctx.strokeStyle = "rgba(90, 131, 166, 0.15)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= GRID_COLS; x += 1) {
    ctx.beginPath();
    ctx.moveTo(x * cellWidth, 0);
    ctx.lineTo(x * cellWidth, rect.height);
    ctx.stroke();
  }
  for (let y = 0; y <= GRID_ROWS; y += 1) {
    ctx.beginPath();
    ctx.moveTo(0, y * cellHeight);
    ctx.lineTo(rect.width, y * cellHeight);
    ctx.stroke();
  }

  ctx.fillStyle = "#ffad33";
  ctx.beginPath();
  ctx.ellipse(
    food.x * cellWidth + cellWidth / 2,
    food.y * cellHeight + cellHeight / 2,
    cellWidth * 0.34,
    cellHeight * 0.34,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  snake.forEach((part, index) => {
    ctx.fillStyle = index === 0 ? "#6af7ab" : "#43d17b";
    const x = part.x * cellWidth + 1;
    const y = part.y * cellHeight + 1;
    ctx.fillRect(x, y, cellWidth - 2, cellHeight - 2);
  });
}

function canApplyDirection(nextDirection) {
  return oppositeDirection[nextDirection] !== direction;
}

function gameTick() {
  if (gameState !== GAME_STATE.RUNNING) {
    drawGame();
    return;
  }

  if (pendingDirection && canApplyDirection(pendingDirection)) {
    direction = pendingDirection;
  }
  pendingDirection = null;

  const vector = directionVectors[direction];
  const newHead = {
    x: snake[0].x + vector.x,
    y: snake[0].y + vector.y
  };

  const wallHit =
    newHead.x < 0 || newHead.x >= GRID_COLS || newHead.y < 0 || newHead.y >= GRID_ROWS;
  const bodyHit = snake.some((part) => part.x === newHead.x && part.y === newHead.y);
  if (wallHit || bodyHit) {
    handleDeath();
    drawGame();
    return;
  }

  snake.unshift(newHead);
  const ateFood = newHead.x === food.x && newHead.y === food.y;
  if (ateFood) {
    score += 1;
    food = spawnFood();
    updateScore();
  } else {
    snake.pop();
  }

  drawGame();
}

function normalizeName(participant) {
  return participant?.name || "Unknown participant";
}

function normalizeDirection(directionName) {
  return directionName ? directionName.toUpperCase() : null;
}

async function sendChat(message, pin = false) {
  try {
    await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: "everyone",
        pin,
        message
      })
    });
  } catch (error) {
    console.error("Failed to send chat message", error);
  }
}

function setState(nextState) {
  gameState = nextState;
  updateStatePill();
  setWaitingOverlayVisible(nextState === GAME_STATE.WAITING);
  setDeathOverlayVisible(nextState === GAME_STATE.DEAD);
}

function showLoserFrame() {
  const participantId = deathCommanderSnapshot?.participantId;
  const participantName = deathCommanderSnapshot?.participantName || "Unknown participant";
  const frame = participantId ? participantFrames.get(participantId) : null;

  loserNameEl.textContent = participantName;
  loserImageEl.src =
    frame?.imageDataUrl ||
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='360' height='640'%3E%3Crect width='100%25' height='100%25' fill='%23111'/%3E%3Ctext x='50%25' y='50%25' fill='%23fff' text-anchor='middle' font-family='Arial' font-size='30'%3ENo Frame%3C/text%3E%3C/svg%3E";
}

async function handleDeath() {
  deathCommanderSnapshot = lastCommander
    ? {
        participantId: lastCommander.participantId,
        participantName: lastCommander.participantName
      }
    : {
        participantId: null,
        participantName: "Unknown participant"
      };

  setState(GAME_STATE.DEAD);
  showLoserFrame();

  const blameName = deathCommanderSnapshot.participantName;
  addCommandLog(`${blameName} caused our death`);
  await sendChat(`${blameName} is responsible for our death`);
  await sendChat("Say restart when you want to try again.");
}

async function startGameWithPrompt(byName, verb) {
  resetSnakeGame();
  updateScore();
  setDeathOverlayVisible(false);
  setState(GAME_STATE.RUNNING);
  addCommandLog(`${byName} said ${verb}`);
  await sendChat(`${byName} said ${verb}. Snake is now running.`);
}

async function restartGame(byName) {
  resetSnakeGame();
  updateScore();
  setState(GAME_STATE.RUNNING);
  addCommandLog(`${byName} restarted the game`);
  await sendChat(`${byName} restarted the game.`);
}

function cleanupUtteranceCache() {
  if (processedUtterances.size <= MAX_UTTERANCE_CACHE) {
    return;
  }
  const oldestKeys = Array.from(processedUtterances.entries())
    .sort((a, b) => a[1] - b[1])
    .slice(0, processedUtterances.size - MAX_UTTERANCE_CACHE);
  for (const [key] of oldestKeys) {
    processedUtterances.delete(key);
  }
}

function pickVoiceCommand(text) {
  const tokens = (text.toLowerCase().match(/[a-z]+/g) || []).map((token) => token.trim());
  if (!tokens.length) {
    return null;
  }

  let command = null;
  for (const token of tokens) {
    if (token === "up") command = "UP";
    if (token === "down") command = "DOWN";
    if (token === "left") command = "LEFT";
    if (token === "right") command = "RIGHT";
    if (token === "start") command = "START";
    if (token === "resume") command = "RESUME";
    if (token === "restart") command = "RESTART";
  }
  return command;
}

async function handleTranscriptEvent(eventPayload) {
  const text = String(eventPayload?.text || "").trim();
  if (!text) {
    return;
  }

  const utteranceKey = String(eventPayload?.utteranceKey || "");
  if (utteranceKey && processedUtterances.has(utteranceKey)) {
    return;
  }

  const command = pickVoiceCommand(text);
  if (!command) {
    return;
  }

  if (utteranceKey) {
    processedUtterances.set(utteranceKey, Date.now());
    cleanupUtteranceCache();
  }

  const participant = eventPayload?.participant || {};
  const participantName = normalizeName(participant);
  const participantId = String(participant?.id || "unknown");

  if (command === "START" || command === "RESUME") {
    if (gameState === GAME_STATE.WAITING) {
      await startGameWithPrompt(participantName, command.toLowerCase());
    }
    return;
  }

  if (command === "RESTART") {
    if (gameState === GAME_STATE.DEAD) {
      await restartGame(participantName);
    }
    return;
  }

  if (gameState !== GAME_STATE.RUNNING) {
    return;
  }

  pendingDirection = command;
  lastCommander = {
    participantId,
    participantName,
    direction: command
  };

  updateLastCommandText(command, participantName);
  addCommandLog(`${participantName}: ${command}`);
  await sendChat(`${participantName}: ${normalizeDirection(command)}`);
}

function connectEventStream() {
  const events = new EventSource("/api/events");

  events.addEventListener("snapshot", (evt) => {
    const payload = JSON.parse(evt.data);
    const participants = Array.isArray(payload.participants) ? payload.participants : [];
    for (const frame of participants) {
      participantFrames.set(frame.participantId, frame);
    }
    renderParticipants();
  });

  events.addEventListener("participant_frame", (evt) => {
    const payload = JSON.parse(evt.data);
    participantFrames.set(payload.participantId, payload);
    renderParticipants();
  });

  events.addEventListener("transcript", async (evt) => {
    const payload = JSON.parse(evt.data);
    await handleTranscriptEvent(payload);
  });

  events.onerror = () => {
    addCommandLog("Realtime stream disconnected. Retrying...");
  };
}

async function boot() {
  resetSnakeGame();
  updateStatePill();
  updateScore();
  setWaitingOverlayVisible(true);
  setDeathOverlayVisible(false);
  drawGame();
  connectEventStream();

  addCommandLog("Waiting for start or resume command");
  await sendChat(
    "Snake is ready. Say start or resume to begin. Say up, down, left, or right to steer. Say restart after a crash."
  );

  setInterval(gameTick, TICK_MS);
}

boot();
