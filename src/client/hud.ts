/** DOM overlay during a game: player pills, messages, roll button, results. */
import { type Color, type GameState, currentColor, finishStep } from "../shared/rules";
import { isMuted, setMuted, unlock } from "./audio";
import { COLOR_HEX } from "./layout";
import type { SeatInfo } from "./view";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const MEDALS = ["🥇", "🥈", "🥉"];

export class Hud {
  onRoll: () => void = () => {};
  onMenu: () => void = () => {};
  onView: () => void = () => {};
  onAgain: () => void = () => {};

  constructor() {
    $("rollBtn").addEventListener("click", () => {
      unlock();
      this.onRoll();
    });
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && $("hud").classList.contains("show") && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        unlock();
        this.onRoll();
      }
    });
    const mute = $("btnMute");
    const syncMute = () => (mute.textContent = isMuted() ? "🔇" : "🔊");
    syncMute();
    mute.addEventListener("click", () => {
      setMuted(!isMuted());
      syncMute();
      unlock();
    });
    $("btnView").addEventListener("click", () => this.onView());
    $("btnMenu").addEventListener("click", () => this.onMenu());
    $("btnAgain").addEventListener("click", () => this.onAgain());
    $("btnResultsMenu").addEventListener("click", () => this.onMenu());
    document.addEventListener("pointerdown", unlock, { once: true });
  }

  show(on: boolean) {
    $("hud").classList.toggle("show", on);
    if (!on) this.hideResults();
  }

  setPlayers(seats: SeatInfo[], state: GameState) {
    const box = $("pills");
    box.textContent = "";
    const fin = finishStep(state.arms);
    const cur = state.phase === "over" ? null : currentColor(state);
    for (const color of state.players) {
      const seat = seats.find((s) => s.color === color);
      const pill = document.createElement("div");
      pill.className = "pill" + (color === cur ? " on" : "");
      pill.style.setProperty("--c", COLOR_HEX[color]);
      const home = state.steps[color]!.filter((s) => s === fin).length;
      const place = state.finished.indexOf(color);
      const name = document.createElement("span");
      name.textContent = (seat?.name ?? color) + (seat?.ai ? " 🤖" : "");
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = place >= 0 ? (MEDALS[place] ?? `#${place + 1}`) : "●".repeat(home) + "○".repeat(4 - home);
      pill.append(name, meta);
      box.appendChild(pill);
    }
  }

  message(text: string, color?: Color) {
    const el = $("msg");
    el.textContent = text;
    el.style.setProperty("--c", color ? COLOR_HEX[color] : "#FFD700");
  }

  instruction(text: string) {
    $("instr").textContent = text;
  }

  showDie(value: number, color: Color) {
    const el = $("dval");
    el.textContent = String(value);
    el.style.color = COLOR_HEX[color];
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
  }

  setRollEnabled(on: boolean, color?: Color) {
    const b = $<HTMLButtonElement>("rollBtn");
    b.disabled = !on;
    b.classList.toggle("ready", on);
    if (color) b.style.setProperty("--c", COLOR_HEX[color]);
  }

  showResults(state: GameState, seats: SeatInfo[], canAgain: boolean, againLabel = "PLAY AGAIN") {
    const list = $("ranking");
    list.textContent = "";
    state.finished.forEach((color, i) => {
      const seat = seats.find((s) => s.color === color);
      const row = document.createElement("div");
      row.className = "rank";
      row.style.setProperty("--c", COLOR_HEX[color]);
      const medal = document.createElement("span");
      medal.className = "medal";
      medal.textContent = MEDALS[i] ?? `#${i + 1}`;
      const nm = document.createElement("span");
      nm.textContent = seat?.name ?? color;
      row.append(medal, nm);
      list.appendChild(row);
    });
    const again = $<HTMLButtonElement>("btnAgain");
    again.textContent = againLabel;
    again.classList.toggle("hidden", !canAgain);
    setTimeout(() => $("results").classList.add("show"), 1600);
  }

  hideResults() {
    $("results").classList.remove("show");
  }
}
