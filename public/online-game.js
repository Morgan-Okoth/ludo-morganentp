/* Online game: renders server state on the existing board and sends player
   intents. The server rolls the dice and validates every move; this file only
   animates events and shows what the player may do next. */
(function () {
  const ONLINE = window.ONLINE;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const TOTAL_STEP = 58;

  let ready = false;
  let queue = Promise.resolve();
  const TOKS = {}; // color -> [{el, step}]

  ONLINE.gameActive = false;
  ONLINE.onState = (m) => {
    queue = queue.then(() => handle(m)).catch((e) => console.error('online state error', e));
  };

  /* ---------- setup ---------- */
  function setupGame(state) {
    document.querySelectorAll('.tok').forEach((el) => el.remove());
    PLAYERS = state.players.slice();
    playerConfigs = PLAYERS.map((color) => {
      const seat = ONLINE.seats.find((s) => s.color === color);
      const pc = PCONF.find((p) => p.id === color);
      return { ...pc, human: seat ? !seat.ai : true, displayName: seat ? seat.name : pc.name };
    });
    PLAYERS.forEach((color) => {
      const pc = PCONF.find((p) => p.id === color);
      TOKS[color] = [0, 1, 2, 3].map(() => {
        const el = document.createElement('div');
        el.className = 'tok ' + pc.tcls;
        HC[color].appendChild(el);
        return { el, step: 0 };
      });
    });
    OVER = false;
    BUSY = false;
    PHASE = 'wait';
    ONLINE.gameActive = true;
    ONLINE.show('game');
    buildPills();
    parkDie();
    ready = true;
  }

  /* ---------- board helpers ---------- */
  function sync(state) {
    state.players.forEach((color) => {
      state.steps[color].forEach((step, i) => {
        const tok = TOKS[color][i];
        tok.step = step;
        if (step === 0) {
          if (tok.el.parentElement !== HC[color]) toYard(tok, color);
        } else if (step >= TOTAL_STEP) {
          tok.el.remove();
        } else {
          const pos = PATH[color][step];
          if (tok.el.parentElement !== CELLS[pos[0]][pos[1]]) placeToken(tok, pos[0], pos[1]);
        }
      });
    });
  }

  function throwAsync(color, die, mine) {
    return new Promise((resolve) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const fx = mine ? diceX : Math.random() * (vw - 100) + 20;
      const fy = mine ? diceY : 40 + Math.random() * (vh * 0.25);
      throwDie(fx, fy, die, color, () => resolve());
    });
  }

  async function animateMove(color, tokenIndex, from, to) {
    const tok = TOKS[color][tokenIndex];
    if (from === 0) {
      const pos = PATH[color][1];
      placeToken(tok, pos[0], pos[1]);
      await sleep(400);
      return;
    }
    for (let s = from + 1; s <= to; s++) {
      tok.step = s;
      if (s >= TOTAL_STEP) break;
      const pos = PATH[color][s];
      placeToken(tok, pos[0], pos[1]);
      await sleep(220);
    }
  }

  const name = (color) => displayName(color);

  async function playEvent(ev, you) {
    switch (ev.type) {
      case 'rolled':
        msg(name(ev.color) + ' rolls...');
        DIE = ev.die;
        await throwAsync(ev.color, ev.die, ev.color === you);
        msg(name(ev.color) + ' rolled ' + ev.die);
        break;
      case 'skipped':
        msg(name(ev.color) + ' has no valid move');
        await sleep(900);
        break;
      case 'moved':
        await animateMove(ev.color, ev.token, ev.from, ev.to);
        break;
      case 'captured': {
        const victim = TOKS[ev.victim][ev.token];
        toYard(victim, ev.victim);
        msg(name(ev.by) + ' captures ' + name(ev.victim) + '! 💥');
        await sleep(500);
        break;
      }
      case 'home':
        TOKS[ev.color][ev.token].el.remove();
        msg(name(ev.color) + ' token home!');
        await sleep(400);
        break;
      case 'won':
        msg('🏆 ' + name(ev.color) + ' WINS! Congratulations!');
        break;
      default:
        break;
    }
  }

  /* ---------- state handling ---------- */
  async function handle(m) {
    const state = m.state;
    if (!state) return;
    if (!ready) setupGame(state);
    clearHighlights();
    BUSY = true;
    document.getElementById('rollBtn').disabled = true;

    for (const ev of m.events || []) await playEvent(ev, m.you);

    sync(state);
    CUR = state.turn;
    DIE = state.die || DIE || 1;
    BUSY = false;
    updateUI();
    present(state, m);
  }

  function present(state, m) {
    const color = state.players[state.turn];
    const mine = color === m.you;

    if (state.phase === 'over') {
      OVER = true;
      PHASE = 'done';
      msg('🏆 ' + name(state.winner) + ' WINS! Congratulations!');
      instr('Reload the page to start a new room');
      return;
    }

    if (!mine) {
      PHASE = 'wait';
      msg(name(color) + (isHuman(color) ? "'s turn" : ' (AI) is playing...'));
      instr('');
      return;
    }

    if (state.phase === 'roll') {
      PHASE = 'roll';
      document.getElementById('rollBtn').disabled = false;
      msg(name(color) + ' — your turn! Roll the die');
      instr('Tap the die or press ROLL');
    } else {
      PHASE = 'pick';
      msg(name(color) + ' rolled ' + state.die + ' — pick a token');
      instr('Click a glowing token to move it');
      (m.legal || []).forEach((i) => {
        const tok = TOKS[color][i];
        tok.el.classList.add('clickable');
        tok.el.onclick = () => {
          if (PHASE !== 'pick') return;
          PHASE = 'wait';
          clearHighlights();
          instr('');
          ONLINE.send({ type: 'move', token: i });
        };
      });
    }
  }

  /* index.html's triggerRoll() calls this when an online game is running. */
  window.onlineRollClick = function () {
    if (BUSY || OVER || PHASE !== 'roll') return;
    PHASE = 'wait';
    document.getElementById('rollBtn').disabled = true;
    ONLINE.send({ type: 'roll' });
  };
})();
