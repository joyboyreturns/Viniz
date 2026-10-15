(() => {
  const state = { source: 'youtube', feed: 'trending', query: '', group: 'tracks', page: 1, total: 0, config: {} };
  const $ = (selector) => document.querySelector(selector);
  const results = $('#music-results');
  if (!results) return;

  const safeImage = (url) => {
    try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : ''; }
    catch (_) { return ''; }
  };
  const bytes = (n) => {
    const value = Number(n) || 0;
    if (value < 1024) return `${value} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = value / 1024, unit = 0;
    while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
    return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unit]}`;
  };
  const esc = (value) => escapeHtml(String(value ?? ''));

  async function loadConfig() {
    try {
      const response = await fetch('/api/music/config');
      state.config = await response.json();
      const status = $('#music-source-status');
      if (status && !state.config.library) status.textContent = 'Navidrome library is unavailable. Check the Viniz database mount.';
      if (status && !state.config.import) status.textContent += `${status.textContent ? ' ' : ''}Imports need server setup.`;
    } catch (_) { state.config = {}; }
  }

  async function loadDiscovery() {
    results.innerHTML = '<div class="music-loading">Finding something good…</div>';
    $('#music-video-player').classList.add('hidden');
    const params = new URLSearchParams({ source: state.source, feed: state.query ? 'search' : state.feed });
    if (state.query) params.set('q', state.query);
    try {
      const response = await fetch(`/api/music/discover?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load music.');
      renderDiscover(data.items || []);
    } catch (error) {
      results.innerHTML = `<div class="music-empty"><span>♪</span><strong>Music discovery needs a connection</strong><p>${esc(error.message)}</p><small>YouTube discovery runs without an API key. Spotify discovery needs server credentials.</small></div>`;
    }
  }

  function renderDiscover(items) {
    if (!items.length) {
      results.innerHTML = '<div class="music-empty"><span>♫</span><strong>No matches yet</strong><p>Try another artist or track.</p></div>';
      return;
    }
    results.innerHTML = '';
    items.forEach((item, index) => {
      const card = document.createElement('article');
      card.className = 'music-track-card';
      const image = safeImage(item.image);
      const preview = safeImage(item.previewUrl);
      const link = safeImage(item.url);
      const date = item.publishedAt ? new Date(item.publishedAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '';
      card.innerHTML = `
        <div class="music-card-art ${image ? '' : 'no-art'}">
          ${image ? `<img src="${esc(image)}" alt="" loading="lazy">` : '<span>♫</span>'}
          ${item.embedUrl ? `<button class="music-play-overlay" data-video="${esc(item.embedUrl)}" data-title="${esc(item.title)}" aria-label="Play ${esc(item.title)}">▶</button>` : ''}
          <span class="music-rank">${String(index + 1).padStart(2, '0')}</span>
        </div>
        <div class="music-card-info"><strong title="${esc(item.title)}">${esc(item.title)}</strong><span title="${esc(item.artist)}">${esc(item.artist)}</span>
          <small>${esc(item.provider)}${date ? ` · ${esc(date)}` : ''}${item.views ? ` · ${Number(item.views).toLocaleString()} views` : ''}</small>
        </div>
        <div class="music-card-actions">
          ${preview ? `<button class="music-preview-btn" data-preview="${esc(preview)}" title="Play 30 second preview">Preview</button>` : ''}
          ${link ? `<a class="music-provider-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open ↗</a>` : ''}
          <button class="music-add-btn" data-title="${esc(item.title)}" data-artist="${esc(item.artist)}" data-query="${esc(item.provider === 'YouTube' ? item.url : `${item.artist} - ${item.title}`)}" ${state.config.import ? '' : 'disabled'} title="Add an authorized copy to Navidrome">＋</button>
        </div>`;
      results.appendChild(card);
    });
    results.querySelectorAll('[data-video]').forEach(button => button.addEventListener('click', () => {
      const player = $('#music-video-player');
      player.innerHTML = `<div class="music-video-heading"><strong>${esc(button.dataset.title)}</strong><button class="music-quiet-btn" data-close-video>Close</button></div><iframe src="${esc(button.dataset.video)}?autoplay=1" title="YouTube music video" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
      player.classList.remove('hidden');
      player.scrollIntoView({ behavior: 'smooth', block: 'center' });
      player.querySelector('[data-close-video]').addEventListener('click', () => { player.innerHTML = ''; player.classList.add('hidden'); });
    }));
    results.querySelectorAll('[data-preview]').forEach(button => button.addEventListener('click', () => togglePreview(button)));
    results.querySelectorAll('.music-add-btn').forEach(button => button.addEventListener('click', () => requestImport(button.dataset.title, button.dataset.artist, button.dataset.query)));
  }

  let activePreview = null;
  function togglePreview(button) {
    if (activePreview) { activePreview.audio.pause(); activePreview.audio.currentTime = 0; activePreview.button.textContent = 'Preview'; }
    if (activePreview?.button === button) { activePreview = null; return; }
    const audio = new Audio(button.dataset.preview);
    audio.volume = 0.75;
    button.textContent = 'Pause';
    activePreview = { audio, button };
    audio.play().catch(() => { button.textContent = 'Preview'; activePreview = null; });
    audio.addEventListener('ended', () => { button.textContent = 'Preview'; activePreview = null; }, { once: true });
  }

  async function requestImport(title, artist, query) {
    if (!state.config.import) return;
    const approved = window.confirm(`Add “${title}” by ${artist} to Navidrome?\n\nOnly continue if you own this recording or are authorized to download it.`);
    if (!approved) return;
    try {
      const response = await fetch('/api/music/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query || `${artist} - ${title}`, authorized: true })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Import could not start.');
      showToast('Import started. Adding it to Navidrome…', 'info');
      pollImport(data.id, `${artist} - ${title}`);
    } catch (error) { showToast(error.message, 'error'); }
  }

  async function pollImport(id, label) {
    for (let attempt = 0; attempt < 180; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      try {
        const response = await fetch(`/api/music/import/${encodeURIComponent(id)}`);
        const job = await response.json();
        if (job.status === 'complete') {
          showToast(`Added ${label}. Navidrome will refresh the library shortly.`, 'success');
          loadLibrary(true);
          return;
        }
        if (job.status === 'failed') {
          showToast(`Import failed: ${String(job.output || 'Unknown error').slice(-180)}`, 'error');
          return;
        }
      } catch (_) { /* retry transient connection errors */ }
    }
    showToast('Import is still running. Refresh the library in a moment.', 'info');
  }

  function renderStorage(data) {
    const summary = data.summary || {};
    $('#music-storage-overview').innerHTML = `
      <div class="music-storage-total"><div><span class="music-eyebrow">ON DISK</span><strong>${bytes(summary.bytes)}</strong></div><span class="music-storage-disc">♫</span></div>
      <div class="music-storage-stat"><span>Tracks</span><strong>${Number(summary.tracks || 0).toLocaleString()}</strong></div>
      <div class="music-storage-stat"><span>Artists</span><strong>${Number(summary.artists || 0).toLocaleString()}</strong></div>
      <div class="music-storage-stat"><span>Albums</span><strong>${Number(summary.albums || 0).toLocaleString()}</strong></div>`;
    const fillList = (selector, items) => {
      const target = $(selector);
      if (!items?.length) { target.innerHTML = '<p class="music-muted">Nothing here yet.</p>'; return; }
      const max = Math.max(...items.map(item => Number(item.bytes) || 0), 1);
      target.innerHTML = items.map(item => `<div class="music-breakdown-row"><div><span>${esc(item.name)}</span><strong>${bytes(item.bytes)}</strong></div><i><b style="width:${Math.max(2, Math.round((Number(item.bytes) / max) * 100))}%"></b></i></div>`).join('');
    };
    fillList('#music-largest-artists', data.largestArtists);
    fillList('#music-largest-albums', data.largestAlbums);
  }

  async function loadLibrary(reset = false) {
    if (reset) state.page = 1;
    const list = $('#music-library-list');
    if (reset || !list.children.length) list.innerHTML = '<div class="music-loading">Reading your library…</div>';
    const params = new URLSearchParams({ group: state.group, page: String(state.page), limit: '30', sort: $('#music-library-sort').value });
    const query = $('#music-library-search').value.trim();
    if (query) params.set('q', query);
    try {
      const response = await fetch(`/api/music/library?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not read library.');
      renderStorage(data);
      renderLibraryRows(data, reset);
      state.total = data.total || 0;
      $('#music-library-count').textContent = `${state.total.toLocaleString()} ${state.group}`;
      $('#music-library-more').classList.toggle('hidden', state.page * 30 >= state.total);
    } catch (error) {
      list.innerHTML = `<div class="music-empty"><span>♫</span><strong>Library not available</strong><p>${esc(error.message)}</p></div>`;
    }
  }

  function renderLibraryRows(data, reset) {
    const list = $('#music-library-list');
    if (reset) list.innerHTML = '';
    if (!data.rows?.length && reset) { list.innerHTML = '<div class="music-empty compact"><strong>No music found</strong><p>Try a different search, or import an authorized recording.</p></div>'; return; }
    data.rows.forEach(row => {
      const item = document.createElement('div');
      item.className = 'music-library-row';
      const isTrack = state.group === 'tracks';
      item.innerHTML = `<div class="music-library-main"><span class="music-library-glyph">${isTrack ? '♫' : state.group === 'albums' ? '▤' : '♬'}</span><div><strong>${esc(row.name)}</strong><span>${esc(row.artist || (state.group === 'artists' ? `${row.tracks} songs` : row.album || ''))}</span></div></div>
        <span class="music-library-meta">${Number(row.tracks || 1).toLocaleString()} ${row.tracks === 1 ? 'track' : 'tracks'} · ${bytes(row.bytes)}</span>
        <div class="music-library-actions">${isTrack ? `<button data-play="${esc(row.id)}" title="Play in Viniz">▶</button><button class="delete" data-delete="${esc(row.id)}" data-title="${esc(row.name)}" title="Remove from library">⌫</button>` : ''}</div>`;
      list.appendChild(item);
      const play = item.querySelector('[data-play]');
      if (play) play.addEventListener('click', () => playTrackFromListing(row.name, row.artist, row.album, '', row.duration, row.id, row.album_id));
      const remove = item.querySelector('[data-delete]');
      if (remove) remove.addEventListener('click', () => deleteTrack(remove.dataset.delete, remove.dataset.title, item));
    });
  }

  async function deleteTrack(id, title, element) {
    if (!window.confirm(`Permanently remove “${title}” from your music storage? This deletes the audio file.`)) return;
    try {
      const response = await fetch(`/api/music/library/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not delete track.');
      element.remove();
      showToast(data.message, 'success');
      loadLibrary(true);
    } catch (error) { showToast(error.message, 'error'); }
  }

  document.querySelectorAll('.music-source-btn').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.music-source-btn').forEach(item => item.classList.toggle('active', item === button));
    state.source = button.dataset.source;
    loadDiscovery();
  }));
  document.querySelectorAll('.music-feed-btn').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.music-feed-btn').forEach(item => item.classList.toggle('active', item === button));
    state.feed = button.dataset.feed;
    state.query = '';
    $('#music-search-input').value = '';
    loadDiscovery();
  }));
  document.querySelectorAll('.music-library-btn').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.music-library-btn').forEach(item => item.classList.toggle('active', item === button));
    state.group = button.dataset.group;
    state.page = 1;
    loadLibrary(true);
  }));
  $('#music-search-form').addEventListener('submit', event => {
    event.preventDefault();
    state.query = $('#music-search-input').value.trim();
    loadDiscovery();
  });
  let librarySearchTimer = null;
  $('#music-library-search').addEventListener('input', () => {
    clearTimeout(librarySearchTimer);
    librarySearchTimer = setTimeout(() => loadLibrary(true), 250);
  });
  $('#music-library-sort').addEventListener('change', () => loadLibrary(true));
  $('#music-library-more').addEventListener('click', () => { state.page++; loadLibrary(false); });
  $('#music-refresh-library').addEventListener('click', () => loadLibrary(true));
  window.loadVinizMusic = async () => { await loadConfig(); loadDiscovery(); loadLibrary(true); };
  window.loadVinizMusic();
})();
