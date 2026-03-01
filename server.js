const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Constants ───────────────────────────────────────────────────────────────
const TICK_RATE = 30; // ms per tick
const MINIGAME_DURATION = 45000; // 45 seconds per minigame
const RESULTS_DURATION = 5000;
const COUNTDOWN_DURATION = 3000;
const MAX_PLAYERS = 8;
const ARENA_W = 800;
const ARENA_H = 600;

// ─── State ────────────────────────────────────────────────────────────────────
const rooms = new Map();

// ─── Minigame Definitions ────────────────────────────────────────────────────
const MINIGAMES = [
  {
    id: 'tag',
    name: '🏃 Hot Tag',
    desc: 'One player is "It" – tag others to pass it on. Least time as "It" wins!',
    color: '#ff4757',
    init: initTag,
    tick: tickTag,
    score: scoreTag
  },
  {
    id: 'collection',
    name: '💎 Gem Rush',
    desc: 'Collect as many gems as possible before time runs out!',
    color: '#2ed573',
    init: initCollection,
    tick: tickCollection,
    score: scoreCollection
  },
  {
    id: 'survival',
    name: '☠️ Last Stand',
    desc: 'Avoid the shrinking zone! Last player inside wins.',
    color: '#ffa502',
    init: initSurvival,
    tick: tickSurvival,
    score: scoreSurvival
  },
  {
    id: 'bumper',
    name: '💥 Bumper Brawl',
    desc: 'Knock other players off the platform!',
    color: '#ff6b81',
    init: initBumper,
    tick: tickBumper,
    score: scoreBumper
  },
  {
    id: 'race',
    name: '🏁 Lap Race',
    desc: 'Race around checkpoints – first to complete 3 laps wins!',
    color: '#1e90ff',
    init: initRace,
    tick: tickRace,
    score: scoreRace
  },
  {
    id: 'freeze',
    name: '🧊 Freeze Tag',
    desc: 'Tagger freezes players. Unfreeze teammates by touching them!',
    color: '#74b9ff',
    init: initFreezeTag,
    tick: tickFreezeTag,
    score: scoreFreezeTag
  },
  {
    id: 'collector_defense',
    name: '🏰 Hoard Mode',
    desc: 'Collect gems AND guard your base. Points for gems at home!',
    color: '#fdcb6e',
    init: initHoard,
    tick: tickHoard,
    score: scoreHoard
  },
  {
    id: 'speed_boost',
    name: '⚡ Blitz Zone',
    desc: 'Grab speed boosts and be the fastest mover. Most distance wins!',
    color: '#a29bfe',
    init: initBlitz,
    tick: tickBlitz,
    score: scoreBlitz
  },
  {
    id: 'king_hill',
    name: '👑 King of the Hill',
    desc: 'Stand on the hill longer than anyone else!',
    color: '#e17055',
    init: initKingHill,
    tick: tickKingHill,
    score: scoreKingHill
  },
  {
    id: 'coin_flip',
    name: '🎰 Chaos Coins',
    desc: 'Coins randomly flip red/blue. Stand on your color!',
    color: '#00b894',
    init: initChaosCoins,
    tick: tickChaosCoins,
    score: scoreChaosCoins
  }
];

// ─── Room Helpers ─────────────────────────────────────────────────────────────
function generateRoomCode() {
  let code;
  do { code = Math.floor(1000 + Math.random() * 9000).toString(); }
  while (rooms.has(code));
  return code;
}

function createRoom(hostId) {
  const code = generateRoomCode();
  const room = {
    code,
    hostId,
    state: 'LOBBY',        // LOBBY | COUNTDOWN | GAME_START | MINIGAME_LOOP | RESULTS | PODIUM
    players: new Map(),
    tournament: { games: [], current: 0, scores: {} },
    gameState: {},
    tickInterval: null,
    stateTimer: null,
  };
  rooms.set(code, room);
  return room;
}

