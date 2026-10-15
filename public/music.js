(() => {
  const $ = selector => document.querySelector(selector);
  if (!$('#tab-music')) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; } };
  const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* Private browsing can disable persistence. */ } };
  const state = { country: read('viniz-country', 'ZZ'), feed: 'trending', query: '', view: 'discover', group: 'tracks', page: 1, config: {}, items: [], jobs: read('viniz-music-jobs', []), loaded: false };
  if (!Array.isArray(state.jobs)) state.jobs = [];
  state.jobs = state.jobs.filter(job => job && typeof job.id === 'string').slice(-20);
  const bytes = number => {
    let n = Number(number) || 0, i = 0;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i && n < 100 ? 1 : 0)} ${units[i]}`;
  };
  const time = seconds => `${Math.floor((Number(seconds) || 0) / 60)}:${String(Math.floor((Number(seconds) || 0) % 60)).padStart(2, '0')}`;
  const artwork = value => {
    if (String(value).startsWith('/api/cover-art/')) return value + (value.includes('?') ? '&' : '?') + 'v=credits1';
    try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch (_) { return ''; }
  };
  const cover = item => artwork(item.image) || COVER_PLACEHOLDER;
  const countryName = () => state.config.countries?.find(c => c.code === state.country)?.name || 'Worldwide';
  const notify = (message, type = 'info') => showToast(message, type);
  async function api(url, options) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'This request could not be completed.');
    return data;
  }
  const empty = (title, text = '') => `<div class="music-empty"><strong>${esc(title)}</strong><p>${esc(text)}</p></div>`;
  const loading = text => `<div class="music-loading">${esc(text)}</div>`;
  const skeletons = () => Array.from({ length: 12 }, () => '<div class="music-skeleton" aria-hidden="true"></div>').join('');
  function imageFallbacks(target) {
    target.querySelectorAll('img').forEach(img => {
      if (img.getAttribute('src')?.startsWith('/api/cover-art/') && !img.src.includes('v=credits1')) img.src += (img.src.includes('?') ? '&' : '?') + 'v=credits1';
      img.addEventListener('error', () => { img.src = COVER_PLACEHOLDER; }, { once: true });
    });
  }
  function artistLink(person, local = false) {
    const button = document.createElement('button');
    button.className = 'music-artist-link'; button.textContent = person.name || 'Unknown artist';
    button.addEventListener('click', () => {
      if (local) openDetail({ kind: 'local-artist', name: person.name, id: person.id });
      else if (person.id) openDetail({ kind: 'artist', id: person.id });
      else searchFor(person.name);
    });
    return button;
  }
  function peopleLinks(target, item) {
    const people = item.artists?.length ? item.artists : [{ name: item.artist || 'Unknown artist' }];
    people.forEach((person, index) => { if (index) target.append(document.createTextNode(', ')); target.append(artistLink(person, item.kind?.startsWith('local-'))); });
  }
  function addButton(item) {
    const button = document.createElement('button'); button.className = 'music-add-btn';
    button.textContent = '↓ Download'; button.title = 'Add this song to Navidrome';
    button.disabled = !state.config.import || state.jobs.some(job => job.status === 'running');
    button.addEventListener('click', () => requestImport(item));
    return button;
  }
  function songCard(item, index, ranked = false) {
    if (item.kind === 'artist') return artistCard(item);
    const card = document.createElement('article'); card.className = 'music-track-card';
    const album = item.kind === 'album' || item.kind === 'local-album';
    card.innerHTML = `<div class="music-card-art"><img src="${esc(cover(item))}" loading="lazy" alt="">${ranked ? `<span class="music-rank">${String(index + 1).padStart(2, '0')}</span>` : ''}${item.localId ? `<span class="music-owned">✓ ${album ? 'Tracks saved' : 'In library'}</span>` : ''}</div><div class="music-card-info"><button class="music-card-title" title="${esc(item.title)}">${esc(item.title)}</button><div class="music-card-people"></div><small>${esc(album ? [item.year, item.type || 'Album'].filter(Boolean).join(' · ') : item.duration || 'YouTube Music')}</small></div><div class="music-card-actions"></div>`;
    const art = card.querySelector('.music-card-art');
    const play = document.createElement('button'); play.className = album ? 'music-card-open' : 'music-play-overlay';
    play.textContent = album ? '' : '▶'; play.setAttribute('aria-label', `${album ? 'Open' : 'Play'} ${item.title}`);
    const open = () => album ? openDetail({ kind: item.kind === 'local-album' ? 'local-album' : 'album', id: item.id, name: item.title }) : playSong(item);
    play.addEventListener('click', open); art.append(play); card.querySelector('.music-card-title').addEventListener('click', open);
    peopleLinks(card.querySelector('.music-card-people'), item);
    const actions = card.querySelector('.music-card-actions');
    if (album) {
      const button = document.createElement('button'); button.className = 'music-text-button'; button.textContent = 'View tracklist ↗'; button.addEventListener('click', open); actions.append(button);
    } else {
      const link = document.createElement('a'); link.href = `https://music.youtube.com/watch?v=${encodeURIComponent(item.id)}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'YouTube ↗'; actions.append(link);
      if (!item.localId) actions.append(addButton(item));
    }
    imageFallbacks(card); return card;
  }
  function artistCard(item) {
    const button = document.createElement('button'); button.className = 'music-artist-card';
    const movement = item.trend === 'up' ? ' ↗' : item.trend === 'down' ? ' ↘' : '';
    button.innerHTML = `<div class="music-artist-picture"><img src="${esc(cover(item))}" loading="lazy" alt=""></div><strong>${esc(item.title)}</strong><small>${item.rank ? `#${esc(item.rank)} on the chart${movement}` : item.subscribers ? `${esc(item.subscribers)} subscribers` : 'Explore artist'}</small>`;
    button.addEventListener('click', () => openDetail({ kind: 'artist', id: item.id })); imageFallbacks(button); return button;
  }
  function renderCards(target, items, ranked = false) {
    target.replaceChildren();
    if (!items.length) { target.innerHTML = empty('Nothing here yet', 'Try a different country or search.'); return; }
    items.forEach((item, index) => target.append(songCard(item, index, ranked)));
  }
  let discoveryController = null, discoverySequence = 0;
  async function loadDiscovery() {
    const sequence = ++discoverySequence;
    if (discoveryController) discoveryController.abort();
    discoveryController = new AbortController();
    const params = new URLSearchParams({ source: 'youtube', feed: state.query ? 'search' : state.feed, country: state.country });
    if (state.query) params.set('q', state.query);
    $('#music-results').className = state.feed === 'artists' && !state.query ? 'music-artists-grid' : 'music-results-grid';
    $('#music-results').innerHTML = skeletons();
    $('#music-artists-section').classList.add('hidden'); $('#music-albums-section').classList.add('hidden');
    $('#music-source-status').textContent = 'Tuning into YouTube Music…';
    $('#music-results-title').textContent = state.query ? `Results for “${state.query}”` : state.feed === 'artists' ? `Chart artists · ${countryName()}` : state.feed === 'recent' ? `Releases in rotation · ${countryName()}` : `Popular ${state.country === 'ZZ' ? 'worldwide' : 'in ' + countryName()}`;
    $('#music-clear-search').classList.toggle('hidden', !state.query);
    document.querySelectorAll('.music-feed-btn').forEach(button => button.classList.toggle('active', !state.query && button.dataset.feed === state.feed));
    document.querySelectorAll('[data-country]').forEach(button => button.classList.toggle('active', button.dataset.country === state.country));
    try {
      const data = await api(`/api/music/discover?${params}`, { signal: discoveryController.signal });
      if (sequence !== discoverySequence) return;
      state.items = data.items || [];
      renderCards($('#music-results'), state.items, !state.query && state.feed === 'trending');
      $('#music-source-status').textContent = data.label || 'YouTube Music';
      if (data.artists?.length && state.feed !== 'artists') {
        $('#music-artists-section').classList.remove('hidden');
        $('#music-artists').replaceChildren(...data.artists.slice(0, 12).map(artistCard));
        $('#music-artists-title').textContent = state.query ? 'Matching artists' : `Artists making waves · ${countryName()}`;
      }
      if (data.albums?.length) {
        $('#music-albums-section').classList.remove('hidden'); renderCards($('#music-albums'), data.albums);
      }
      if (state.feed === 'trending' && !state.query && state.items.length) updateHero(state.items);
    } catch (error) {
      if (error.name === 'AbortError' || sequence !== discoverySequence) return;
      $('#music-results').innerHTML = empty('We couldn’t tune in', `${error.message} Use Refresh to try again.`);
      $('#music-source-status').textContent = 'Connection interrupted';
    }
  }
  function updateHero(items) {
    $('#music-hero-art').innerHTML = items.slice(0, 2).map(item => `<img class="music-hero-cover" src="${esc(cover(item))}" alt="">`).join('');
    imageFallbacks($('#music-hero-art'));
    $('#music-hero-caption').textContent = `In rotation: ${items[0].title} · ${items[0].artist}`;
    $('#music-hero-edition').textContent = `${countryName().toUpperCase()} / IN ROTATION`;
    const play = $('#music-hero-play'); play.disabled = false; play.onclick = () => playSong(items[0]);
  }
  function searchFor(value) {
    switchView('discover'); state.query = value || ''; $('#music-search-input').value = state.query;
    if ($('#music-detail-dialog').open) $('#music-detail-dialog').close();
    loadDiscovery(); $('#music-results-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function setCountry(country) {
    if (!state.config.countries?.some(c => c.code === country)) return;
    state.country = country; state.query = ''; $('#music-search-input').value = ''; $('#music-country').value = country; save('viniz-country', country);
    $('#music-hero-play').disabled = true;
    $('#music-hero-caption').textContent = `Tuning into ${countryName()}…`;
    loadDiscovery();
  }
  function switchView(view) {
    state.view = view;
    ['discover', 'storage', 'activity'].forEach(name => $(`#music-view-${name}`).classList.toggle('hidden', name !== view));
    document.querySelectorAll('.music-view-btn').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    if (view === 'storage') loadLibrary(true);
    if (view === 'activity') renderActivity();
  }
  const playerDialog = $('#music-player-dialog');
  function playSong(item) {
    if (item.localId || item.kind === 'local-song') {
      if (playerDialog.open) playerDialog.close();
      if ($('#music-detail-dialog').open) $('#music-detail-dialog').close();
      playTrackFromListing(item.title, item.artist, item.album, item.image, item.durationSeconds, item.localId || item.id, item.localAlbumId || item.albumId);
      return;
    }
    if (!/^[A-Za-z0-9_-]{11}$/.test(item.id)) { notify('This recording is unavailable.', 'error'); return; }
    if (typeof player !== 'undefined' && player?.isPlaying) player.pause();
    $('#music-player-title').textContent = `${item.title} · ${item.artist}`;
    $('#music-video-player').innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.id)}?autoplay=1" title="${esc(item.title)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    if (!playerDialog.open) playerDialog.showModal();
  }
  $('#music-player-close').addEventListener('click', () => playerDialog.close());
  playerDialog.addEventListener('close', () => $('#music-video-player').replaceChildren());
  playerDialog.addEventListener('click', event => { if (event.target === playerDialog) playerDialog.close(); });

  const detailDialog = $('#music-detail-dialog');
  let detailStack = [], detailSequence = 0, currentDetail = null;
  async function openDetail(descriptor, back = false) {
    if (!back) detailStack.push(descriptor);
    if (!detailDialog.open) detailDialog.showModal();
    $('#music-detail-back').classList.toggle('hidden', detailStack.length < 2);
    const sequence = ++detailSequence;
    $('#music-detail-content').innerHTML = `<h2 id="music-detail-title" class="sr-only">Music details</h2>${loading('Opening your next favorite…')}`;
    detailDialog.scrollTop = 0;
    try {
      let data;
      if (descriptor.kind.startsWith('local-')) {
        const params = new URLSearchParams({ group: 'tracks', limit: '100', sort: descriptor.kind === 'local-album' ? 'track' : 'name' });
        params.set(descriptor.kind === 'local-artist' ? 'artistName' : 'albumId', descriptor.kind === 'local-artist' ? descriptor.name : descriptor.id);
        const library = await api(`/api/music/library?${params}`);
        let albums = [];
        if (descriptor.kind === 'local-artist') {
          const records = await api(`/api/music/library?${new URLSearchParams({ group: 'albums', artistName: descriptor.name, limit: '100', sort: 'name' })}`);
          albums = records.rows.map(localAlbum);
        }
        data = { kind: descriptor.kind, title: descriptor.name || library.rows[0]?.album || 'Album', image: descriptor.kind === 'local-artist' && descriptor.id ? `/api/cover-art/${encodeURIComponent(descriptor.id)}` : library.rows[0] ? `/api/cover-art/${encodeURIComponent(library.rows[0].album_id)}` : '',
          artist: descriptor.kind === 'local-album' ? library.rows[0]?.artist : '', items: library.rows.map(localSong), albums, selection: library.selection, total: library.total, params, page: 1 };
      } else data = await api(`/api/music/browse/${encodeURIComponent(descriptor.kind)}/${encodeURIComponent(descriptor.id)}?country=${state.country}`);
      if (sequence !== detailSequence || !detailDialog.open) return;
      currentDetail = data; renderDetail(data);
    } catch (error) {
      if (sequence !== detailSequence) return;
      $('#music-detail-content').innerHTML = `<h2 id="music-detail-title" class="sr-only">Music details</h2>${empty('Couldn’t open these details', error.message)}<button class="music-quiet-btn music-detail-more" id="music-detail-retry">Try again</button>`;
      $('#music-detail-retry').onclick = () => openDetail(descriptor, true);
    }
  }
  function localSong(row) {
    return { kind: 'local-song', id: row.id, localId: row.id, title: row.name, artist: row.artist, artists: row.artists, album: row.album, albumId: row.album_id, localAlbumId: row.album_id,
      durationSeconds: row.duration, duration: time(row.duration), bytes: row.bytes, image: `/api/cover-art/${encodeURIComponent(row.album_id || row.id)}` };
  }
  function localAlbum(row) {
    return { kind: 'local-album', id: row.id, title: row.name, artist: row.artist, artists: row.artists, image: `/api/cover-art/${encodeURIComponent(row.album_id || row.id)}`, bytes: row.bytes, year: bytes(row.bytes), type: `${row.tracks} songs` };
  }
  function trackRow(item, index) {
    const row = document.createElement('div'); row.className = 'music-detail-track';
    row.innerHTML = `<span class="music-detail-track-number">${index + 1}</span><img src="${esc(cover(item))}" alt="" loading="lazy"><div class="music-detail-track-main"><strong>${esc(item.title)}</strong><div class="music-detail-track-links"></div></div><small>${esc(item.bytes ? bytes(item.bytes) : item.duration || '')}</small>${item.localId ? '<span class="music-owned">✓ In library</span>' : ''}<div class="music-library-actions"><button class="music-row-play" aria-label="Play ${esc(item.title)}">▶</button></div>`;
    const links = row.querySelector('.music-detail-track-links'); peopleLinks(links, item);
    if (item.albumId) {
      const album = document.createElement('button'); album.className = 'music-album-link'; album.textContent = item.album;
      album.onclick = () => openDetail({ kind: item.kind === 'local-song' ? 'local-album' : 'album', id: item.albumId, name: item.album });
      links.append(document.createTextNode(' · '), album);
    }
    row.querySelector('.music-row-play').onclick = () => playSong(item);
    if (item.kind === 'local-song') {
      const remove = document.createElement('button'); remove.className = 'delete'; remove.textContent = '×'; remove.setAttribute('aria-label', `Delete ${item.title}`);
      remove.onclick = () => deleteTrack(item.id, item.title); row.querySelector('.music-library-actions').append(remove);
    } else if (!item.localId) row.append(addButton(item));
    imageFallbacks(row); return row;
  }
  function renderDetail(data) {
    const local = data.kind?.startsWith('local-');
    const meta = local ? `${data.selection.tracks} ${data.selection.tracks === 1 ? 'song' : 'songs'} · ${bytes(data.selection.bytes)} of audio storage` : [data.artist, data.year, data.subscribers ? `${data.subscribers} subscribers` : '', `${data.items?.length || 0} songs`].filter(Boolean).join(' · ');
    $('#music-detail-content').innerHTML = `<div class="music-detail-hero ${data.kind?.includes('artist') ? 'artist' : ''}"><img class="music-detail-image" src="${esc(cover(data))}" alt=""><div><span class="music-eyebrow">${local ? 'YOUR NAVIDROME COLLECTION' : 'YOUTUBE MUSIC / ' + (data.kind === 'artist' ? 'ARTIST' : 'ALBUM')}</span><h2 id="music-detail-title">${esc(data.title)}</h2><p>${esc(meta)}</p>${data.items?.length ? '<button class="music-primary" id="music-detail-play">▶ Play a song</button>' : ''}</div></div>${data.description ? `<details class="music-detail-description"><summary>About ${esc(data.title)}</summary>${esc(data.description)}</details>` : ''}<div class="music-detail-body"><h3>${data.kind?.includes('artist') ? 'Songs in rotation' : 'Tracklist'}</h3><div id="music-detail-tracks"></div><div id="music-detail-pagination"></div><div id="music-detail-albums"></div><div id="music-detail-related"></div></div>`;
    const tracks = $('#music-detail-tracks');
    if (!data.items?.length) tracks.innerHTML = empty('No songs available', 'Explore the albums below.');
    else { data.items.forEach((item, index) => tracks.append(trackRow(item, index))); $('#music-detail-play').onclick = () => playSong(data.items[0]); }
    if (local && data.items.length < data.total) {
      const more = document.createElement('button'); more.className = 'music-quiet-btn music-detail-more'; more.textContent = `Load more (${data.items.length} of ${data.total})`;
      more.onclick = async () => {
        more.disabled = true;
        try {
          const params = new URLSearchParams(data.params); params.set('page', String(data.page + 1));
          const next = await api(`/api/music/library?${params}`);
          if (currentDetail !== data || !detailDialog.open) return;
          data.items.push(...next.rows.map(localSong)); data.page++; renderDetail(data);
        } catch (error) { notify(error.message, 'error'); more.disabled = false; }
      };
      $('#music-detail-pagination').append(more);
    }
    if (data.albums?.length) {
      $('#music-detail-albums').innerHTML = '<h3>Albums & singles</h3><div class="music-results-grid"></div>';
      renderCards($('#music-detail-albums .music-results-grid'), data.albums);
    }
    if (data.kind === 'artist' && data.artists?.length) {
      $('#music-detail-related').innerHTML = '<h3>Keep exploring</h3><div class="music-artists-rail"></div>';
      $('#music-detail-related .music-artists-rail').replaceChildren(...data.artists.map(artistCard));
    }
    imageFallbacks($('#music-detail-content'));
  }
  $('#music-detail-close').onclick = () => detailDialog.close();
  $('#music-detail-back').onclick = () => { detailStack.pop(); openDetail(detailStack.at(-1), true); };
  detailDialog.addEventListener('close', () => { detailSequence++; detailStack = []; currentDetail = null; });
  detailDialog.addEventListener('click', event => { if (event.target === detailDialog) detailDialog.close(); });

  function renderStorage(data) {
    const s = data.summary;
    const share = data.disk?.total ? Math.min(360, s.bytes / data.disk.total * 360) : 360;
    $('#music-storage-overview').innerHTML = `<div class="music-storage-total"><div class="music-storage-ring" style="--share:${share}deg"></div><div><span class="music-eyebrow">MUSIC AUDIO</span><strong>${bytes(s.bytes)}</strong><small>${data.disk ? `${bytes(data.disk.free)} free on this drive` : 'Indexed by Navidrome'}</small></div></div><div class="music-storage-stat"><span>Songs</span><strong>${Number(s.tracks).toLocaleString()}</strong><small>Yours to come back to</small></div><div class="music-storage-stat"><span>Artists</span><strong>${Number(s.artists).toLocaleString()}</strong><small>Distinct voices</small></div><div class="music-storage-stat"><span>Albums</span><strong>${Number(s.albums).toLocaleString()}</strong><small>Stories on repeat</small></div>`;
    const breakdown = (selector, items, type) => {
      const target = $(selector); target.replaceChildren();
      if (!items.length) { target.innerHTML = '<p class="music-muted">Your collection is waiting for its first song.</p>'; return; }
      items.forEach(item => {
        const percent = s.bytes ? item.bytes / s.bytes * 100 : 0;
        const button = document.createElement('button'); button.className = 'music-breakdown-row';
        button.innerHTML = `<img src="/api/cover-art/${encodeURIComponent(type === 'artist' ? item.id : item.album_id || item.id || '')}" alt="" loading="lazy"><div class="music-breakdown-main"><div><span>${esc(item.name)}${type === 'album' ? ` · ${esc(item.artist)}` : ''}</span><strong>${bytes(item.bytes)}</strong></div><i><b style="width:${Math.max(.5, percent)}%"></b></i></div><small>${percent.toFixed(1)}%</small>`;
        button.onclick = () => openDetail({ kind: `local-${type}`, id: item.id, name: item.name }); target.append(button);
      }); imageFallbacks(target);
    };
    breakdown('#music-largest-artists', data.largestArtists, 'artist'); breakdown('#music-largest-albums', data.largestAlbums, 'album');
  }
  let librarySequence = 0;
  async function loadLibrary(reset = true) {
    const sequence = ++librarySequence;
    if (reset) state.page = 1;
    const page = state.page, group = state.group, list = $('#music-library-list');
    if (reset) { list.className = group === 'tracks' ? 'music-library-list' : 'music-library-list music-library-cards'; list.innerHTML = loading('Reading your collection…'); }
    $('#music-library-more').disabled = true;
    const params = new URLSearchParams({ group, page: String(page), limit: '30', sort: $('#music-library-sort').value, q: $('#music-library-search').value.trim() });
    try {
      const data = await api(`/api/music/library?${params}`);
      if (sequence !== librarySequence) return;
      renderStorage(data); if (reset) list.replaceChildren();
      if (!data.rows.length && reset) list.innerHTML = empty('No music found', 'Try another filter, or discover something new.');
      data.rows.forEach(row => {
        const element = document.createElement('div'); element.className = 'music-library-row';
        element.innerHTML = `<button class="music-library-main"><img src="/api/cover-art/${encodeURIComponent(row.album_id || row.id)}" alt="" loading="lazy"><div><strong>${esc(row.name)}</strong><span>${esc(group === 'artists' ? `${row.tracks} songs` : row.artist)}${group === 'tracks' && row.album ? ` · ${esc(row.album)}` : ''}</span></div></button><span class="music-library-meta">${group !== 'tracks' ? `${row.tracks} songs · ` : ''}${bytes(row.bytes)}</span><div class="music-library-actions"></div>`;
        element.querySelector('.music-library-main').onclick = () => group === 'tracks' ? playSong(localSong(row)) : openDetail({ kind: group === 'artists' ? 'local-artist' : 'local-album', id: row.id, name: row.name });
        if (group === 'tracks') {
          const actions = element.querySelector('.music-library-actions');
          const play = document.createElement('button'); play.textContent = '▶'; play.setAttribute('aria-label', `Play ${row.name}`); play.onclick = () => playSong(localSong(row));
          const remove = document.createElement('button'); remove.textContent = '×'; remove.className = 'delete'; remove.setAttribute('aria-label', `Delete ${row.name}`); remove.onclick = () => deleteTrack(row.id, row.name);
          actions.append(play, remove);
        }
        list.append(element);
      }); imageFallbacks(list);
      $('#music-library-count').textContent = `${data.total.toLocaleString()} ${group} · sorted by ${$('#music-library-sort').selectedOptions[0].text.toLowerCase()}`;
      $('#music-library-more').classList.toggle('hidden', page * 30 >= data.total);
    } catch (error) { if (sequence === librarySequence) { if (reset) list.innerHTML = empty('Collection unavailable', error.message); else { state.page = Math.max(1, page - 1); notify(error.message, 'error'); } } }
    finally { if (sequence === librarySequence) $('#music-library-more').disabled = false; }
  }
  function setGroup(group) {
    state.group = group; document.querySelectorAll('.music-library-btn').forEach(button => button.classList.toggle('active', button.dataset.group === group)); loadLibrary(true);
  }
  async function deleteTrack(id, title) {
    if (!window.confirm(`Permanently delete “${title}” from your collection? The audio file will be removed.`)) return;
    try {
      await api(`/api/music/library/${encodeURIComponent(id)}`, { method: 'DELETE' });
      notify('Removed. Navidrome will update on its next library scan.', 'success');
      loadLibrary(true);
      if (detailDialog.open && detailStack.at(-1)?.kind.startsWith('local-')) openDetail(detailStack.at(-1), true);
    } catch (error) { notify(error.message, 'error'); }
  }
  const polling = new Set();
  function persistJobs() { save('viniz-music-jobs', state.jobs.slice(-20)); renderActivity(); }
  function renderActivity() {
    const running = state.jobs.some(job => job.status === 'running'); $('#music-job-count').textContent = running ? '1' : '';
    document.querySelectorAll('.music-add-btn').forEach(button => button.disabled = !state.config.import || running);
    $('#music-activity').innerHTML = state.jobs.length ? [...state.jobs].reverse().map(job => `<article class="music-import-card"><div><strong>${esc(job.title || job.query || 'Music import')}</strong><p>${job.status === 'running' ? 'Preparing audio, artwork and lyrics. It will appear in Navidrome after the library scan.' : job.status === 'complete' ? 'Import complete. Navidrome will index this song on its next scan.' : job.status === 'unknown' ? 'The server restarted or this job expired. Check your collection before retrying.' : 'The import could not finish. You can retry from discovery.'}</p>${job.output ? `<details><summary>View download log</summary><pre>${esc(job.output)}</pre></details>` : ''}</div><span class="job-status">${job.status === 'running' ? '◌ Downloading' : job.status === 'complete' ? '✓ Complete' : job.status === 'unknown' ? 'Status unavailable' : 'Needs attention'}</span></article>`).join('') : empty('Your next favorite is one click away', 'Choose Download on a song to add it to your Navidrome collection.');
  }
  async function requestImport(item) {
    if (!state.config.import || state.jobs.some(job => job.status === 'running')) return;
    if (!window.confirm(`Add “${item.title}” by ${item.artist} to Navidrome?\n\nContinue if you own this recording or are authorized to download it.`)) return;
    try {
      const job = await api('/api/music/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: item.url || `${item.artist} - ${item.title}`, authorized: true }) });
      state.jobs.push({ ...job, title: `${item.title} · ${item.artist}`, startedAt: new Date().toISOString() });
      state.jobs = state.jobs.slice(-20); persistJobs(); pollJob(job.id); notify('Download started. Follow its progress in Downloads.');
    } catch (error) { notify(error.message, 'error'); }
  }
  async function pollJob(id) {
    if (polling.has(id)) return; polling.add(id);
    try {
      for (;;) {
        const stored = state.jobs.find(job => job.id === id); if (!stored || stored.status !== 'running') break;
        await new Promise(resolve => setTimeout(resolve, 2500));
        try {
          const response = await fetch(`/api/music/import/${encodeURIComponent(id)}`);
          if (response.status === 404) { stored.status = 'unknown'; persistJobs(); break; }
          if (!response.ok) continue;
          const data = await response.json(); Object.assign(stored, data); persistJobs();
          if (data.status !== 'running') {
            notify(data.status === 'complete' ? 'Download complete. Your library will update shortly.' : 'Download failed. See Downloads for details.', data.status === 'complete' ? 'success' : 'error');
            if (state.view === 'storage') loadLibrary(true);
            break;
          }
        } catch (_) { /* Reconnect after a transient network failure. */ }
      }
    } finally { polling.delete(id); }
  }
  document.querySelectorAll('.music-view-btn').forEach(button => button.onclick = () => switchView(button.dataset.view));
  document.querySelectorAll('.music-feed-btn').forEach(button => button.onclick = () => { state.feed = button.dataset.feed; state.query = ''; $('#music-search-input').value = ''; loadDiscovery(); });
  document.querySelectorAll('[data-country]').forEach(button => button.onclick = () => setCountry(button.dataset.country));
  document.querySelectorAll('.music-library-btn').forEach(button => button.onclick = () => setGroup(button.dataset.group));
  document.querySelectorAll('[data-show-group]').forEach(button => button.onclick = () => { setGroup(button.dataset.showGroup); $('#music-library-list').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('#music-country').onchange = event => setCountry(event.target.value);
  $('#music-search-form').onsubmit = event => { event.preventDefault(); state.query = $('#music-search-input').value.trim(); loadDiscovery(); };
  $('#music-clear-search').onclick = () => { state.query = ''; $('#music-search-input').value = ''; loadDiscovery(); };
  $('#music-refresh-discovery').onclick = () => loadDiscovery();
  $('#music-jump-artists').onclick = () => { state.feed = 'artists'; state.query = ''; $('#music-search-input').value = ''; loadDiscovery(); $('#music-results-title').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  $('#music-all-artists').onclick = $('#music-jump-artists').onclick;
  $('#music-repair-artwork').onclick = async () => {
    const button = $('#music-repair-artwork'); button.disabled = true; button.textContent = 'Repairing…';
    try {
      await api('/api/artwork/repair', { method: 'POST' });
      notify('Checking artist portraits and album covers…');
      for (;;) {
        await new Promise(resolve => setTimeout(resolve, 2500));
        const job = await api('/api/artwork/repair');
        button.textContent = `Artwork ${job.completed}/${job.total}`;
        if (job.status === 'failed') throw new Error('Artwork repair could not finish. Please retry.');
        if (job.status !== 'running') {
          document.querySelectorAll('img[src*="/api/cover-art/"]').forEach(img => img.src += `${img.src.includes('?') ? '&' : '?'}repair=${Date.now()}`);
          notify(job.missing?.length ? `Artwork refreshed. ${job.missing.length} entries have no verified image.` : 'Artwork refreshed for your collection.', 'success');
          break;
        }
      }
    } catch (error) { notify(error.message, 'error'); }
    finally { button.disabled = false; button.textContent = 'Repair artwork'; }
  };
  $('#music-refresh-library').onclick = () => loadLibrary(true);
  $('#music-library-sort').onchange = () => loadLibrary(true);
  $('#music-library-more').onclick = () => { state.page++; loadLibrary(false); };
  let searchTimer;
  $('#music-library-search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadLibrary(true), 250); };
  let initialization;
  window.loadVinizMusic = () => initialization ||= (async () => {
    try {
      state.config = await api('/api/music/config');
      if (!state.config.countries.some(country => country.code === state.country)) state.country = 'ZZ';
      $('#music-country').innerHTML = state.config.countries.map(country => `<option value="${esc(country.code)}">${esc(country.name)}</option>`).join('');
      $('#music-country').value = state.country;
      $('#music-connection').textContent = state.config.library ? 'Navidrome connected' : 'Library offline';
      renderActivity(); state.jobs.filter(job => job.status === 'running').forEach(job => pollJob(job.id));
      state.loaded = true; await loadDiscovery();
    } catch (error) {
      initialization = null; $('#music-results').innerHTML = empty('Couldn’t connect to Viniz', error.message); $('#music-connection').textContent = 'Server unavailable';
    }
  })();
  window.loadVinizMusic();
})();
