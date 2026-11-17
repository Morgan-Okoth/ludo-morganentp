/* Online multiplayer: connection and room lobby.
   The game board itself is driven by online-game.js. */
(function () {
  const $ = (id) => document.getElementById(id);
  const COLOR_HEX = { red: '#D32F2F', green: '#388E3C', yellow: '#F9A825', blue: '#1565C0' };

  function getClientId() {
    let id = localStorage.getItem('ludo.clientId');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('ludo.clientId', id);
    }
    return id;
  }

  const ONLINE = (window.ONLINE = {
    active: false,
    ws: null,
    room: null,
    you: null,
    host: null,
    seats: [],
    started: false,
    onState: null, // set by online-game.js
    send(msg) {
      if (ONLINE.ws && ONLINE.ws.readyState === WebSocket.OPEN) ONLINE.ws.send(JSON.stringify(msg));
    },
  });

  let reconnectTimer = null;
  let pingTimer = null;
  let leaving = false;

  function setMsg(text, isErr) {
    const el = $('onMsg');
    el.textContent = text || '';
    el.classList.toggle('err', !!isErr);
  }

  function show(which) {
    $('lobby').style.display = which === 'local' ? 'flex' : 'none';
    $('online').style.display = which === 'online' ? 'flex' : 'none';
    $('game').style.display = which === 'game' ? 'flex' : 'none';
  }
  ONLINE.show = show;

  function playerName() {
    const n = $('onName').value.trim().slice(0, 20) || 'Player';
    localStorage.setItem('ludo.name', n);
    return n;
  }

  function wsUrl(code) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/api/rooms/${code}/ws`;
  }

  function connect(code) {
    clearTimeout(reconnectTimer);
    clearInterval(pingTimer);
    const ws = new WebSocket(wsUrl(code));
    ONLINE.ws = ws;
    ws.onopen = () => {
      setMsg('Connected');
      ONLINE.send({ type: 'join', clientId: getClientId(), name: playerName() });
      pingTimer = setInterval(() => ONLINE.send({ type: 'ping' }), 25000);
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'lobby') onLobby(m);
      else if (m.type === 'state') { if (ONLINE.onState) ONLINE.onState(m); }
      else if (m.type === 'error') setMsg(m.message, true);
    };
    ws.onclose = () => {
      clearInterval(pingTimer);
      if (leaving || ws !== ONLINE.ws) return;
      setMsg('Connection lost. Reconnecting...', true);
      reconnectTimer = setTimeout(() => connect(code), 1500);
    };
  }

  function enterRoom(code) {
    leaving = false;
    ONLINE.active = true;
    ONLINE.room = code;
    history.replaceState(null, '', '?room=' + code);
    $('onJoin').classList.add('hidden');
    $('onRoom').classList.remove('hidden');
    $('roomCode').textContent = code;
    show('online');
    connect(code);
  }

  function onLobby(m) {
    ONLINE.you = m.you;
    ONLINE.host = m.host;
    ONLINE.seats = m.seats;
    ONLINE.started = m.started;
    if (m.started) return; // the game screen takes over on the first state message
    renderSeats();
  }

  function renderSeats() {
    const box = $('seats');
    box.textContent = '';
    ONLINE.seats.forEach((s) => {
      const row = document.createElement('div');
      row.className = 'seat';
      const dot = document.createElement('div');
      dot.className = 'dot';
      dot.style.background = COLOR_HEX[s.color];
      const nm = document.createElement('div');
      nm.className = 'nm';
      nm.textContent = s.name;
      row.append(dot, nm);
      const tag = (text, cls) => {
        const t = document.createElement('span');
        t.className = 'tag ' + (cls || '');
        t.textContent = text;
        row.appendChild(t);
      };
      if (s.color === ONLINE.host) tag('HOST');
      if (s.color === ONLINE.you) tag('YOU');
      if (s.ai) tag('AI', 'ai');
      else if (!s.connected) tag('OFFLINE', 'off');
      if (s.ai && ONLINE.you === ONLINE.host) {
        const x = document.createElement('button');
        x.className = 'on-btn ghost';
        x.textContent = 'X';
        x.onclick = () => ONLINE.send({ type: 'removeAi', color: s.color });
        row.appendChild(x);
      }
      box.appendChild(row);
    });
    const isHost = ONLINE.you !== null && ONLINE.you === ONLINE.host;
    $('hostTools').classList.toggle('hidden', !isHost);
    $('waitHost').classList.toggle('hidden', isHost);
    $('addAiBtn').disabled = ONLINE.seats.length >= 4;
    $('startOnlineBtn').disabled = ONLINE.seats.length < 2;
  }

  async function createRoom() {
    setMsg('Creating room...');
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      const { code } = await res.json();
      enterRoom(code);
    } catch {
      setMsg('Could not create a room', true);
    }
  }

  function joinRoom() {
    const code = $('onCode').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) return setMsg('Enter the 5-character room code', true);
    enterRoom(code);
  }

  function leaveRoom() {
    leaving = true;
    ONLINE.active = false;
    clearTimeout(reconnectTimer);
    clearInterval(pingTimer);
    if (ONLINE.ws) ONLINE.ws.close();
    ONLINE.ws = null;
    ONLINE.room = null;
    history.replaceState(null, '', location.pathname);
    $('onRoom').classList.add('hidden');
    $('onJoin').classList.remove('hidden');
    setMsg('');
    show('local');
  }

  window.openOnline = () => { show('online'); setMsg(''); };
  window.onlineCreate = createRoom;
  window.onlineJoin = joinRoom;
  window.onlineLeave = leaveRoom;
  window.onlineAddAi = () => ONLINE.send({ type: 'addAi' });
  window.onlineStart = () => ONLINE.send({ type: 'start' });
  window.onlineCopy = async () => {
    const link = `${location.origin}/?room=${ONLINE.room}`;
    try {
      await navigator.clipboard.writeText(link);
      setMsg('Invite link copied');
    } catch {
      setMsg(link);
    }
  };

  $('onName').value = localStorage.getItem('ludo.name') || '';
  $('onCode').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  // Invite link: ?room=ABCDE opens the join panel with the code filled in.
  const invited = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  if (/^[A-Z0-9]{5}$/.test(invited)) {
    $('onCode').value = invited;
    show('online');
    setMsg('Enter your name and press JOIN');
  }
})();