function createPlayer(id, name, color, accessory) {
  return {
    id, name,
    color: color || '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
    accessory: accessory || 'none',
    x: ARENA_W / 2 + (Math.random() - 0.5) * 200,
    y: ARENA_H / 2 + (Math.random() - 0.5) * 200,
    vx: 0, vy: 0,
    input: { up: false, down: false, left: false, right: false },
    alive: true,
    score: 0,
    data: {}     // minigame-specific data
  };
}

function broadcastRoom(room, event, data) {
  io.to(room.code).emit(event, data);
}

function getRoomSnapshot(room) {
  const players = [];
  room.players.forEach(p => players.push({
    id: p.id, name: p.name, color: p.color, accessory: p.accessory,
    x: p.x, y: p.y, alive: p.alive, score: p.score, data: p.data
  }));
  return {
    state: room.state,
    players,
    gameState: room.gameState,
    tournament: {
      games: room.tournament.games.map(g => ({ id: g.id, name: g.name, desc: g.desc, color: g.color })),
      current: room.tournament.current,
      scores: room.tournament.scores
    }
  };
}

function pickTournament() {
  const shuffled = [...MINIGAMES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 5);
}

// ─── Tournament Flow ──────────────────────────────────────────────────────────
function startTournament(room) {
  room.tournament.games = pickTournament();
  room.tournament.current = 0;
  room.tournament.scores = {};
  room.players.forEach(p => { room.tournament.scores[p.id] = 0; });
  transitionState(room, 'GAME_START');
}

function transitionState(room, newState, delay = 0) {
  clearTimeout(room.stateTimer);
  const proceed = () => {
    room.state = newState;
    broadcastRoom(room, 'stateChange', { state: newState, snapshot: getRoomSnapshot(room) });

    if (newState === 'GAME_START') {
      setTimeout(() => startMinigame(room), COUNTDOWN_DURATION);
    } else if (newState === 'RESULTS') {
      finalizeMinigame(room);
      room.stateTimer = setTimeout(() => {
        room.tournament.current++;
        if (room.tournament.current >= room.tournament.games.length) {
          transitionState(room, 'PODIUM');
        } else {
          transitionState(room, 'GAME_START');
        }
      }, RESULTS_DURATION);
    } else if (newState === 'PODIUM') {
      stopTick(room);
    }
  };
  if (delay > 0) room.stateTimer = setTimeout(proceed, delay);
  else proceed();
}

function startMinigame(room) {
  room.state = 'MINIGAME_LOOP';
  const mg = room.tournament.games[room.tournament.current];

  // Reset players
  const positions = spawnPositions(room.players.size);
  let i = 0;
  room.players.forEach(p => {
    const pos = positions[i++];
    p.x = pos.x; p.y = pos.y;
    p.vx = 0; p.vy = 0;
    p.alive = true;
    p.score = 0;
    p.data = {};
  });

  room.gameState = { minigame: mg.id, timeLeft: MINIGAME_DURATION, startTime: Date.now() };
  mg.init(room);

  broadcastRoom(room, 'stateChange', { state: 'MINIGAME_LOOP', snapshot: getRoomSnapshot(room) });

  startTick(room);
  room.stateTimer = setTimeout(() => transitionState(room, 'RESULTS'), MINIGAME_DURATION);
}

function finalizeMinigame(room) {
  stopTick(room);
  const mg = room.tournament.games[room.tournament.current];
  const scores = mg.score(room);
  // Award tournament points: 1st=5, 2nd=3, 3rd=2, 4th+=1
  const pts = [5, 3, 2, 1, 1, 1, 1, 1];
  scores.forEach((entry, rank) => {
    room.tournament.scores[entry.id] = (room.tournament.scores[entry.id] || 0) + (pts[rank] || 1);
  });
  room.gameState.results = scores;
  broadcastRoom(room, 'minigameResults', { results: scores, tournamentScores: room.tournament.scores });
}

function startTick(room) {
  stopTick(room);
  let last = Date.now();
  room.tickInterval = setInterval(() => {
    const now = Date.now();
    const dt = (now - last) / 1000;
    last = now;
    tickRoom(room, dt);
  }, TICK_RATE);
}

