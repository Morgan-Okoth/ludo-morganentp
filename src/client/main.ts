/** Entry point: menus, local setup, online lobby, and screen flow. */
import { MAX_PLAYERS, type Color, type GameState, armCountFor, colorsFor } from "../shared/rules";
import { speed } from "./anim";
import { loadAssets } from "./assets";
import { unlock } from "./audio";
import { Hud } from "./hud";
import { COLOR_HEX } from "./layout";
import { LocalMatch } from "./local";
import { type LobbyMsg, RoomClient, createRoom } from "./net";
import { Stage } from "./stage";
import { GameView, type SeatInfo } from "./view";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type Screen = "menu" | "online" | "game";

function show(screen: Screen) {
  $("menu").classList.toggle("hidden", screen !== "menu");
  $("online").classList.toggle("hidden", screen !== "online");
  hud.show(screen === "game");
  document.body.classList.toggle("playing", screen === "game");
}

// ---- stars backdrop (kept from the original design) ----
const stars = $("stars");
for (let i = 0; i < 90; i++) {
  const s = document.createElement("div");
  s.className = "star";
  const z = Math.random() * 2.5 + 0.5;
  s.style.cssText = `width:${z}px;height:${z}px;top:${Math.random() * 100}%;left:${Math.random() * 100}%;--d:${2 + Math.random() * 4}s;--dl:${Math.random() * 4}s`;
  stars.appendChild(s);
}

// ?speed=N speeds up animations (and allows all-AI "watch" games), for demos and tests.
const params = new URLSearchParams(location.search);
const speedParam = Number(params.get("speed"));
if (speedParam > 0) speed.factor = Math.min(50, speedParam);

const hud = new Hud();
const assets = await loadAssets();
const stage = new Stage($("stage"), assets);
const view = new GameView(stage, hud);
document.body.classList.add("ready");
console.info(`pawn model: ${assets.pawnSource}`);

let local: LocalMatch | null = null;
let room: RoomClient | null = null;
let lastLocalSeats: SeatInfo[] = [];

function backdrop(colors: Color[]) {
  view.preview(colors, armCountFor(colors.length));
  stage.spin = 0.08;
  void stage.lookFrom(0, false);
}

// ---------------------------------------------------------------- local menu
let count = 4;
const types: ("human" | "ai")[] = ["human", "ai", "ai", "ai", "ai", "ai"];
const names: string[] = Array(MAX_PLAYERS).fill("");

function renderSetup() {
  const colors = colorsFor(count);
  const box = $("playerSetup");
  box.textContent = "";
  colors.forEach((color, i) => {
    const row = document.createElement("div");
    row.className = "prow";
    const dot = document.createElement("div");
    dot.className = "pcolor";
    dot.style.background = COLOR_HEX[color];
    const input = document.createElement("input");
    input.className = "pname";
    input.maxLength = 16;
    const label = color[0]!.toUpperCase() + color.slice(1);
    input.placeholder = types[i] === "ai" ? `${label} (AI)` : label;
    input.value = names[i] ?? "";
    input.addEventListener("input", () => (names[i] = input.value));
    const btn = document.createElement("button");
    btn.className = "ptype" + (types[i] === "ai" ? " ai" : "");
    btn.textContent = types[i] === "ai" ? "AI" : "HUMAN";
    btn.addEventListener("click", () => {
      types[i] = types[i] === "ai" ? "human" : "ai";
      renderSetup();
    });
    row.append(dot, input, btn);
    box.appendChild(row);
  });
  document.querySelectorAll<HTMLButtonElement>(".pcb").forEach((b) => b.classList.toggle("sel", Number(b.dataset.n) === count));
  const shape = { 4: "Classic cross", 5: "Pentagon", 6: "Hexagon" }[armCountFor(count)];
  $("shapeHint").textContent = `${shape} board`;
  backdrop(colors);
}

