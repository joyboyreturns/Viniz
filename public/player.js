// ── Viniz Audio Player ──
class AudioPlayer {
  constructor() {
    this.audio = new Audio();
    this.audio.crossOrigin = 'anonymous';
    this.queue = [];
    this.queueIndex = -1;
    this.currentTrack = null;
    this.isPlaying = false;
    this.volume = parseFloat(localStorage.getItem('viniz_volume') || '0.8');
    this.audio.volume = this.volume;
    this.audioCtx = null;
    this.analyser = null;
    this.visData = null;
    this.visAnimId = null;
    this.visCanvas = null;
    this.visCtx = null;
    this.dominantColor = null;
    this.shuffleMode = false;
    this.repeatMode = 0; // 0=none, 1=repeat one, 2=repeat all

    this._bindEvents();
    this._setupMediaSession();
    this._setupKeyboard();
  }

  _bindEvents() {
    this.audio.addEventListener('timeupdate', () => this._updateProgress());
    this.audio.addEventListener('ended', () => this._onEnded());
    this.audio.addEventListener('play', () => { this.isPlaying = true; this._updatePlayBtn(); this._startVisualizer(); });
    this.audio.addEventListener('pause', () => { this.isPlaying = false; this._updatePlayBtn(); this._stopVisualizer(); });
    this.audio.addEventListener('error', () => { console.error('Audio error'); this._stopVisualizer(); });
    this.audio.addEventListener('loadedmetadata', () => this._updateDuration());
    this.audio.addEventListener('canplay', () => this._hideLoader());
  }

  _setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', () => this.play());
    navigator.mediaSession.setActionHandler('pause', () => this.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
    navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
    navigator.mediaSession.setActionHandler('seekto', (d) => { if (d.seekTime) this.seekTo(d.seekTime); });
  }