function stopTick(room) {
  if (room.tickInterval) { clearInterval(room.tickInterval); room.tickInterval = null; }
}

function tickRoom(room, dt) {
  if (room.state !== 'MINIGAME_LOOP') return;
  const mg = room.tournament.games[room.tournament.current];

  // Move players
  room.players.forEach(p => {
    if (!p.alive) return;
    const speed = p.data.speedMult ? 260 * p.data.speedMult : 260;
    if (p.input.left)  p.vx -= speed * dt * 6;
    if (p.input.right) p.vx += speed * dt * 6;
    if (p.input.up)    p.vy -= speed * dt * 6;
    if (p.input.down)  p.vy += speed * dt * 6;

    const friction = mg.id === 'bumper' ? 0.85 : 0.78;
    p.vx *= Math.pow(friction, dt * 60);
    p.vy *= Math.pow(friction, dt * 60);

    const maxV = p.data.speedMult ? 280 * p.data.speedMult : 280;
    const spd = Math.hypot(p.vx, p.vy);
    if (spd > maxV) { p.vx = p.vx / spd * maxV; p.vy = p.vy / spd * maxV; }

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Arena bounds (per-minigame may override)
    const margin = room.gameState.margin || 0;
    p.x = Math.max(margin + 20, Math.min(ARENA_W - margin - 20, p.x));
    p.y = Math.max(margin + 20, Math.min(ARENA_H - margin - 20, p.y));
  });

  mg.tick(room, dt);
  room.gameState.timeLeft = Math.max(0, MINIGAME_DURATION - (Date.now() - room.gameState.startTime));

  broadcastRoom(room, 'tick', {
    players: serializePlayers(room),
    gameState: room.gameState
  });
}

function serializePlayers(room) {
  const arr = [];
  room.players.forEach(p => arr.push({
    id: p.id, x: p.x, y: p.y, vx: p.vx, vy: p.vy,
    alive: p.alive, score: p.score, data: p.data
  }));
  return arr;
}

function spawnPositions(n) {
  const positions = [];
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    positions.push({
      x: ARENA_W / 2 + Math.cos(angle) * 180,
      y: ARENA_H / 2 + Math.sin(angle) * 180
    });
  }
  return positions;
}

// ─── Minigame: TAG ────────────────────────────────────────────────────────────
function initTag(room) {
  const ids = [...room.players.keys()];
  const it = ids[Math.floor(Math.random() * ids.length)];
  room.gameState.itPlayer = it;
  room.gameState.itTime = {};
  ids.forEach(id => room.gameState.itTime[id] = 0);
  room.gameState.lastTagTime = Date.now();
}
function tickTag(room, dt) {
  const gs = room.gameState;
  const itId = gs.itPlayer;
  if (!itId) return;
  gs.itTime[itId] = (gs.itTime[itId] || 0) + dt;

  const itPlayer = room.players.get(itId);
  if (!itPlayer) return;

  room.players.forEach(p => {
    if (p.id === itId || !p.alive) return;
    const dist = Math.hypot(p.x - itPlayer.x, p.y - itPlayer.y);
    if (dist < 40 && Date.now() - gs.lastTagTime > 1500) {
      gs.itPlayer = p.id;
      gs.lastTagTime = Date.now();
      broadcastRoom(room, 'gameEvent', { type: 'tag', from: itId, to: p.id });
    }
  });
  // Update score (lower is better; will be inverted in scoring)
  room.players.forEach(p => { p.score = Math.round(gs.itTime[p.id] || 0); });
  gs.itPlayerId = itId;
}
function scoreTag(room) {
  const gs = room.gameState;
  const arr = [...room.players.values()].map(p => ({ id: p.id, score: gs.itTime[p.id] || 0 }));
  return arr.sort((a, b) => a.score - b.score); // less time as "it" = better
}