document.querySelectorAll<HTMLButtonElement>(".pcb").forEach((b) =>
  b.addEventListener("click", () => {
    count = Number(b.dataset.n);
    renderSetup();
  }),
);

function startLocal(seats: SeatInfo[]) {
  unlock();
  room?.close();
  room = null;
  local?.stop();
  lastLocalSeats = seats;
  show("game");
  local = new LocalMatch(view, seats);
}

$("startBtn").addEventListener("click", () => {
  const colors = colorsFor(count);
  const seats = colors.map((color, i) => ({
    color,
    ai: types[i] === "ai",
    name: names[i]?.trim() || (types[i] === "ai" ? `${color[0]!.toUpperCase()}${color.slice(1)} (AI)` : color[0]!.toUpperCase() + color.slice(1)),
  }));
  if (seats.every((s) => s.ai) && !(speedParam > 0)) seats[0]!.ai = false;
  startLocal(seats);
});

// ---------------------------------------------------------------- game HUD
view.onGameOver = (state: GameState) => {
  if (local) hud.showResults(state, view.seats, true, "PLAY AGAIN");
  else if (room) {
    const isHost = room.lobby?.you !== null && room.lobby?.you === room.lobby?.host;
    hud.showResults(state, view.seats, isHost, "REMATCH");
  }
};

hud.onAgain = () => {
  hud.hideResults();
  if (local) startLocal(lastLocalSeats);
  else room?.send({ type: "rematch" });
};

hud.onView = () => void stage.lookFrom(stage.viewArm, true);

hud.onMenu = () => {
  if (room && view.state && view.state.phase !== "over" && !confirm("Leave this online game? An AI will play your seat.")) return;
  leaveToMenu();
};

function leaveToMenu() {
  local?.stop();
  local = null;
  if (room) {
    room.send({ type: "leave" });
    room.close();
    room = null;
  }
  history.replaceState(null, "", location.pathname);
  show("menu");
  renderSetup();
}

// ---------------------------------------------------------------- online
const onMsg = (text: string, err = false) => {
  const el = $("onMsg");
  el.textContent = text;
  el.classList.toggle("err", err);
};

($("onName") as HTMLInputElement).value = localStorage.getItem("ludo.name") ?? "";

function playerName() {
  const n = ($("onName") as HTMLInputElement).value.trim().slice(0, 20) || "Player";
  localStorage.setItem("ludo.name", n);
  return n;
}

$("openOnline").addEventListener("click", () => {
  unlock();
  show("online");
  onMsg("");
});

$("onCode").addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

$("onCreate").addEventListener("click", async () => {
  onMsg("Creating room...");
  try {
    enterRoom(await createRoom());
  } catch {
    onMsg("Could not create a room", true);
  }
});

$("onJoin").addEventListener("click", () => {
  const code = ($("onCode") as HTMLInputElement).value.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) return onMsg("Enter the 5-character room code", true);
  enterRoom(code);
});

$("onBack").addEventListener("click", () => {
  if (room) {
    room.send({ type: "leave" });
    room.close();
    room = null;
  }
  $("onRoom").classList.add("hidden");
  $("onJoinBox").classList.remove("hidden");
  leaveToMenu();
});

$("onCopy").addEventListener("click", copyInvite);
$("roomCode").addEventListener("click", copyInvite);
$("addAiBtn").addEventListener("click", () => room?.send({ type: "addAi" }));
$("startOnlineBtn").addEventListener("click", () => room?.send({ type: "start" }));

async function copyInvite() {
  if (!room) return;
  const link = `${location.origin}/?room=${room.code}`;
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ title: "Ludo Arena", text: "Join my Ludo game!", url: link });
    } else {
      await navigator.clipboard.writeText(link);
      onMsg("Invite link copied");
    }
  } catch {
    onMsg(link);
  }
}

function seatInfos(m: LobbyMsg): SeatInfo[] {
  return m.seats.filter((s) => s.color).map((s) => ({ color: s.color!, name: s.name, ai: s.ai }));
}