  _updateMediaSessionMeta() {
    if (!('mediaSession' in navigator) || !this.currentTrack) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: this.currentTrack.track_name || 'Unknown',
      artist: this.currentTrack.artist_name || 'Unknown',
      album: this.currentTrack.album_name || '',
      artwork: this.currentTrack.cover_url ? [{ src: this.currentTrack.cover_url, sizes: '300x300', type: 'image/jpeg' }] : []
    });
  }

  _setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      switch (e.code) {
        case 'Space': e.preventDefault(); this.isPlaying ? this.pause() : this.play(); break;
        case 'ArrowLeft': this.seekTo(this.audio.currentTime - 5); break;
        case 'ArrowRight': this.seekTo(this.audio.currentTime + 5); break;
        case 'ArrowUp': this.volume = Math.min(1, this.volume + 0.05); this.audio.volume = this.volume; this._updateVolumeUI(); break;
        case 'ArrowDown': this.volume = Math.max(0, this.volume - 0.05); this.audio.volume = this.volume; this._updateVolumeUI(); break;
        case 'KeyM': this.toggleMute(); break;
      }
    });
  }

  // ── Visualizer ──
  _initAudioContext() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.source = this.audioCtx.createMediaElementSource(this.audio);
      this.source.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);
      this.visData = new Uint8Array(this.analyser.frequencyBinCount);
    }
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
  }

  _startVisualizer() {
    const canvas = document.getElementById('visualizer-canvas');
    const miniVis = document.getElementById('mini-visualizer');
    if (!canvas && !miniVis) return;
    this._initAudioContext();
    this._drawVisualizer(canvas, miniVis);
  }

  _stopVisualizer() {
    if (this.visAnimId) {
      cancelAnimationFrame(this.visAnimId);
      this.visAnimId = null;
    }
  }

  _drawVisualizer(canvas, miniCanvas) {
    if (!this.analyser) return;
    const draw = () => {
      this.visAnimId = requestAnimationFrame(draw);
      this.analyser.getByteFrequencyData(this.visData);

      if (miniCanvas && miniCanvas.clientWidth > 0) {
        const mctx = miniCanvas.getContext('2d');
        const mw = miniCanvas.width = miniCanvas.clientWidth;
        const mh = miniCanvas.height = miniCanvas.clientHeight;
        mctx.clearRect(0, 0, mw, mh);
        const barCount = 32;
        const barW = (mw / barCount) * 0.7;
        const gap = (mw / barCount) * 0.3;
        const scale = mh / 256;
        for (let i = 0; i < barCount; i++) {
          const val = this.visData[Math.floor(i * this.visData.length / barCount)];
          const h = Math.max(3, val * scale);
          const x = i * (barW + gap);
          const y = mh - h;
          const gradient = mctx.createLinearGradient(0, mh, 0, 0);
          gradient.addColorStop(0, '#fa233b');
          gradient.addColorStop(1, '#ff6b81');
          mctx.fillStyle = gradient;
          mctx.beginPath();
          mctx.roundRect(x, y, barW, h, 2);
          mctx.fill();
        }
      }

      if (canvas && canvas.clientWidth > 0) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width = canvas.clientWidth;
        const h = canvas.height = canvas.clientHeight;
        ctx.clearRect(0, 0, w, h);
        const cx = w / 2;
        const cy = h / 2;
        const maxR = Math.min(w, h) * 0.35;
        const barCount = 64;
        for (let i = 0; i < barCount; i++) {
          const idx = Math.floor(i * this.visData.length / barCount);
          const val = this.visData[idx] / 256;
          const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
          const innerR = maxR * 0.3;
          const outerR = innerR + (maxR * 0.7) * val * 1.5;
          const x1 = cx + Math.cos(angle) * innerR;
          const y1 = cy + Math.sin(angle) * innerR;
          const x2 = cx + Math.cos(angle) * outerR;
          const y2 = cy + Math.sin(angle) * outerR;
          const hue = (i / barCount * 360 + Date.now() * 0.02) % 360;
          ctx.strokeStyle = `hsla(${hue}, 80%, 60%, ${0.4 + val * 0.6})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(cx, cy, maxR * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(250,35,59,0.15)';
        ctx.fill();
      }
    };
    draw();
  }

  // ── Queue ──
  addToQueue(track, playNow = false) {
    if (playNow) {
      this.queue.splice(this.queueIndex + 1, 0, track);
    } else {
      this.queue.push(track);
    }
    this._renderQueue();
    if (!this.currentTrack && this.queue.length > 0) {
      this.queueIndex = 0;
      this.currentTrack = this.queue[0];
      this._loadAndPlay();
    }
  }

  playTrack(track) {
    const idx = this.queue.findIndex(t => t.track_id === track.track_id);
    if (idx >= 0) {
      this.queueIndex = idx;
      this.currentTrack = this.queue[idx];
      this._loadAndPlay();
    } else {
      this.queue = [track];
      this.queueIndex = 0;
      this.currentTrack = track;
      this._loadAndPlay();
    }
    this._renderQueue();
  }

  playAlbum(tracks) {
    this.queue = tracks;
    this.queueIndex = 0;
    this.currentTrack = tracks[0];
    this._loadAndPlay();
    this._renderQueue();
  }

  playAllTracks(tracks, startIndex = 0) {
    this.queue = tracks;
    this.queueIndex = startIndex;
    this.currentTrack = tracks[startIndex];
    this._loadAndPlay();
    this._renderQueue();
  }

  _loadAndPlay() {
    if (!this.currentTrack) return;
    const url = this.currentTrack.stream_url || `/api/stream/${this.currentTrack.track_id}`;
    this.audio.src = url;
    this.audio.load();
    this.audio.play().catch(() => {});
    this._showLoader();
    this._updatePlayerUI();
    this._updateMediaSessionMeta();
    this._extractColor();
    document.getElementById('player-bar')?.classList.remove('hidden');
  }

  play() {
    if (!this.currentTrack && this.queue.length > 0) {
      this.queueIndex = Math.max(0, this.queueIndex);
      this.currentTrack = this.queue[this.queueIndex];
      return this._loadAndPlay();
    }
    this.audio.play().catch(e => { console.error('play failed', e); });
  }

  pause() { this.audio.pause(); }

  togglePlay() { this.isPlaying ? this.pause() : this.play(); }

  next() {
    if (this.repeatMode === 1 && this.currentTrack) {
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
      return;
    }
    if (this.shuffleMode) {
      const nextIdx = Math.floor(Math.random() * this.queue.length);
      this.queueIndex = nextIdx;
      this.currentTrack = this.queue[nextIdx];
      this._loadAndPlay();
      return;
    }
    if (this.queueIndex < this.queue.length - 1) {
      this.queueIndex++;
      this.currentTrack = this.queue[this.queueIndex];
      this._loadAndPlay();
    } else if (this.repeatMode === 2) {
      this.queueIndex = 0;
      this.currentTrack = this.queue[0];
      this._loadAndPlay();
    } else {
      this.stop();
    }
  }

  prev() {
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }
    if (this.shuffleMode) {
      const prevIdx = Math.floor(Math.random() * this.queue.length);
      this.queueIndex = prevIdx;
      this.currentTrack = this.queue[prevIdx];
      this._loadAndPlay();
      return;
    }
    if (this.queueIndex > 0) {
      this.queueIndex--;
      this.currentTrack = this.queue[this.queueIndex];
      this._loadAndPlay();
    }
  }

  _onEnded() {
    this.next();
  }

  stop() {
    this.pause();
    this.audio.src = '';
    this.currentTrack = null;
    this.queueIndex = -1;
    this.isPlaying = false;
    this._updatePlayBtn();
    this._stopVisualizer();
    document.getElementById('player-bar')?.classList.add('hidden');
  }

  seekTo(seconds) {
    this.audio.currentTime = Math.max(0, Math.min(this.audio.duration || 0, seconds));
  }

  seekByPercent(pct) {
    if (this.audio.duration) this.audio.currentTime = this.audio.duration * (pct / 100);
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    this._updateVolumeUI();
  }

  clearQueue() {
    this.queue = [];
    this.queueIndex = -1;
    this.stop();
    this._renderQueue();
  }

  removeFromQueue(idx) {
    if (idx < this.queueIndex) this.queueIndex--;
    if (idx === this.queueIndex) this.queueIndex = Math.min(this.queueIndex, this.queue.length - 1);
    this.queue.splice(idx, 1);
    if (this.queue.length === 0) this.stop();
    this._renderQueue();
  }

  toggleShuffle() {
    this.shuffleMode = !this.shuffleMode;
    document.getElementById('player-shuffle')?.classList.toggle('active', this.shuffleMode);
  }

  toggleRepeat() {
    this.repeatMode = (this.repeatMode + 1) % 3;
    const btn = document.getElementById('player-repeat');
    if (btn) {
      btn.classList.remove('active', 'repeat-one');
      if (this.repeatMode === 1) btn.classList.add('active', 'repeat-one');
      else if (this.repeatMode === 2) btn.classList.add('active');
      btn.textContent = this.repeatMode === 0 ? '🔁' : this.repeatMode === 1 ? '🔂' : '🔁';
    }
  }

  // ── Dynamic color extraction ──
  _extractColor() {
    const img = document.getElementById('player-cover');
    if (!img || !img.src) return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      canvas.width = 1; canvas.height = 1;
      ctx.drawImage(image, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      const hsl = this._rgbToHsl(r, g, b);
      this.dominantColor = { r, g, b, hsl };
      document.documentElement.style.setProperty('--player-accent', `rgba(${r},${g},${b},0.3)`);
      document.documentElement.style.setProperty('--player-accent-solid', `rgb(${r},${g},${b})`);
    };
    image.src = img.src;
  }

  _rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  // ── UI Updates ──
  _updatePlayerUI() {
    if (!this.currentTrack) return;
    const track = this.currentTrack;
    const cover = document.getElementById('player-cover');
    const trackName = document.getElementById('player-track-name');
    const artistName = document.getElementById('player-artist-name');
    const dur = document.getElementById('player-duration');

    if (trackName) trackName.textContent = track.track_name || 'Unknown';
    if (artistName) artistName.textContent = `${track.artist_name || ''} • ${track.album_name || ''}`;
    if (cover) {
      cover.src = track.cover_url || getCoverArtUrl(track.album_id || track.track_id);
      cover.onerror = () => { cover.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect fill="#333" width="300" height="300"/><circle fill="#555" cx="150" cy="135" r="40"/><rect fill="#555" x="110" y="175" width="80" height="90" rx="6"/></svg>'); };
    }
    if (dur && track.duration) dur.textContent = this._formatTime(track.duration);
    this._renderQueue();
    this._updatePlayBtn();
  }

  _updatePlayBtn() {
    const btn = document.getElementById('player-play');
    const expandedBtn = document.getElementById('player-play-expanded');
    const icon = this.isPlaying ? '⏸' : '▶';
    if (btn) btn.textContent = icon;
    if (expandedBtn) expandedBtn.textContent = icon;
  }

  _updateProgress() {
    const current = document.getElementById('player-current-time');
    const fill = document.getElementById('player-progress-fill');
    const fillExp = document.getElementById('player-progress-fill-expanded');
    if (current) current.textContent = this._formatTime(this.audio.currentTime);
    const pct = this.audio.duration ? (this.audio.currentTime / this.audio.duration) * 100 : 0;
    if (fill) fill.style.width = pct + '%';
    if (fillExp) fillExp.style.width = pct + '%';
  }

  _updateDuration() {
    const dur = document.getElementById('player-duration');
    if (dur) dur.textContent = this._formatTime(this.audio.duration);
  }

  _updateVolumeUI() {
    const slider = document.getElementById('player-volume');
    const sliderExp = document.getElementById('player-volume-expanded');
    const btn = document.getElementById('player-volume-btn');
    const btnExp = document.getElementById('player-volume-btn-expanded');
    if (slider) slider.value = this.volume * 100;
    if (sliderExp) sliderExp.value = this.volume * 100;
    localStorage.setItem('viniz_volume', String(this.volume));
    const icon = this.audio.muted || this.volume === 0 ? '🔇' : this.volume < 0.33 ? '🔈' : this.volume < 0.66 ? '🔉' : '🔊';
    if (btn) btn.textContent = icon;
    if (btnExp) btnExp.textContent = icon;
  }

  _showLoader() {
    document.getElementById('player-loader')?.classList.remove('hidden');
  }

  _hideLoader() {
    document.getElementById('player-loader')?.classList.add('hidden');
  }

  _formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ── Queue rendering ──
  _renderQueue() {
    const panel = document.getElementById('queue-list');
    if (!panel) return;
    panel.innerHTML = '';
    if (this.queue.length === 0) {
      panel.innerHTML = '<div class="queue-empty">Queue is empty — add songs to get started</div>';
      return;
    }
    this.queue.forEach((t, i) => {
      const item = document.createElement('div');
      item.className = `queue-item${i === this.queueIndex ? ' active' : ''}`;
      item.innerHTML = `
        <img src="${t.cover_url || getCoverArtUrl(t.album_id || t.track_id)}" class="queue-cover" onerror="this.style.display='none'">
        <div class="queue-info">
          <span class="queue-track">${escapeHtml(t.track_name || 'Unknown')}</span>
          <span class="queue-artist">${escapeHtml(t.artist_name || '')}</span>
        </div>
        <span class="queue-duration">${this._formatTime(t.duration)}</span>
        <button class="queue-remove" data-idx="${i}">✕</button>
      `;
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('queue-remove')) return;
        this.queueIndex = i;
        this.currentTrack = t;
        this._loadAndPlay();
      });
      item.querySelector('.queue-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeFromQueue(i);
      });
      panel.appendChild(item);
    });

    const count = document.getElementById('queue-count');
    if (count) count.textContent = `${this.queue.length} track${this.queue.length !== 1 ? 's' : ''}`;
  }
}

// ── Global player instance ──
let player = null;

function initPlayer() {
  if (player) return player;
  player = new AudioPlayer();
  _bindPlayerUI();
  return player;
}

function _bindPlayerUI() {
  // Mini player controls
  document.getElementById('player-play')?.addEventListener('click', () => player.togglePlay());
  document.getElementById('player-next')?.addEventListener('click', () => player.next());
  document.getElementById('player-prev')?.addEventListener('click', () => player.prev());

  const progressBg = document.getElementById('player-progress-bg');
  progressBg?.addEventListener('click', (e) => {
    const rect = progressBg.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    player.seekByPercent(pct);
  });

  const volSlider = document.getElementById('player-volume');
  volSlider?.addEventListener('input', () => {
    player.volume = volSlider.value / 100;
    player.audio.volume = player.volume;
    player._updateVolumeUI();
  });

  document.getElementById('player-volume-btn')?.addEventListener('click', () => player.toggleMute());

  // Queue toggle
  document.getElementById('player-queue-btn')?.addEventListener('click', () => {
    const panel = document.getElementById('queue-panel');
    panel?.classList.toggle('hidden');
    player._renderQueue();
  });

  document.getElementById('player-shuffle')?.addEventListener('click', () => player.toggleShuffle());
  document.getElementById('player-repeat')?.addEventListener('click', () => player.toggleRepeat());
  document.getElementById('clear-queue-btn')?.addEventListener('click', () => player.clearQueue());

  // Mobile expanded player
  document.getElementById('player-bar')?.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('#player-progress-bg')) return;
    const expanded = document.getElementById('player-expanded');
    if (expanded && window.innerWidth < 768) {
      expanded.classList.remove('hidden');
    }
  });

  document.getElementById('player-minimize')?.addEventListener('click', () => {
    document.getElementById('player-expanded')?.classList.add('hidden');
  });

  // Expanded player controls
  document.getElementById('player-play-expanded')?.addEventListener('click', () => player.togglePlay());
  document.getElementById('player-next-expanded')?.addEventListener('click', () => player.next());
  document.getElementById('player-prev-expanded')?.addEventListener('click', () => player.prev());

  const progressBgExp = document.getElementById('player-progress-bg-expanded');
  progressBgExp?.addEventListener('click', (e) => {
    const rect = progressBgExp.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    player.seekByPercent(pct);
  });

  const volSliderExp = document.getElementById('player-volume-expanded');
  volSliderExp?.addEventListener('input', () => {
    player.volume = volSliderExp.value / 100;
    player.audio.volume = player.volume;
    player._updateVolumeUI();
  });

  document.getElementById('player-volume-btn-expanded')?.addEventListener('click', () => player.toggleMute());

  // Touch swipe on expanded player
  const expanded = document.getElementById('player-expanded');
  if (expanded) {
    let touchStartY = 0;
    expanded.addEventListener('touchstart', (e) => { touchStartY = e.touches[0].clientY; }, { passive: true });
    expanded.addEventListener('touchmove', (e) => {
      const diff = e.touches[0].clientY - touchStartY;
      if (diff > 80 && !e.target.closest('button') && !e.target.closest('input')) {
        expanded.classList.add('hidden');
      }
    }, { passive: true });
  }
}

// ── Helpers for inline play ──
async function playTrackFromListing(trackName, artistName, albumName, coverUrl, duration, trackId, albumId) {
  const p = initPlayer();
  const track = {
    track_id: trackId || '',
    track_name: trackName,
    artist_name: artistName,
    album_name: albumName || '',
    cover_url: coverUrl || getCoverArtUrl(albumId || trackId),
    duration: duration || 0,
    album_id: albumId || '',
    stream_url: trackId ? `/api/stream/${trackId}` : ''
  };
  p.playTrack(track);
}

async function playAlbumFromCover(albumId, albumName) {
  const res = await fetch(`/api/player/album-tracks/${albumId}`);
  const data = await res.json();
  if (data.tracks && data.tracks.length > 0) {
    initPlayer().playAlbum(data.tracks);
    showToast(`Playing album: ${albumName}`, 'info');
  } else {
    showToast('No tracks found for this album', 'error');
  }
}

async function playArtistTopTracks(artistId, artistName) {
  const res = await fetch(`/api/player/artist-top-tracks/${artistId}`);
  const data = await res.json();
  if (data.tracks && data.tracks.length > 0) {
    initPlayer().playAllTracks(data.tracks);
    showToast(`Playing top tracks: ${artistName}`, 'info');
  } else {
    showToast('No tracks found for this artist', 'error');
  }
}

// ── Play buttons in track listings ──
function renderPlayButton(trackName, artistName, albumName, coverUrl, duration, trackId, albumId) {
  const btn = document.createElement('button');
  btn.className = 'inline-play-btn';
  btn.textContent = '▶';
  btn.title = 'Play';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    playTrackFromListing(trackName, artistName, albumName, coverUrl, duration, trackId, albumId);
  });
  return btn;
}