// ─── Minigame: COLLECTION ─────────────────────────────────────────────────────
function spawnGem(room) {
  return { x: 30 + Math.random() * (ARENA_W - 60), y: 30 + Math.random() * (ARENA_H - 60), id: Math.random().toString(36).slice(2) };
}
function initCollection(room) {
  room.gameState.gems = Array.from({ length: 12 }, () => spawnGem(room));
}
function tickCollection(room, dt) {
  const gems = room.gameState.gems;
  room.players.forEach(p => {
    if (!p.alive) return;
    for (let i = gems.length - 1; i >= 0; i--) {
      const g = gems[i];
      if (Math.hypot(p.x - g.x, p.y - g.y) < 28) {
        gems.splice(i, 1);
        p.score++;
        gems.push(spawnGem(room));
        broadcastRoom(room, 'gameEvent', { type: 'gemCollect', playerId: p.id });
        break;
      }
    }
  });
}
function scoreCollection(room) {
  return [...room.players.values()].map(p => ({ id: p.id, score: p.score })).sort((a, b) => b.score - a.score);
}

// ─── Minigame: SURVIVAL ───────────────────────────────────────────────────────
function initSurvival(room) {
  room.gameState.zoneRadius = 340;
  room.gameState.zoneCX = ARENA_W / 2;
  room.gameState.zoneCY = ARENA_H / 2;
  room.gameState.shrinkRate = 20; // px/s
}
function tickSurvival(room, dt) {
  const gs = room.gameState;
  gs.zoneRadius = Math.max(60, gs.zoneRadius - gs.shrinkRate * dt);

  room.players.forEach(p => {
    if (!p.alive) return;
    const dist = Math.hypot(p.x - gs.zoneCX, p.y - gs.zoneCY);
    if (dist > gs.zoneRadius) {
      p.alive = false;
      broadcastRoom(room, 'gameEvent', { type: 'eliminated', playerId: p.id });
    } else {
      p.score += dt;
    }
  });
}
function scoreSurvival(room) {
  return [...room.players.values()].map(p => ({ id: p.id, score: p.score })).sort((a, b) => b.score - a.score);
}

// ─── Minigame: BUMPER ─────────────────────────────────────────────────────────
function initBumper(room) {
  room.gameState.platformRadius = 260;
  room.players.forEach(p => { p.data.deaths = 0; });
}
function tickBumper(room, dt) {
  const gs = room.gameState;
  const cx = ARENA_W / 2, cy = ARENA_H / 2;

  // Player-player collisions (elastic bump)
  const players = [...room.players.values()].filter(p => p.alive);
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 40 && dist > 0) {
        const nx = dx / dist, ny = dy / dist;
        const overlap = 40 - dist;
        a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
        b.x += nx * overlap / 2; b.y += ny * overlap / 2;
        const impulse = 180;
        a.vx -= nx * impulse; a.vy -= ny * impulse;
        b.vx += nx * impulse; b.vy += ny * impulse;
      }
    }
  }

  // Check out of platform
  room.players.forEach(p => {
    if (!p.alive) return;
    const dist = Math.hypot(p.x - cx, p.y - cy);
    if (dist > gs.platformRadius) {
      p.data.deaths = (p.data.deaths || 0) + 1;
      p.x = cx + (Math.random() - 0.5) * 100;
      p.y = cy + (Math.random() - 0.5) * 100;
      p.vx = 0; p.vy = 0;
      broadcastRoom(room, 'gameEvent', { type: 'fall', playerId: p.id });
    }
    p.score = -(p.data.deaths || 0);
  });
  // Keep players in virtual bounds for bumper
  room.gameState.margin = Math.max(0, (Math.min(ARENA_W, ARENA_H) / 2) - gs.platformRadius);
}
function scoreBumper(room) {
  return [...room.players.values()].map(p => ({ id: p.id, score: -(p.data.deaths || 0) })).sort((a, b) => b.score - a.score);
}