function enterRoom(code: string) {
  local?.stop();
  local = null;
  room?.close();
  history.replaceState(null, "", "?room=" + code);
  $("onJoinBox").classList.add("hidden");
  $("onRoom").classList.remove("hidden");
  $("roomCode").textContent = code;
  show("online");

  const client = new RoomClient(code, playerName());
  room = client;
  let inGame = false;
  let myColor: Color | null = null;

  client.onStatus = (s) => onMsg(s === "connected" ? "Connected" : "Connection lost. Reconnecting...", s !== "connected");
  client.onError = (m) => {
    onMsg(m, true);
    if (inGame) hud.instruction(m);
  };
  client.onLobby = (m) => {
    if (!m.started && inGame) {
      // Host pressed rematch: back to the room lobby.
      inGame = false;
      hud.hideResults();
      show("online");
    }
    renderSeats(m);
    if (!m.started) {
      const colors = seatInfos(m).map((s) => s.color);
      backdrop(colors.length >= 2 ? colors : ["red", "yellow"]);
    }
  };
  client.onState = (m) => {
    myColor = m.you;
    view.canAct = (c) => c === myColor;
    view.followTurn = false;
    view.onRoll = () => client.send({ type: "roll" });
    view.onMove = (i) => client.send({ type: "move", token: i });
    if (!inGame) {
      inGame = true;
      show("game");
      view.begin(m.state, client.lobby ? seatInfos(client.lobby) : [], myColor);
      if (!myColor) hud.instruction("You are watching this game");
    }
    void view.push(m);
  };
}

function renderSeats(m: LobbyMsg) {
  const box = $("seats");
  box.textContent = "";
  const isHost = m.you !== null && m.you === m.host;
  for (const s of m.seats) {
    const row = document.createElement("div");
    row.className = "seat";
    const dot = document.createElement("div");
    dot.className = "dot";
    dot.style.background = s.color ? COLOR_HEX[s.color] : "#888";
    const nm = document.createElement("div");
    nm.className = "nm";
    nm.textContent = s.name;
    row.append(dot, nm);
    const tag = (text: string, cls = "") => {
      const t = document.createElement("span");
      t.className = "tag " + cls;
      t.textContent = text;
      row.appendChild(t);
    };
    if (s.id === m.host) tag("HOST");
    if (s.id === m.you) tag("YOU");
    if (s.ai) tag("AI", "ai");
    else if (!s.connected) tag("OFFLINE", "off");
    if (isHost && s.id !== m.you) {
      const x = document.createElement("button");
      x.className = "on-btn ghost tiny";
      x.textContent = "✕";
      x.title = "Remove";
      x.addEventListener("click", () => room?.send({ type: "removeSeat", seat: s.id }));
      row.appendChild(x);
    }
    box.appendChild(row);
  }
  const n = m.seats.length;
  const shape = n >= 2 ? { 4: "Classic cross", 5: "Pentagon", 6: "Hexagon" }[armCountFor(n)] : "";
  $("roomShape").textContent = n >= 2 ? `${n} players · ${shape} board` : "Waiting for players...";
  $("hostTools").classList.toggle("hidden", !isHost || m.started);
  $("waitHost").classList.toggle("hidden", isHost || m.started);
  ($("addAiBtn") as HTMLButtonElement).disabled = n >= MAX_PLAYERS;
  ($("startOnlineBtn") as HTMLButtonElement).disabled = n < 2;
}

// ---------------------------------------------------------------- boot
renderSetup();
const invited = (new URLSearchParams(location.search).get("room") ?? "").toUpperCase();
if (/^[A-Z0-9]{5}$/.test(invited)) {
  ($("onCode") as HTMLInputElement).value = invited;
  show("online");
  onMsg("Enter your name and press JOIN");
} else {
  show("menu");
}
