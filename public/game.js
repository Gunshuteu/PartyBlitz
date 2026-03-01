// ═══════════════════════════════════════════════════════════════════════════════
// PARTY GAME - CLIENT ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

const ARENA_W = 800;
const ARENA_H = 600;

// ─── Sound Manager (Web Audio API) ───────────────────────────────────────────
class SoundManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.musicPlaying = false;
    this.musicNodes = [];
    this.volume = { master: 0.7, music: 0.4, sfx: 0.8 };
    this.enabled = true;
  }

  init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
      this.musicGain.connect(this.masterGain);
      this.sfxGain.connect(this.masterGain);
      this.applyVolume();
    } catch (e) { console.warn('AudioContext not available'); this.enabled = false; }
  }

  applyVolume() {
    if (!this.ctx) return;
    this.masterGain.gain.value = this.volume.master;
    this.musicGain.gain.value = this.volume.music;
    this.sfxGain.gain.value = this.volume.sfx;
  }

  setVolume(type, val) {
    this.volume[type] = val;
    this.applyVolume();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  _beep(freq, type, duration, gainVal, destination) {
    if (!this.enabled || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(destination || this.sfxGain);
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    gain.gain.setValueAtTime(gainVal || 0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  playCollect() { this._beep(880, 'sine', 0.15, 0.3); this._beep(1200, 'sine', 0.1, 0.2); }
  playTag()     { this._beep(300, 'sawtooth', 0.2, 0.4); this._beep(200, 'sawtooth', 0.15, 0.3); }
  playElim()    { this._beep(160, 'square', 0.4, 0.5); this._beep(100, 'square', 0.3, 0.4); }
  playBoost()   { for (let i = 0; i < 4; i++) setTimeout(() => this._beep(440 + i * 110, 'sine', 0.1, 0.25), i * 50); }
  playWin()     { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this._beep(f, 'sine', 0.3, 0.3), i * 120)); }
  playCountdown(n) { this._beep(n > 0 ? 660 : 880, 'sine', 0.2, 0.4); }
  playJoin()    { this._beep(440, 'sine', 0.12, 0.3); this._beep(550, 'sine', 0.12, 0.25); }
  playError()   { this._beep(220, 'square', 0.3, 0.4); }
  playClick()   { this._beep(700, 'sine', 0.05, 0.2); }

  startMusic(theme = 'lobby') {
    if (!this.enabled || !this.ctx || this.musicPlaying) return;
    this.musicPlaying = true;
    const themes = {
      lobby:  { tempo: 110, notes: [261, 329, 392, 329, 261, 196, 261, 329] },
      game:   { tempo: 160, notes: [392, 440, 392, 349, 392, 440, 523, 440] },
      podium: { tempo: 90,  notes: [523, 587, 659, 698, 659, 587, 523, 494] }
    };
    const t = themes[theme] || themes.lobby;
    const beatLen = 60 / t.tempo;
    let step = 0;

    const scheduleNote = () => {
      if (!this.musicPlaying) return;
      const freq = t.notes[step % t.notes.length];
      this._beep(freq, 'triangle', beatLen * 0.7, 0.15, this.musicGain);
      // Bass
      this._beep(freq / 2, 'sine', beatLen * 0.9, 0.1, this.musicGain);
      step++;
      this._musicTimer = setTimeout(scheduleNote, beatLen * 1000);
    };
    scheduleNote();
  }

  stopMusic() {
    this.musicPlaying = false;
    clearTimeout(this._musicTimer);
  }

  switchMusic(theme) {
    this.stopMusic();
    setTimeout(() => this.startMusic(theme), 200);
  }
}

// ─── Input Manager ────────────────────────────────────────────────────────────
class InputManager {
  constructor() {
    this.keys = {};
    this.binds = {
      up:    ['ArrowUp', 'KeyW'],
      down:  ['ArrowDown', 'KeyS'],
      left:  ['ArrowLeft', 'KeyA'],
      right: ['ArrowRight', 'KeyD'],
    };
    this.touch = { active: false, x: 0, y: 0, startX: 0, startY: 0 };
    this.onChange = null;
    this._lastState = {};
    this._listen();
  }

  _listen() {
    window.addEventListener('keydown', e => { this.keys[e.code] = true; this._emit(); });
    window.addEventListener('keyup',   e => { this.keys[e.code] = false; this._emit(); });
  }

  getState() {
    const s = {};
    for (const dir in this.binds) {
      s[dir] = this.binds[dir].some(k => this.keys[k]);
    }
    // Merge touch
    if (this.touch.active) {
      const dx = this.touch.x - this.touch.startX;
      const dy = this.touch.y - this.touch.startY;
      const dead = 20;
      if (dx < -dead) s.left = true;
      if (dx > dead)  s.right = true;
      if (dy < -dead) s.up = true;
      if (dy > dead)  s.down = true;
    }
    return s;
  }

  _emit() {
    const s = this.getState();
    const changed = Object.keys(s).some(k => s[k] !== this._lastState[k]);
    if (changed && this.onChange) {
      this.onChange(s);
      this._lastState = { ...s };
    }
  }

  setTouch(active, x, y, startX, startY) {
    this.touch = { active, x, y, startX: startX ?? this.touch.startX, startY: startY ?? this.touch.startY };
    this._emit();
  }

  updateBind(dir, key) { this.binds[dir] = [key]; }
}

// ─── Renderer ─────────────────────────────────────────────────────────────────
class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.shake = 0;
  }

  resize(w, h) { this.canvas.width = w; this.canvas.height = h; }

  addParticle(x, y, color, vx, vy) {
    this.particles.push({ x, y, vx: vx || (Math.random() - 0.5) * 200, vy: vy || (Math.random() - 0.5) * 200, color: color || '#fff', life: 1, size: 4 + Math.random() * 6 });
  }

  triggerShake(amt) { this.shake = amt; }

  _drawBackground(gameState, snapshot) {
    const ctx = this.ctx;
    const mg = snapshot?.tournament?.games?.[snapshot.tournament.current];
    const bgColor = mg ? mg.color + '22' : '#1a1a2e';
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);

    // Grid
    ctx.strokeStyle = '#ffffff08';
    ctx.lineWidth = 1;
    for (let x = 0; x < ARENA_W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ARENA_H); ctx.stroke(); }
    for (let y = 0; y < ARENA_H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ARENA_W, y); ctx.stroke(); }

    // Minigame-specific bg
    if (gameState) this._drawMinigameBg(ctx, gameState, snapshot);
  }

  _drawMinigameBg(ctx, gs, snapshot) {
    const mg = gs.minigame;

    if (mg === 'survival' && gs.zoneRadius) {
      // Safe zone
      ctx.save();
      ctx.beginPath();
      ctx.arc(gs.zoneCX || ARENA_W/2, gs.zoneCY || ARENA_H/2, gs.zoneRadius, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff4757';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.stroke();
      ctx.setLineDash([]);
      // Danger zone tint
      ctx.fillStyle = 'rgba(255,71,87,0.08)';
      ctx.fillRect(0, 0, ARENA_W, ARENA_H);
      ctx.save();
      ctx.beginPath();
      ctx.arc(gs.zoneCX || ARENA_W/2, gs.zoneCY || ARENA_H/2, gs.zoneRadius, 0, Math.PI * 2);
      ctx.clip();
      ctx.clearRect(0, 0, ARENA_W, ARENA_H);
      ctx.fillStyle = '#0d0d1a';
      ctx.fillRect(0, 0, ARENA_W, ARENA_H);
      // Redraw grid inside
      ctx.strokeStyle = '#ffffff08';
      ctx.lineWidth = 1;
      for (let x = 0; x < ARENA_W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ARENA_H); ctx.stroke(); }
      for (let y = 0; y < ARENA_H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ARENA_W, y); ctx.stroke(); }
      ctx.restore();
      ctx.restore();
    }

    if (mg === 'bumper' && gs.platformRadius) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(ARENA_W/2, ARENA_H/2, gs.platformRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#1a2a4a';
      ctx.fill();
      ctx.strokeStyle = '#4a9eff';
      ctx.lineWidth = 4;
      ctx.stroke();
      // Danger outside
      ctx.fillStyle = 'rgba(255,107,129,0.06)';
      ctx.fillRect(0, 0, ARENA_W, ARENA_H);
      ctx.restore();
    }

    if (mg === 'king_hill' && gs.hill) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(gs.hill.x, gs.hill.y, gs.hill.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(241,196,15,0.15)';
      ctx.fill();
      ctx.strokeStyle = '#f1c40f';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.font = 'bold 18px monospace';
      ctx.fillStyle = '#f1c40f';
      ctx.textAlign = 'center';
      ctx.fillText('👑', gs.hill.x, gs.hill.y + 8);
      ctx.restore();
    }

    if (mg === 'race' && gs.checkpoints) {
      gs.checkpoints.forEach((cp, i) => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, 36, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(30,144,255,0.12)';
        ctx.fill();
        ctx.strokeStyle = '#1e90ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = 'bold 14px monospace';
        ctx.fillStyle = '#1e90ff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(i + 1, cp.x, cp.y);
        ctx.restore();
      });
    }

    if (mg === 'coin_flip' && gs.tiles) {
      gs.tiles.forEach(t => {
        ctx.save();
        ctx.fillStyle = t.color === 'red' ? 'rgba(255,71,87,0.25)' : 'rgba(30,144,255,0.25)';
        ctx.strokeStyle = t.color === 'red' ? '#ff4757' : '#1e90ff';
        ctx.lineWidth = 2;
        roundRect(ctx, t.x - 70, t.y - 50, 140, 100, 8);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      });
    }

    if ((mg === 'collection' || mg === 'collector_defense') && gs.gems) {
      gs.gems.forEach(g => {
        ctx.save();
        ctx.translate(g.x, g.y);
        const t = Date.now() / 400;
        ctx.rotate(t);
        ctx.fillStyle = '#2ed573';
        ctx.shadowColor = '#2ed573';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(7, 0);
        ctx.lineTo(0, 10);
        ctx.lineTo(-7, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });
    }

    if (mg === 'blitz' && gs.boosts) {
      gs.boosts.forEach(b => {
        ctx.save();
        ctx.translate(b.x, b.y);
        const pulse = Math.sin(Date.now() / 300) * 0.2 + 1;
        ctx.scale(pulse, pulse);
        ctx.fillStyle = '#a29bfe';
        ctx.shadowColor = '#a29bfe';
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.moveTo(0, -12);
        ctx.lineTo(6, -2);
        ctx.lineTo(12, -2);
        ctx.lineTo(3, 6);
        ctx.lineTo(6, 16);
        ctx.lineTo(0, 8);
        ctx.lineTo(-6, 16);
        ctx.lineTo(-3, 6);
        ctx.lineTo(-12, -2);
        ctx.lineTo(-6, -2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });
    }

    if (mg === 'hoard') {
      snapshot?.players?.forEach(p => {
        if (!p.data?.base) return;
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.data.base.x, p.data.base.y, 36, 0, Math.PI * 2);
        ctx.fillStyle = p.color + '33';
        ctx.fill();
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      });
      if (gs.gems) {
        gs.gems.forEach(g => {
          ctx.save();
          ctx.translate(g.x, g.y);
          const t = Date.now() / 400;
          ctx.rotate(t);
          ctx.fillStyle = '#fdcb6e';
          ctx.shadowColor = '#fdcb6e';
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.moveTo(0, -9);
          ctx.lineTo(6, 0);
          ctx.lineTo(0, 9);
          ctx.lineTo(-6, 0);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        });
      }
    }

    if (mg === 'freeze_tag') {
      const tId = gs.taggerId;
      const tagger = snapshot?.players?.find(p => p.id === tId);
      if (tagger) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(tagger.x, tagger.y, 38, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,71,87,0.08)';
        ctx.fill();
        ctx.restore();
      }
    }
  }

  drawPlayer(ctx, p, selfId, players, gsMinigame, itPlayerId) {
    const r = 20;
    ctx.save();
    ctx.translate(p.x, p.y);

    // Frozen effect
    if (p.data?.frozen) {
      ctx.shadowColor = '#74b9ff';
      ctx.shadowBlur = 20;
    }

    // It/Tagger glow
    const isIt = (gsMinigame === 'tag' || gsMinigame === 'freeze_tag') && p.id === itPlayerId;
    if (isIt) {
      ctx.shadowColor = '#ff4757';
      ctx.shadowBlur = 25;
    }

    // Body
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = p.alive ? p.color : '#555';
    ctx.fill();

    // Rim
    ctx.strokeStyle = p.alive ? '#fff' : '#888';
    ctx.lineWidth = p.id === selfId ? 3 : 2;
    ctx.stroke();

    // Self indicator
    if (p.id === selfId) {
      ctx.beginPath();
      ctx.arc(0, -r - 8, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }

    // Frozen overlay
    if (p.data?.frozen) {
      ctx.fillStyle = 'rgba(116,185,255,0.5)';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // "IT" marker
    if (isIt) {
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#ff4757';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('IT', 0, 0);
    }

    // Accessory
    this._drawAccessory(ctx, p.accessory, r, p.color);

    ctx.restore();

    // Name tag
    ctx.save();
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(p.x - 24, p.y - r - 22, 48, 14);
    ctx.fillStyle = '#fff';
    ctx.fillText(p.name?.slice(0, 8) || '?', p.x, p.y - r - 11);

    // Score badge
    if (p.score !== undefined && p.alive) {
      ctx.fillStyle = '#f1c40f';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(p.score, p.x + r, p.y - r);
    }

    // Carrying gems badge
    if (p.data?.carrying > 0) {
      ctx.fillStyle = '#fdcb6e';
      ctx.font = 'bold 11px monospace';
      ctx.fillText('💎×' + p.data.carrying, p.x, p.y + r + 14);
    }

    ctx.restore();
  }

  _drawAccessory(ctx, type, r, color) {
    ctx.shadowBlur = 0;
    switch (type) {
      case 'hat':
        ctx.fillStyle = '#2c2c2c';
        ctx.beginPath();
        ctx.ellipse(0, -r, r * 0.9, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(-r * 0.5, -r - 14, r, 14);
        break;
      case 'crown':
        ctx.fillStyle = '#f1c40f';
        ctx.beginPath();
        ctx.moveTo(-r * 0.7, -r);
        ctx.lineTo(-r * 0.7, -r - 14);
        ctx.lineTo(-r * 0.2, -r - 7);
        ctx.lineTo(0, -r - 16);
        ctx.lineTo(r * 0.2, -r - 7);
        ctx.lineTo(r * 0.7, -r - 14);
        ctx.lineTo(r * 0.7, -r);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#e67e22';
        ctx.lineWidth = 1;
        ctx.stroke();
        break;
      case 'horns':
        ctx.fillStyle = '#e74c3c';
        // left horn
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, -r);
        ctx.quadraticCurveTo(-r, -r - 22, -r * 0.4, -r - 16);
        ctx.closePath();
        ctx.fill();
        // right horn
        ctx.beginPath();
        ctx.moveTo(r * 0.5, -r);
        ctx.quadraticCurveTo(r, -r - 22, r * 0.4, -r - 16);
        ctx.closePath();
        ctx.fill();
        break;
      case 'bunny':
        ctx.fillStyle = '#ecf0f1';
        ctx.beginPath();
        ctx.ellipse(-r * 0.35, -r - 14, 5, 12, -0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(r * 0.35, -r - 14, 5, 12, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#bdc3c7';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(-r * 0.35, -r - 14, 5, 12, -0.3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(r * 0.35, -r - 14, 5, 12, 0.3, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'halo':
        ctx.strokeStyle = '#f1c40f';
        ctx.lineWidth = 3;
        ctx.shadowColor = '#f1c40f';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.ellipse(0, -r - 8, r * 0.7, 6, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        break;
      case 'glasses':
        ctx.strokeStyle = '#2c2c2c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(-r * 0.35, -2, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(r * 0.35, -2, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-r * 0.35 + 8, -2);
        ctx.lineTo(r * 0.35 - 8, -2);
        ctx.stroke();
        break;
    }
  }

  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 200 * dt;
      p.life -= dt * 1.5;
      p.size *= 0.98;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  drawParticles() {
    const ctx = this.ctx;
    this.particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  drawHUD(gs, snapshot, selfId) {
    if (!gs || !snapshot) return;
    const ctx = this.ctx;
    const mg = snapshot.tournament?.games?.[snapshot.tournament.current];
    if (!mg) return;

    // Timer bar
    const timeLeft = gs.timeLeft || 0;
    const total = 45000;
    const pct = timeLeft / total;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, ARENA_W, 34);
    ctx.fillStyle = pct > 0.3 ? '#2ed573' : '#ff4757';
    ctx.fillRect(0, 0, ARENA_W * pct, 34);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${mg.name}  |  ⏱ ${Math.ceil(timeLeft / 1000)}s`, ARENA_W / 2, 22);

    // Minigame desc (first 3s)
    if (timeLeft > total - 3000) {
      ctx.save();
      ctx.globalAlpha = (timeLeft - (total - 3000)) / 3000;
      ctx.font = '13px monospace';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(mg.desc, ARENA_W / 2, 56);
      ctx.restore();
    }

    // Scoreboard mini
    const sorted = [...(snapshot.players || [])].sort((a, b) => b.score - a.score).slice(0, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(ARENA_W - 130, 40, 128, sorted.length * 18 + 10);
    sorted.forEach((p, i) => {
      ctx.font = p.id === selfId ? 'bold 11px monospace' : '10px monospace';
      ctx.fillStyle = p.id === selfId ? '#f1c40f' : '#ccc';
      ctx.textAlign = 'left';
      ctx.fillText(`${i + 1}. ${(p.name || '?').slice(0, 7)}`, ARENA_W - 126, 56 + i * 18);
      ctx.textAlign = 'right';
      ctx.fillText(p.score, ARENA_W - 6, 56 + i * 18);
    });

    // Tournament progress
    const tg = snapshot.tournament;
    if (tg) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(6, 40, 90, 18);
      ctx.font = '10px monospace';
      ctx.fillStyle = '#aaa';
      ctx.textAlign = 'left';
      ctx.fillText(`Game ${tg.current + 1} / ${tg.games.length}`, 10, 53);
    }
  }

  render(dt, snapshot, gameState, selfId) {
    const ctx = this.ctx;
    if (this.shake > 0) {
      ctx.save();
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake *= 0.85;
      if (this.shake < 0.5) this.shake = 0;
    }

    this._drawBackground(gameState, snapshot);

    const players = snapshot?.players || [];
    const itId = gameState?.itPlayerId || gameState?.taggerId;
    players.forEach(p => {
      if (p.alive) this.drawPlayer(ctx, p, selfId, players, gameState?.minigame, itId);
    });
    players.forEach(p => {
      if (!p.alive) this.drawPlayer(ctx, p, selfId, players, gameState?.minigame, itId);
    });

    this.drawParticles();
    this.updateParticles(dt);
    this.drawHUD(gameState, snapshot, selfId);

    if (this.shake > 0) ctx.restore();
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ─── Game Client ──────────────────────────────────────────────────────────────
class GameClient {
  constructor() {
    this.socket = null;
    this.sound = new SoundManager();
    this.input = new InputManager();
    this.renderer = null;
    this.canvas = null;

    this.roomCode = null;
    this.selfId = null;
    this.snapshot = null;
    this.gameState = null;
    this.isHost = false;

    this.animFrame = null;
    this.lastTime = 0;

    this.playerName = localStorage.getItem('pg_name') || 'Player' + Math.floor(Math.random() * 999);
    this.playerColor = localStorage.getItem('pg_color') || '#e74c3c';
    this.playerAccessory = localStorage.getItem('pg_accessory') || 'none';

    this.settings = JSON.parse(localStorage.getItem('pg_settings') || 'null') || {
      binds: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
      volume: { master: 0.7, music: 0.4, sfx: 0.8 }
    };

    this.countdownVal = 0;
    this.showCountdown = false;
  }

  init() {
    this.canvas = document.getElementById('gameCanvas');
    this.renderer = new Renderer(this.canvas);
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    this.sound.init();
    this.applySettings();
    this.setupTouchControls();
    this.setupUI();
    this.connectSocket();
    this.loop(0);
  }

  resizeCanvas() {
    const container = document.getElementById('canvasContainer');
    if (!container) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const scale = Math.min(cw / ARENA_W, ch / ARENA_H);
    this.canvas.style.width  = (ARENA_W * scale) + 'px';
    this.canvas.style.height = (ARENA_H * scale) + 'px';
    this.canvas.width  = ARENA_W;
    this.canvas.height = ARENA_H;
  }

  applySettings() {
    const s = this.settings;
    for (const dir in s.binds) this.input.updateBind(dir, s.binds[dir]);
    for (const type in s.volume) this.sound.setVolume(type, s.volume[type]);
    // Sync UI sliders
    Object.entries(s.volume).forEach(([k, v]) => {
      const el = document.getElementById(`vol_${k}`);
      if (el) el.value = v;
    });
    Object.entries(s.binds).forEach(([dir, key]) => {
      const el = document.getElementById(`bind_${dir}`);
      if (el) el.textContent = key.replace('Key', '').replace('Arrow', '↑↓←→'.split('')[['Up','Down','Left','Right'].indexOf(key.replace('Arrow',''))]);
    });
  }

  saveSettings() {
    localStorage.setItem('pg_settings', JSON.stringify(this.settings));
    this.applySettings();
  }

  setupTouchControls() {
    const joystick = document.getElementById('joystick');
    const thumb    = document.getElementById('joystickThumb');
    if (!joystick || !thumb) return;

    let touchId = null, jCenter = { x: 0, y: 0 };

    const onStart = e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      touchId = t.identifier;
      const r = joystick.getBoundingClientRect();
      jCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      this.input.setTouch(true, t.clientX, t.clientY, t.clientX, t.clientY);
    };
    const onMove = e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === touchId) {
          const dx = t.clientX - jCenter.x;
          const dy = t.clientY - jCenter.y;
          const max = 36;
          const dist = Math.min(max, Math.hypot(dx, dy));
          const angle = Math.atan2(dy, dx);
          thumb.style.transform = `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px)`;
          this.input.setTouch(true, jCenter.x + dx, jCenter.y + dy, jCenter.x, jCenter.y);
        }
      }
    };
    const onEnd = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === touchId) {
          touchId = null;
          thumb.style.transform = '';
          this.input.setTouch(false, jCenter.x, jCenter.y, jCenter.x, jCenter.y);
        }
      }
    };
    joystick.addEventListener('touchstart', onStart, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: false });
  }

  setupUI() {
    // Name input
    const ni = document.getElementById('nameInput');
    if (ni) { ni.value = this.playerName; ni.addEventListener('input', () => { this.playerName = ni.value; localStorage.setItem('pg_name', ni.value); }); }

    // Color picker
    const ci = document.getElementById('colorPicker');
    if (ci) {
      ci.value = this.playerColor;
      ci.addEventListener('input', () => {
        this.playerColor = ci.value;
        localStorage.setItem('pg_color', ci.value);
        document.getElementById('colorPreview').style.background = ci.value;
        if (this.socket && this.roomCode) this.socket.emit('updateCustomization', { color: ci.value });
      });
    }

    // Accessory buttons
    document.querySelectorAll('.acc-btn').forEach(btn => {
      if (btn.dataset.acc === this.playerAccessory) btn.classList.add('selected');
      btn.addEventListener('click', () => {
        document.querySelectorAll('.acc-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.playerAccessory = btn.dataset.acc;
        localStorage.setItem('pg_accessory', btn.dataset.acc);
        if (this.socket && this.roomCode) this.socket.emit('updateCustomization', { accessory: btn.dataset.acc });
        this.sound.resume(); this.sound.playClick();
      });
    });

    // Settings gear
    document.getElementById('settingsBtn')?.addEventListener('click', () => {
      this.sound.resume(); this.sound.playClick();
      document.getElementById('settingsPanel').classList.toggle('hidden');
    });
    document.getElementById('closeSettings')?.addEventListener('click', () => {
      document.getElementById('settingsPanel').classList.add('hidden');
    });

    // Volume sliders
    ['master', 'music', 'sfx'].forEach(type => {
      const el = document.getElementById(`vol_${type}`);
      if (el) {
        el.value = this.settings.volume[type];
        el.addEventListener('input', () => {
          this.settings.volume[type] = parseFloat(el.value);
          this.sound.setVolume(type, this.settings.volume[type]);
          this.saveSettings();
        });
      }
    });

    // Keybind buttons
    document.querySelectorAll('.bind-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.sound.resume(); this.sound.playClick();
        btn.textContent = '...';
        btn.classList.add('listening');
        const dir = btn.dataset.dir;
        const handler = e => {
          e.preventDefault();
          this.settings.binds[dir] = e.code;
          this.saveSettings();
          btn.textContent = e.code.replace('Key', '').replace('Arrow', '⇅');
          btn.classList.remove('listening');
          window.removeEventListener('keydown', handler);
        };
        window.addEventListener('keydown', handler);
      });
    });

    // Create/Join buttons
    document.getElementById('createBtn')?.addEventListener('click', () => { this.sound.resume(); this.createRoom(); });
    document.getElementById('joinBtn')?.addEventListener('click',   () => { this.sound.resume(); this.joinRoom(); });
    document.getElementById('startBtn')?.addEventListener('click',  () => { this.sound.resume(); this.startGame(); });
    document.getElementById('copyCodeBtn')?.addEventListener('click', () => {
      const code = document.getElementById('roomCodeDisplay')?.textContent;
      if (code) { navigator.clipboard.writeText(code); this.showToast('Code copied!'); }
    });
  }

  connectSocket() {
    this.socket = io();
    this.selfId = null;

    this.socket.on('connect', () => {
      this.selfId = this.socket.id;
      console.log('Connected:', this.selfId);
    });

    this.socket.on('roomCreated', ({ code, snapshot }) => {
      this.roomCode = code; this.isHost = true;
      this.snapshot = snapshot;
      this._showScreen('lobby');
      document.getElementById('roomCodeDisplay').textContent = code;
      this.updateLobbyList(snapshot);
      document.getElementById('startBtn').classList.remove('hidden');
      this.sound.playJoin();
      this.sound.startMusic('lobby');
    });

    this.socket.on('joinedRoom', ({ code, snapshot }) => {
      this.roomCode = code; this.isHost = false;
      this.snapshot = snapshot;
      this._showScreen('lobby');
      document.getElementById('roomCodeDisplay').textContent = code;
      this.updateLobbyList(snapshot);
      document.getElementById('startBtn').classList.add('hidden');
      this.sound.playJoin();
      this.sound.startMusic('lobby');
    });

    this.socket.on('playerJoined', ({ snapshot }) => {
      this.snapshot = snapshot;
      this.updateLobbyList(snapshot);
      this.sound.playJoin();
    });

    this.socket.on('playerLeft', ({ playerId, snapshot }) => {
      this.snapshot = snapshot;
      this.updateLobbyList(snapshot);
    });

    this.socket.on('playerUpdated', ({ snapshot }) => {
      this.snapshot = snapshot;
      this.updateLobbyList(snapshot);
    });

    this.socket.on('stateChange', ({ state, snapshot }) => {
      this.snapshot = snapshot;
      this._handleStateChange(state, snapshot);
    });

    this.socket.on('tick', ({ players, gameState }) => {
      if (!this.snapshot) return;
      this.gameState = gameState;
      // Merge positions into snapshot
      players.forEach(pd => {
        const sp = this.snapshot.players.find(p => p.id === pd.id);
        if (sp) Object.assign(sp, pd);
      });
    });

    this.socket.on('minigameResults', ({ results, tournamentScores }) => {
      this.showResults(results, tournamentScores);
      this.sound.playWin();
    });

    this.socket.on('gameEvent', ({ type, playerId, from, to, tileId }) => {
      this.sound.resume();
      switch (type) {
        case 'gemCollect':
        case 'boost':
          if (playerId === this.selfId) this.sound.playCollect();
          break;
        case 'tag':
          this.sound.playTag();
          if (to === this.selfId) this.renderer?.triggerShake(6);
          break;
        case 'eliminated':
        case 'fall':
          this.sound.playElim();
          if (playerId === this.selfId) this.renderer?.triggerShake(10);
          break;
        case 'frozen':
          if (playerId === this.selfId) { this.sound.playElim(); this.renderer?.triggerShake(5); }
          break;
        case 'finish':
          if (playerId === this.selfId) this.sound.playWin();
          break;
        case 'flip':
          this.sound.playClick();
          break;
      }
      // Particles
      if (playerId && this.snapshot) {
        const p = this.snapshot.players?.find(p => p.id === playerId);
        if (p && this.renderer) {
          for (let i = 0; i < 8; i++) this.renderer.addParticle(p.x, p.y, p.color);
        }
      }
    });

    this.socket.on('error', ({ msg }) => {
      this.showToast('⚠ ' + msg, 'error');
      this.sound.resume(); this.sound.playError();
    });

    // Send input continuously while in game
    this.input.onChange = (state) => {
      if (this.snapshot?.state === 'MINIGAME_LOOP') {
        this.socket.emit('input', state);
      }
    };
  }

  _handleStateChange(state, snapshot) {
    this.sound.resume();
    switch (state) {
      case 'GAME_START':
        this._showScreen('game');
        this._showGameOverlay('countdown');
        this.startCountdown(snapshot);
        this.sound.switchMusic('game');
        break;
      case 'MINIGAME_LOOP':
        this._hideGameOverlay();
        break;
      case 'RESULTS':
        // Handled by minigameResults event
        break;
      case 'PODIUM':
        this.showPodium(snapshot);
        this.sound.switchMusic('podium');
        break;
    }
  }

  startCountdown(snapshot) {
    const mg = snapshot?.tournament?.games?.[snapshot.tournament.current];
    const overlay = document.getElementById('countdownOverlay');
    if (overlay && mg) {
      document.getElementById('countdownMgName').textContent = mg.name;
      document.getElementById('countdownMgDesc').textContent = mg.desc;
    }
    let n = 3;
    this.sound.playCountdown(n);
    document.getElementById('countdownNum').textContent = n;
    const tick = setInterval(() => {
      n--;
      if (n <= 0) {
        clearInterval(tick);
        document.getElementById('countdownNum').textContent = 'GO!';
        setTimeout(() => this._hideGameOverlay(), 600);
      } else {
        document.getElementById('countdownNum').textContent = n;
        this.sound.playCountdown(n);
      }
    }, 1000);
  }

  showResults(results, tournamentScores) {
    const overlay = document.getElementById('resultsOverlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');

    const mg = this.snapshot?.tournament?.games?.[this.snapshot.tournament.current];
    document.getElementById('resultsTitle').textContent = mg ? mg.name + ' Results' : 'Results';

    const list = document.getElementById('resultsList');
    list.innerHTML = '';
    const medals = ['🥇', '🥈', '🥉'];
    results.forEach((r, i) => {
      const p = this.snapshot?.players?.find(p => p.id === r.id);
      const li = document.createElement('div');
      li.className = 'result-entry';
      li.style.setProperty('--pc', p?.color || '#fff');
      li.innerHTML = `<span class="medal">${medals[i] || (i + 1)}</span> <span class="rname">${p?.name || r.id}</span> <span class="rscore">${typeof r.score === 'number' ? r.score.toFixed(1) : r.score}</span>`;
      list.appendChild(li);
    });

    const tList = document.getElementById('tournamentScoresList');
    tList.innerHTML = '';
    Object.entries(tournamentScores).sort((a, b) => b[1] - a[1]).forEach(([id, pts]) => {
      const p = this.snapshot?.players?.find(p => p.id === id);
      const li = document.createElement('div');
      li.className = 'tscore-entry';
      li.style.setProperty('--pc', p?.color || '#fff');
      li.innerHTML = `<span>${p?.name || id}</span><span>${pts} pts</span>`;
      tList.appendChild(li);
    });
  }

  showPodium(snapshot) {
    this._showScreen('podium');
    const sorted = Object.entries(snapshot.tournament.scores).sort((a, b) => b[1] - a[1]);
    const podiumEl = document.getElementById('podiumPlayers');
    podiumEl.innerHTML = '';
    const medals = ['🥇', '🥈', '🥉'];
    sorted.forEach(([id, score], i) => {
      const p = snapshot.players.find(p => p.id === id);
      const div = document.createElement('div');
      div.className = 'podium-entry';
      div.style.setProperty('--pc', p?.color || '#fff');
      div.innerHTML = `<div class="podium-medal">${medals[i] || (i + 1)}</div><div class="podium-name">${p?.name || id}</div><div class="podium-score">${score} pts</div>`;
      podiumEl.appendChild(div);
    });
    // fireworks particles
    if (this.renderer) {
      setInterval(() => {
        for (let i = 0; i < 12; i++) {
          this.renderer.addParticle(Math.random() * ARENA_W, Math.random() * ARENA_H,
            `hsl(${Math.random()*360},100%,60%)`,
            (Math.random() - 0.5) * 300, (Math.random() - 0.5) * 300);
        }
      }, 400);
    }
    document.getElementById('playAgainBtn')?.addEventListener('click', () => {
      this._showScreen('home');
      this.roomCode = null; this.snapshot = null; this.gameState = null;
      this.sound.switchMusic('lobby');
    });
  }

  createRoom() {
    this.socket.emit('createRoom', { name: this.playerName, color: this.playerColor, accessory: this.playerAccessory });
  }

  joinRoom() {
    const code = document.getElementById('joinCodeInput')?.value?.trim();
    if (!code || code.length !== 4) { this.showToast('Enter a 4-digit code', 'error'); this.sound.playError(); return; }
    this.socket.emit('joinRoom', { code, name: this.playerName, color: this.playerColor, accessory: this.playerAccessory });
  }

  startGame() {
    this.socket.emit('startGame');
  }

  updateLobbyList(snapshot) {
    const list = document.getElementById('playerList');
    if (!list) return;
    list.innerHTML = '';
    snapshot.players.forEach(p => {
      const div = document.createElement('div');
      div.className = 'lobby-player';
      div.style.setProperty('--pc', p.color);
      div.innerHTML = `<span class="lobby-dot"></span><span>${p.name}</span><span class="lobby-acc">${p.accessory}</span>${p.id === snapshot.players[0]?.id ? '<span class="host-badge">HOST</span>' : ''}`;
      list.appendChild(div);
    });
  }

  _showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(`screen_${name}`)?.classList.remove('hidden');
    document.getElementById('gameControls').classList.toggle('hidden', name !== 'game');
    document.getElementById('joystickArea').classList.toggle('hidden', name !== 'game');
  }

  _showGameOverlay(name) {
    document.querySelectorAll('.game-overlay').forEach(o => o.classList.add('hidden'));
    document.getElementById(`${name}Overlay`)?.classList.remove('hidden');
  }

  _hideGameOverlay() {
    document.querySelectorAll('.game-overlay').forEach(o => o.classList.add('hidden'));
    document.getElementById('resultsOverlay')?.classList.add('hidden');
  }

  showToast(msg, type = 'info') {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show ' + type;
    clearTimeout(t._timeout);
    t._timeout = setTimeout(() => t.classList.remove('show'), 2800);
  }

  loop(ts) {
    const dt = Math.min((ts - this.lastTime) / 1000, 0.05);
    this.lastTime = ts;

    if (this.snapshot?.state === 'MINIGAME_LOOP' || this.snapshot?.state === 'PODIUM') {
      this.renderer.render(dt, this.snapshot, this.gameState, this.selfId);
    }

    this.animFrame = requestAnimationFrame(ts => this.loop(ts));
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
const game = new GameClient();
window.addEventListener('DOMContentLoaded', () => game.init());