// ─── Minigame: RACE ───────────────────────────────────────────────────────────
function initRace(room) {
  room.gameState.checkpoints = [
    { x: 680, y: 100 }, { x: 680, y: 500 }, { x: 400, y: 300 },
    { x: 120, y: 500 }, { x: 120, y: 100 }
  ];
  room.gameState.totalLaps = 3;
  room.players.forEach(p => { p.data.cpIndex = 0; p.data.laps = 0; });
}
function tickRace(room, dt) {
  const cps = room.gameState.checkpoints;
  room.players.forEach(p => {
    if (!p.alive) return;
    const cp = cps[p.data.cpIndex % cps.length];
    if (Math.hypot(p.x - cp.x, p.y - cp.y) < 36) {
      p.data.cpIndex++;
      if (p.data.cpIndex % cps.length === 0) {
        p.data.laps++;
        if (p.data.laps >= room.gameState.totalLaps) {
          p.score = 1000 - (Date.now() - room.gameState.startTime);
          broadcastRoom(room, 'gameEvent', { type: 'finish', playerId: p.id });
        }
      }
    }
    p.score = p.data.laps * 1000 + p.data.cpIndex;
  });
}
function scoreRace(room) {
  return [...room.players.values()].map(p => ({ id: p.id, score: p.score })).sort((a, b) => b.score - a.score);
}

// ─── Minigame: FREEZE TAG ──────────────────────────────────────────────────────
function initFreezeTag(room) {
  const ids = [...room.players.keys()];
  room.gameState.taggerId = ids[Math.floor(Math.random() * ids.length)];
  room.players.forEach(p => { p.data.frozen = false; p.data.freezeTime = 0; });
}
function tickFreezeTag(room, dt) {
  const taggerId = room.gameState.taggerId;
  const tagger = room.players.get(taggerId);
  if (!tagger) return;

  room.players.forEach(p => {
    if (p.id === taggerId || !p.alive) return;
    if (!p.data.frozen) {
      if (Math.hypot(p.x - tagger.x, p.y - tagger.y) < 38) {
        p.data.frozen = true;
        p.vx = 0; p.vy = 0;
        broadcastRoom(room, 'gameEvent', { type: 'frozen', playerId: p.id });
      }
      p.data.freezeTime = (p.data.freezeTime || 0) + dt;
    } else {
      // Check if another free player touches them
      room.players.forEach(savior => {
        if (savior.id === p.id || savior.id === taggerId || savior.data.frozen) return;
        if (Math.hypot(p.x - savior.x, p.y - savior.y) < 38) {
          p.data.frozen = false;
          broadcastRoom(room, 'gameEvent', { type: 'thawed', playerId: p.id });
        }
      });
    }
    // Frozen players can't move
    if (p.data.frozen) { p.vx = 0; p.vy = 0; p.input = { up: false, down: false, left: false, right: false }; }
    p.score = Math.round(p.data.freezeTime || 0);
  });
  if (tagger.alive) tagger.score = [...room.players.values()].filter(p => p.data.frozen).length * 10;
}
function scoreFreezeTag(room) {
  return [...room.players.values()].map(p => ({ id: p.id, score: p.score })).sort((a, b) => b.score - a.score);
}

// ─── Minigame: HOARD ──────────────────────────────────────────────────────────
function initHoard(room) {
  room.gameState.gems = Array.from({ length: 15 }, () => spawnGem(room));
  let i = 0;
  room.players.forEach(p => {
    const angle = (i++ / room.players.size) * Math.PI * 2;
    p.data.base = { x: ARENA_W / 2 + Math.cos(angle) * 240, y: ARENA_H / 2 + Math.sin(angle) * 240 };
    p.data.carrying = 0;
    p.data.banked = 0;
  });
}
function tickHoard(room, dt) {
  const gems = room.gameState.gems;
  room.players.forEach(p => {
    if (!p.alive) return;
    // Collect gems
    if ((p.data.carrying || 0) < 3) {
      for (let i = gems.length - 1; i >= 0; i--) {
        const g = gems[i];
        if (Math.hypot(p.x - g.x, p.y - g.y) < 28) {
          gems.splice(i, 1); p.data.carrying++;
          gems.push(spawnGem(room)); break;
        }
      }
    }
    // Bank gems at base
    if (p.data.carrying > 0 && p.data.base) {
      if (Math.hypot(p.x - p.data.base.x, p.y - p.data.base.y) < 36) {
        p.data.banked += p.data.carrying;
        p.data.carrying = 0;
      }
    }
    p.score = (p.data.banked || 0) * 2 + (p.data.carrying || 0);
  });
}
function scoreHoard(room) {
  return [...room.players.values()].map(p => ({ id: p.id, score: p.data.banked || 0 })).sort((a, b) => b.score - a.score);
}

// ─── Minigame: BLITZ ──────────────────────────────────────────────────────────
function initBlitz(room) {
  room.gameState.boosts = Array.from({ length: 6 }, () => ({
    x: 60 + Math.random() * (ARENA_W - 120),
    y: 60 + Math.random() * (ARENA_H - 120),
    id: Math.random().toString(36).slice(2)
  }));
  room.players.forEach(p => { p.data.distanceTraveled = 0; p.data.speedMult = 1; p.data.boostTimer = 0; });
}
function tickBlitz(room, dt) {
  room.players.forEach(p => {
    if (!p.alive) return;
    p.data.distanceTraveled = (p.data.distanceTraveled || 0) + Math.hypot(p.vx, p.vy) * dt;
    if (p.data.boostTimer > 0) {
      p.data.boostTimer -= dt;
      p.data.speedMult = 1.8;
    } else {
      p.data.speedMult = 1;
    }
    p.score = Math.round(p.data.distanceTraveled);

    const boosts = room.gameState.boosts;
    for (let i = boosts.length - 1; i >= 0; i--) {
      if (Math.hypot(p.x - boosts[i].x, p.y - boosts[i].y) < 28) {
        p.data.boostTimer = 3;
        boosts.splice(i, 1);
        boosts.push({ x: 60 + Math.random() * (ARENA_W - 120), y: 60 + Math.random() * (ARENA_H - 120), id: Math.random().toString(36).slice(2) });
        broadcastRoom(room, 'gameEvent', { type: 'boost', playerId: p.id });
        break;
      }
    }
  });
}
function scoreBlitz(room) {
  return [...room.players.values()].map(p => ({ id: p.id, score: p.data.distanceTraveled || 0 })).sort((a, b) => b.score - a.score);
}

// ─── Minigame: KING OF THE HILL ───────────────────────────────────────────────
function initKingHill(room) {
  room.gameState.hill = { x: ARENA_W / 2, y: ARENA_H / 2, r: 70 };
  room.players.forEach(p => { p.data.hillTime = 0; });
}
function tickKingHill(room, dt) {
  const hill = room.gameState.hill;
  let onHill = 0;
  room.players.forEach(p => {
    if (!p.alive) return;
    if (Math.hypot(p.x - hill.x, p.y - hill.y) < hill.r) onHill++;
  });
  room.players.forEach(p => {
    if (!p.alive) return;
    if (Math.hypot(p.x - hill.x, p.y - hill.y) < hill.r) {
      p.data.hillTime = (p.data.hillTime || 0) + dt / onHill;
      p.score = Math.round(p.data.hillTime);
    }
  });
}
function scoreKingHill(room) {
  return [...room.players.values()].map(p => ({ id: p.id, score: p.data.hillTime || 0 })).sort((a, b) => b.score - a.score);
}

// ─── Minigame: CHAOS COINS ────────────────────────────────────────────────────
function initChaosCoins(room) {
  const ids = [...room.players.keys()];
  // Assign half red half blue
  room.gameState.tiles = Array.from({ length: 16 }, (_, i) => ({
    x: 60 + (i % 4) * 180,
    y: 80 + Math.floor(i / 4) * 130,
    color: Math.random() > 0.5 ? 'red' : 'blue',
    id: i
  }));
  room.gameState.flipTimer = 2.5;
  ids.forEach((id, i) => {
    const p = room.players.get(id);
    p.data.teamColor = i % 2 === 0 ? 'red' : 'blue';
    p.data.coinScore = 0;
  });
}
function tickChaosCoins(room, dt) {
  const gs = room.gameState;
  gs.flipTimer -= dt;
  if (gs.flipTimer <= 0) {
    gs.flipTimer = 2 + Math.random() * 2;
    const tile = gs.tiles[Math.floor(Math.random() * gs.tiles.length)];
    tile.color = tile.color === 'red' ? 'blue' : 'red';
    broadcastRoom(room, 'gameEvent', { type: 'flip', tileId: tile.id });
  }

  room.players.forEach(p => {
    if (!p.alive) return;
    let onCorrect = false;
    gs.tiles.forEach(t => {
      const tw = 140, th = 100;
      if (p.x > t.x - tw / 2 && p.x < t.x + tw / 2 && p.y > t.y - th / 2 && p.y < t.y + th / 2) {
        if (t.color === p.data.teamColor) onCorrect = true;
      }
    });
    if (onCorrect) p.data.coinScore = (p.data.coinScore || 0) + dt;
    p.score = Math.round(p.data.coinScore || 0);
  });
}
function scoreChaosCoins(room) {
  return [...room.players.values()].map(p => ({ id: p.id, score: p.data.coinScore || 0 })).sort((a, b) => b.score - a.score);
}

// ─── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('+ connect', socket.id);

  socket.on('createRoom', ({ name, color, accessory }) => {
    const room = createRoom(socket.id);
    const player = createPlayer(socket.id, name || 'Host', color, accessory);
    room.players.set(socket.id, player);
    socket.join(room.code);
    socket.emit('roomCreated', { code: room.code, snapshot: getRoomSnapshot(room) });
  });

  socket.on('joinRoom', ({ code, name, color, accessory }) => {
    const room = rooms.get(code);
    if (!room) return socket.emit('error', { msg: 'Room not found' });
    if (room.state !== 'LOBBY') return socket.emit('error', { msg: 'Game already in progress' });
    if (room.players.size >= MAX_PLAYERS) return socket.emit('error', { msg: 'Room full' });

    const player = createPlayer(socket.id, name || 'Player', color, accessory);
    room.players.set(socket.id, player);
    socket.join(code);
    socket.emit('joinedRoom', { code, snapshot: getRoomSnapshot(room) });
    broadcastRoom(room, 'playerJoined', { snapshot: getRoomSnapshot(room) });
  });

  socket.on('startGame', () => {
    const room = findRoomByPlayer(socket.id);
    if (!room || room.hostId !== socket.id) return;
    if (room.players.size < 2) return socket.emit('error', { msg: 'Need at least 2 players' });
    startTournament(room);
  });

  socket.on('input', ({ up, down, left, right }) => {
    const room = findRoomByPlayer(socket.id);
    if (!room || room.state !== 'MINIGAME_LOOP') return;
    const player = room.players.get(socket.id);
    if (player) player.input = { up: !!up, down: !!down, left: !!left, right: !!right };
  });

  socket.on('updateCustomization', ({ color, accessory }) => {
    const room = findRoomByPlayer(socket.id);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (player) {
      if (color) player.color = color;
      if (accessory) player.accessory = accessory;
      broadcastRoom(room, 'playerUpdated', { snapshot: getRoomSnapshot(room) });
    }
  });

  socket.on('disconnect', () => {
    console.log('- disconnect', socket.id);
    const room = findRoomByPlayer(socket.id);
    if (!room) return;
    room.players.delete(socket.id);
    if (room.players.size === 0) {
      stopTick(room);
      clearTimeout(room.stateTimer);
      rooms.delete(room.code);
    } else {
      if (room.hostId === socket.id) room.hostId = [...room.players.keys()][0];
      broadcastRoom(room, 'playerLeft', { playerId: socket.id, snapshot: getRoomSnapshot(room) });
    }
  });
});

function findRoomByPlayer(playerId) {
  for (const room of rooms.values()) {
    if (room.players.has(playerId)) return room;
  }
  return null;
}

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 Party Game server running on port ${PORT}`));
