// ── Utilities ──
function getCoverArtUrl(id) {
    if (!id) return '';
    return `/api/cover-art/${id}`;
}

function formatPlaytime(seconds) {
    if (!seconds) return '0.0 min';
    const minutes = seconds / 60;
    if (minutes >= 60) {
        const h = Math.floor(minutes / 60);
        const m = Math.floor(minutes % 60);
        return `${h}h ${m}m`;
    }
    return `${minutes.toFixed(1)} min`;
}

function formatTime(ts) {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts) {
    const d = new Date(ts * 1000);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(ts) {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ── Toast System ──
function showToast(message, type) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type || 'info'}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ── Theme System ──
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || 'light';
    document.documentElement.setAttribute('data-theme', initialTheme);
    updateThemeButton();
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeButton();
    setTimeout(updateChartsForTheme, 50);
}

function updateThemeButton() {
    const themeBtn = document.getElementById('theme-toggle');
    if (!themeBtn) return;
    const currentTheme = document.documentElement.getAttribute('data-theme');
    themeBtn.textContent = currentTheme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
}

function getChartColors() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
        grid: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.08)',
        tick: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)',
        tickBright: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)',
        legend: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)',
        yTick: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)',
    };
}

function updateChartsForTheme() {
    const c = getChartColors();
    if (barChartInstance) {
        barChartInstance.options.scales.y.grid.color = c.grid;
        barChartInstance.options.scales.y.ticks.color = c.tickBright;
        barChartInstance.options.scales.x.ticks.color = c.tickBright;
        barChartInstance.update();
    }
    if (hourlyChartInstance) {
        hourlyChartInstance.options.scales.y.grid.color = c.grid;
        hourlyChartInstance.options.scales.y.ticks.color = c.tick;
        hourlyChartInstance.options.scales.x.ticks.color = c.tick;
        hourlyChartInstance.update();
    }
    if (dayOfWeekChartInstance) {
        dayOfWeekChartInstance.options.plugins.legend.labels.color = c.legend;
        dayOfWeekChartInstance.update();
    }
    if (growthChartInstance) {
        growthChartInstance.options.scales.y.grid.color = c.grid;
        growthChartInstance.options.scales.y.ticks.color = c.tick;
        growthChartInstance.options.scales.y1.ticks.color = c.tick;
        growthChartInstance.options.scales.x.ticks.color = c.tick;
        growthChartInstance.options.plugins.legend.labels.color = c.legend;
        growthChartInstance.update();
    }
    if (genreChartInstance) {
        genreChartInstance.options.scales.x.grid.color = c.grid;
        genreChartInstance.options.scales.x.ticks.color = c.tick;
        genreChartInstance.options.scales.y.ticks.color = c.yTick;
        genreChartInstance.update();
    }
}

// ── Chart Instances ──
let barChartInstance = null;
let chartDataCache = [];
let currentChartMode = 'views';

let hourlyChartInstance = null;
let dayOfWeekChartInstance = null;
let growthChartInstance = null;
let genreChartInstance = null;

// ── Tab Navigation ──
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanels = {};

document.querySelectorAll('.tab-panel').forEach(p => {
    tabPanels[p.id.replace('tab-', '')] = p;
});

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
    });
});

// ── Dashboard ──
async function fetchChartData() {
    const res = await fetch('/api/stats/chart');
    chartDataCache = await res.json();
    renderChart();
}

function renderChart() {
    const canvas = document.getElementById('summaryBarChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (barChartInstance) barChartInstance.destroy();
    
    const labels = [];
    const dataPoints = [];
    
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dayStr = d.toISOString().split('T')[0];
        const row = chartDataCache.find(r => r.day === dayStr);
        labels.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
        dataPoints.push(row ? (currentChartMode === 'views' ? row.views : row.plays) : 0);
    }

    const isViews = currentChartMode === 'views';
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, isViews ? '#fa233b' : '#0a84ff');
    gradient.addColorStop(1, isViews ? 'rgba(250,35,59,0.1)' : 'rgba(10,132,255,0.1)');

    const cc = getChartColors();
    barChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: isViews ? 'Views' : 'Plays',
                data: dataPoints,
                backgroundColor: gradient,
                borderRadius: 6,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: cc.grid }, ticks: { color: cc.tickBright, stepSize: 1, callback: v => Number.isInteger(v) ? v : '' } },
                x: { grid: { display: false }, ticks: { color: cc.tickBright } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

document.querySelectorAll('.chart-toggle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.chart-toggle-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        currentChartMode = e.currentTarget.dataset.mode;
        renderChart();
    });
});

document.getElementById('global-time-toggler').addEventListener('change', (e) => {
    currentTimeFilter = e.target.value;
    fetchSummary(currentTimeFilter);
    fetchChartData();
    fetchList('tracks', currentTimeFilter);
    fetchList('albums', currentTimeFilter);
    fetchList('artists', currentTimeFilter);
    if (document.getElementById('tab-insights').classList.contains('active')) {
        loadInsights();
    }
    if (document.getElementById('tab-discover').classList.contains('active')) {
        loadDiscoverTab();
    }
    if (searchInput.value.trim()) performSearch();
});

async function fetchSummary(filter) {
    const res = await fetch(`/api/stats/summary?filter=${filter}`);
    const data = await res.json();
    animateNumber('total-plays', data.plays || 0);
    document.getElementById('total-playtime').innerText = formatPlaytime(data.playtime || 0);
    animateNumber('total-views', data.views || 0);
}

function animateNumber(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const current = parseInt(el.innerText.replace(/,/g, '')) || 0;
    if (current === target) { el.innerText = target.toLocaleString(); return; }
    el.innerText = target.toLocaleString();
}

function renderListItems(dataList, listElId, type) {
    const listEl = document.getElementById(listElId);
    if (!listEl) return;
    listEl.innerHTML = '';
    
    dataList.forEach(item => {
        const li = document.createElement('li');
        if (type === 'artists') {
            li.classList.add('artist-item');
            li.addEventListener('click', () => openArtistModal(item.artist_name, 'all'));
        }
        if (type === 'albums') {
            li.addEventListener('click', () => openAlbumModal(item.album_name));
        }
        
        let imgUrl = '';
        let title = '';
        let sub = '';
        
        if (type === 'tracks') {
            imgUrl = getCoverArtUrl(item.album_id || item.track_id);
            title = item.track_name;
            sub = item.artist_name;
        } else if (type === 'albums') {
            imgUrl = getCoverArtUrl(item.album_id);
            title = item.album_name;
            sub = item.artist_name;
        } else if (type === 'artists') {
            imgUrl = getCoverArtUrl(item.artist_id);
            title = item.artist_name;
            sub = `${item.plays} plays`;
        }
        
        li.innerHTML = `
            <img src="${imgUrl}" class="cover-art" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIiB2aWV3Qm94PSIwIDAgMzAwIDMwMCI+PHJlY3QgZmlsbD0iIzJhMmEyYSIgd2lkdGg9IjMwMCIgaGVpZ2h0PSIzMDAiLz48Y2lyY2xlIGZpbGw9IiM0NDQiIGN4PSIxNTAiIGN5PSIxMzAiIHI9IjM1Ii8+PHJlY3QgZmlsbD0iIzQ0NCIgeD0iMTE1IiB5PSIxNjUiIHdpZHRoPSI3MCIgaGVpZ2h0PSI4NSIgcng9IjUiLz48L3N2Zz4='">
            <div class="item-info">
                <span class="item-name">${escapeHtml(title)}</span>
                <span class="item-sub">${escapeHtml(sub)}</span>
            </div>
            <div class="item-stats">
                <span class="item-playtime">${formatPlaytime(item.playtime)}</span>
                <span class="item-views">${item.plays} plays</span>
            </div>
        `;
        
        // Add play button
        if (type === 'tracks') {
            const playBtn = document.createElement('button');
            playBtn.className = 'inline-play-btn';
            playBtn.textContent = '▶';
            playBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                playTrackFromListing(item.track_name, item.artist_name, item.album_name, imgUrl, item.playtime, item.track_id, item.album_id);
            });
            li.appendChild(playBtn);
        }
        if (type === 'albums' && item.album_id) {
            const playBtn = document.createElement('button');
            playBtn.className = 'inline-play-btn';
            playBtn.textContent = '▶';
            playBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                playAlbumFromCover(item.album_id, item.album_name);
            });
            li.appendChild(playBtn);
        }
        if (type === 'artists' && item.artist_id) {
            const playBtn = document.createElement('button');
            playBtn.className = 'inline-play-btn';
            playBtn.textContent = '▶';
            playBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                playArtistTopTracks(item.artist_id, item.artist_name);
            });
            li.appendChild(playBtn);
        }
        
        listEl.appendChild(li);
    });
}

async function fetchList(type, filter) {
    const res = await fetch(`/api/stats/top-${type}?filter=${filter}`);
    const data = await res.json();
    renderListItems(data, `top-${type}-list`, type);
}

// ── Now Playing ──
let nowPlayingInterval = null;

async function fetchNowPlaying() {
    try {
        const res = await fetch('/api/stats/now-playing');
        const data = await res.json();
        const section = document.getElementById('now-playing-section');
        if (data && data.track_name) {
            section.classList.remove('hidden');
            document.getElementById('now-playing-track').textContent = data.track_name;
            document.getElementById('now-playing-artist').textContent = `${data.artist_name} • ${data.album_name}`;
        } else {
            section.classList.add('hidden');
        }
    } catch (e) {
        // ignore
    }
}

// ── Timeline ──
let timelinePage = 0;
let timelineLoading = false;
let timelineHasMore = true;

async function loadTimeline(reset) {
    if (reset) {
        timelinePage = 0;
        timelineHasMore = true;
        document.getElementById('timeline-feed').innerHTML = '';
    }
    if (timelineLoading || !timelineHasMore) return;
    timelineLoading = true;
    const loader = document.getElementById('timeline-loader');
    loader.classList.remove('hidden');

    try {
        timelinePage++;
        const res = await fetch(`/api/stats/history?page=${timelinePage}&limit=30`);
        const data = await res.json();
        const feed = document.getElementById('timeline-feed');

        if (data.data.length === 0 || data.page >= data.total_pages) {
            timelineHasMore = false;
        }

        let currentDate = '';
        data.data.forEach(item => {
            const dateLabel = formatDate(item.timestamp);
            if (dateLabel !== currentDate) {
                currentDate = dateLabel;
                const divider = document.createElement('div');
                divider.className = 'timeline-date';
                divider.textContent = dateLabel;
                feed.appendChild(divider);
            }

            const entry = document.createElement('div');
            entry.className = 'timeline-entry';
            const imgUrl = getCoverArtUrl(item.album_id || item.track_id);
            const isPlay = item.event_type === 'play';

            entry.innerHTML = `
                <div class="timeline-dot ${isPlay ? 'play' : 'view'}"></div>
                <img src="${imgUrl}" class="cover-art timeline-cover" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIiB2aWV3Qm94PSIwIDAgMzAwIDMwMCI+PHJlY3QgZmlsbD0iIzJhMmEyYSIgd2lkdGg9IjMwMCIgaGVpZ2h0PSIzMDAiLz48Y2lyY2xlIGZpbGw9IiM0NDQiIGN4PSIxNTAiIGN5PSIxMzAiIHI9IjM1Ii8+PHJlY3QgZmlsbD0iIzQ0NCIgeD0iMTE1IiB5PSIxNjUiIHdpZHRoPSI3MCIgaGVpZ2h0PSI4NSIgcng9IjUiLz48L3N2Zz4='">
                <div class="timeline-info">
                    <span class="timeline-track">${escapeHtml(item.track_name)}</span>
                    <span class="timeline-artist">${escapeHtml(item.artist_name)} • ${escapeHtml(item.album_name)}</span>
                </div>
                <div class="timeline-meta">
                    <span class="timeline-time">${formatTime(item.timestamp)}</span>
                    <span class="timeline-badge ${isPlay ? 'play' : 'view'}">${isPlay ? 'Play' : 'View'}</span>
                </div>
            `;
            feed.appendChild(entry);
        });
    } catch (e) {
        console.error('Timeline error:', e);
    }

    loader.classList.add('hidden');
    timelineLoading = false;
}

const timelineFeed = document.getElementById('timeline-feed');
if (timelineFeed) {
    timelineFeed.addEventListener('scroll', () => {
        if (timelineFeed.scrollTop + timelineFeed.clientHeight >= timelineFeed.scrollHeight - 200) {
            loadTimeline(false);
        }
    });

    let timelineScrollTimeout = null;
    window.addEventListener('scroll', () => {
        if (document.getElementById('tab-timeline').classList.contains('active')) {
            clearTimeout(timelineScrollTimeout);
            timelineScrollTimeout = setTimeout(() => {
                if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 400) {
                    loadTimeline(false);
                }
            }, 200);
        }
    });
}

// ── Insights ──
let currentTimeFilter = 'all';

async function loadInsights() {
    try {
        await Promise.all([
            loadUniqueCounts(),
            loadStreaks(),
            loadHeatmap(),
            loadHourlyChart(),
            loadDayOfWeekChart(),
            loadGrowthChart(),
            loadGenreChart()
        ]);
    } catch (e) {
        console.error('Insights error:', e);
    }
}

async function loadUniqueCounts() {
    const res = await fetch('/api/stats/unique-counts');
    const data = await res.json();
    document.getElementById('unique-artists').textContent = (data.artists || 0).toLocaleString();
    document.getElementById('unique-albums').textContent = (data.albums || 0).toLocaleString();
    document.getElementById('unique-tracks').textContent = (data.tracks || 0).toLocaleString();
    document.getElementById('total-scrobbles').textContent = (data.total || 0).toLocaleString();
}

async function loadStreaks() {
    const res = await fetch('/api/stats/streaks');
    const data = await res.json();
    animateNumber('current-streak', data.current || 0);
    animateNumber('longest-streak', data.longest || 0);
    animateNumber('active-days', data.total_active_days || 0);
}

async function loadHeatmap() {
    const container = document.getElementById('heatmap-container');
    if (!container) return;
    const res = await fetch('/api/stats/heatmap?days=365');
    const data = await res.json();
    
    const map = {};
    let maxPlays = 0;
    data.forEach(d => { map[d.day] = d.plays; if (d.plays > maxPlays) maxPlays = d.plays; });

    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 364);
    startDate.setDate(startDate.getDate() - startDate.getDay());

    container.innerHTML = '';
    const months = [];
    let currentMonth = -1;
    for (let d = new Date(startDate); d <= now || months.length < 12; d.setDate(d.getDate() + 7)) {
        const month = d.getMonth();
        if (month !== currentMonth) {
            months.push({ label: d.toLocaleDateString('en-US', { month: 'short' }), index: Math.floor((d - startDate) / 7 / 4) });
            currentMonth = month;
        }
    }

    const monthLabels = document.createElement('div');
    monthLabels.className = 'heatmap-months';
    const monthTracker = [];
    let lastMonth = -1;
    for (let d = new Date(startDate), col = 0; d <= now; d.setDate(d.getDate() + 7), col++) {
        const m = d.getMonth();
        if (m !== lastMonth) {
            monthTracker.push({ label: d.toLocaleDateString('en-US', { month: 'short' }), col });
            lastMonth = m;
        }
    }
    monthTracker.forEach((m, i) => {
        const span = document.createElement('span');
        span.textContent = m.label;
        span.style.gridColumn = m.col + 1;
        if (i < monthTracker.length - 1) span.style.gridColumnEnd = monthTracker[i + 1].col + 1;
        monthLabels.appendChild(span);
    });
    container.appendChild(monthLabels);

    const grid = document.createElement('div');
    grid.className = 'heatmap-grid';

    const dayNames = ['Sun', 'Mon', '', 'Wed', '', 'Fri', ''];
    dayNames.forEach((name, idx) => {
        const dayLabel = document.createElement('div');
        dayLabel.className = 'heatmap-day-label';
        dayLabel.textContent = name;
        dayLabel.style.gridRow = idx + 2;
        grid.appendChild(dayLabel);
    });

    for (let d = new Date(startDate); d <= now; d.setDate(d.getDate() + 1)) {
        const dayStr = d.toISOString().split('T')[0];
        const count = map[dayStr] || 0;
        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';
        const level = count === 0 ? 0 : Math.ceil((count / maxPlays) * 4);
        cell.classList.add(`l${level}`);
        cell.title = `${dayStr}: ${count} plays`;
        const dow = d.getDay();
        const col = Math.floor((d - startDate) / (7 * 86400000));
        cell.style.gridColumn = col + 1;
        cell.style.gridRow = dow + 2;
        grid.appendChild(cell);
    }
    container.appendChild(grid);
}

async function loadHourlyChart() {
    const canvas = document.getElementById('hourlyChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (hourlyChartInstance) hourlyChartInstance.destroy();

    const res = await fetch(`/api/stats/hourly?filter=${currentTimeFilter}`);
    const data = await res.json();
    const labels = data.map(d => `${d.hour}:00`);
    const values = data.map(d => d.plays);

    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, '#30d158');
    gradient.addColorStop(1, 'rgba(48,209,88,0.1)');

    const cc = getChartColors();
    hourlyChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Plays',
                data: values,
                backgroundColor: gradient,
                borderRadius: 4,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: cc.grid }, ticks: { color: cc.tick, stepSize: 1 } },
                x: { grid: { display: false }, ticks: { color: cc.tick, maxRotation: 0, font: { size: 10 } } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

async function loadDayOfWeekChart() {
    const canvas = document.getElementById('dayOfWeekChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (dayOfWeekChartInstance) dayOfWeekChartInstance.destroy();

    const res = await fetch(`/api/stats/day-of-week?filter=${currentTimeFilter}`);
    const data = await res.json();
    const labels = data.map(d => d.day_name);
    const values = data.map(d => d.plays);

    const colors = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#9775fa', '#f783ac'];
    const bgColors = data.map((_, i) => {
        const c = colors[i % colors.length];
        return c + '33';
    });
    const borderColors = data.map((_, i) => colors[i % colors.length]);

    const cc = getChartColors();
    dayOfWeekChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: bgColors,
                borderColor: borderColors,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: cc.legend, boxWidth: 12, padding: 8, font: { size: 11 } }
                }
            }
        }
    });
}

async function loadGrowthChart() {
    const canvas = document.getElementById('growthChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (growthChartInstance) growthChartInstance.destroy();

    const res = await fetch('/api/stats/growth');
    const data = await res.json();
    const labels = data.map(d => d.month);
    const plays = data.map(d => d.plays);
    const cumulative = data.map(d => d.cumulative);

    const cc = getChartColors();
    growthChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Monthly Plays',
                    data: plays,
                    borderColor: '#fa233b',
                    backgroundColor: 'rgba(250,35,59,0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2,
                    borderWidth: 2,
                    yAxisID: 'y'
                },
                {
                    label: 'Total',
                    data: cumulative,
                    borderColor: '#0a84ff',
                    backgroundColor: 'rgba(10,132,255,0.05)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 2,
                    borderDash: [5, 5],
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: cc.grid }, ticks: { color: cc.tick, stepSize: 1 }, position: 'left' },
                y1: { beginAtZero: true, grid: { display: false }, ticks: { color: cc.tick }, position: 'right' },
                x: { grid: { display: false }, ticks: { color: cc.tick, font: { size: 9 }, maxRotation: 45 } }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: cc.legend, boxWidth: 12, font: { size: 10 } }
                }
            }
        }
    });
}

async function loadGenreChart() {
    const canvas = document.getElementById('genreChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (genreChartInstance) genreChartInstance.destroy();

    const res = await fetch(`/api/stats/top-genres?filter=${currentTimeFilter}`);
    const data = await res.json();
    if (data.length === 0) {
        const parent = canvas.parentElement;
        parent.innerHTML = '<div class="empty-state">No genre data available yet.</div>';
        return;
    }
    const labels = data.slice(0, 10).map(d => d.genre || 'Unknown');
    const values = data.slice(0, 10).map(d => d.plays);

    const genreColors = ['#fa233b', '#0a84ff', '#30d158', '#ff9f0a', '#bf5af2', '#ff6482', '#5e5ce6', '#ffd60a', '#64d2ff', '#ff375f'];
    const bgColors = labels.map((_, i) => genreColors[i % genreColors.length] + '33');
    const bColors = labels.map((_, i) => genreColors[i % genreColors.length]);

    const cc = getChartColors();
    genreChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Plays',
                data: values,
                backgroundColor: bgColors,
                borderColor: bColors,
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { beginAtZero: true, grid: { color: cc.grid }, ticks: { color: cc.tick, stepSize: 1 } },
                y: { grid: { display: false }, ticks: { color: cc.yTick, font: { size: 10 } } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

// ── History Table ──
let historyPage = 1;
let historySearchTerm = '';
let historyTypeFilter = 'all';
let historyTimer = null;

async function loadHistoryTable(page) {
    if (page) historyPage = page;
    const loader = document.getElementById('history-loader');
    const tbody = document.getElementById('history-body');
    const pagination = document.getElementById('history-pagination');
    if (loader) loader.classList.remove('hidden');

    try {
        let url = `/api/stats/history?page=${historyPage}&limit=50`;
        if (historySearchTerm) url += `&q=${encodeURIComponent(historySearchTerm)}`;
        if (historyTypeFilter !== 'all') url += `&type=${historyTypeFilter}`;

        const res = await fetch(url);
        const data = await res.json();
        if (!tbody) return;

        tbody.innerHTML = '';
        data.data.forEach(item => {
            const tr = document.createElement('tr');
            const isPlay = item.event_type === 'play';
            tr.innerHTML = `
                <td>${formatDate(item.timestamp)} ${formatTime(item.timestamp)}</td>
                <td class="cell-track">${escapeHtml(item.track_name)}</td>
                <td>${escapeHtml(item.artist_name)}</td>
                <td>${escapeHtml(item.album_name)}</td>
                <td><span class="type-badge ${isPlay ? 'play' : 'view'}">${isPlay ? 'Play' : 'View'}</span></td>
                <td>${formatPlaytime(item.duration)}</td>
            `;
            tbody.appendChild(tr);
        });

        if (data.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No history found.</td></tr>';
        }

        if (pagination) {
            pagination.innerHTML = '';
            if (data.total_pages > 1) {
                if (data.page > 1) {
                    const prev = document.createElement('button');
                    prev.className = 'page-btn';
                    prev.textContent = '← Prev';
                    prev.addEventListener('click', () => loadHistoryTable(data.page - 1));
                    pagination.appendChild(prev);
                }
                const span = document.createElement('span');
                span.className = 'page-info';
                span.textContent = `Page ${data.page} of ${data.total_pages} (${data.total} records)`;
                pagination.appendChild(span);
                if (data.page < data.total_pages) {
                    const next = document.createElement('button');
                    next.className = 'page-btn';
                    next.textContent = 'Next →';
                    next.addEventListener('click', () => loadHistoryTable(data.page + 1));
                    pagination.appendChild(next);
                }
            }
        }
    } catch (e) {
        console.error('History error:', e);
    }
    if (loader) loader.classList.add('hidden');
}

document.getElementById('history-search')?.addEventListener('input', (e) => {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => {
        historySearchTerm = e.target.value;
        historyPage = 1;
        loadHistoryTable();
    }, 300);
});

document.getElementById('history-type-filter')?.addEventListener('change', (e) => {
    historyTypeFilter = e.target.value;
    historyPage = 1;
    loadHistoryTable();
});

// ── Library Browser ──
let libraryTab = 'artists';
let libraryPage = 1;
let librarySearchTerm = '';
let libraryTimer = null;

document.querySelectorAll('.library-tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.library-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        libraryTab = btn.dataset.libtab;
        libraryPage = 1;
        loadLibrary();
    });
});

document.getElementById('library-search')?.addEventListener('input', (e) => {
    clearTimeout(libraryTimer);
    libraryTimer = setTimeout(() => {
        librarySearchTerm = e.target.value;
        libraryPage = 1;
        loadLibrary();
    }, 300);
});

async function loadLibrary(page) {
    if (page) libraryPage = page;
    const grid = document.getElementById('library-grid');
    const pagination = document.getElementById('library-pagination');
    const loader = document.getElementById('library-loader');
    if (loader) loader.classList.remove('hidden');

    try {
        let url = `/api/stats/library?tab=${libraryTab}&page=${libraryPage}&limit=60`;
        if (librarySearchTerm) url += `&q=${encodeURIComponent(librarySearchTerm)}`;

        const res = await fetch(url);
        const data = await res.json();
        if (!grid) return;

        grid.innerHTML = '';

        data.data.forEach(item => {
            const card = document.createElement('div');
            card.className = 'library-card';

            if (libraryTab === 'artists') {
                card.innerHTML = `
                    <img src="${getCoverArtUrl(item.artist_id)}" class="library-card-img round" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIiB2aWV3Qm94PSIwIDAgMzAwIDMwMCI+PHJlY3QgZmlsbD0iIzJhMmEyYSIgd2lkdGg9IjMwMCIgaGVpZ2h0PSIzMDAiLz48Y2lyY2xlIGZpbGw9IiM0NDQiIGN4PSIxNTAiIGN5PSIxMzAiIHI9IjM1Ii8+PHJlY3QgZmlsbD0iIzQ0NCIgeD0iMTE1IiB5PSIxNjUiIHdpZHRoPSI3MCIgaGVpZ2h0PSI4NSIgcng9IjUiLz48L3N2Zz4='">
                    <span class="library-card-name">${escapeHtml(item.artist_name)}</span>
                    <span class="library-card-sub">${item.plays} plays</span>
                `;
                card.addEventListener('click', () => openArtistModal(item.artist_name, 'all'));
                if (item.artist_id) {
                    const playBtn = document.createElement('button');
                    playBtn.className = 'inline-play-btn';
                    playBtn.textContent = '▶';
                    playBtn.style.opacity = '1';
                    playBtn.style.position = 'absolute';
                    playBtn.style.bottom = '8px';
                    playBtn.style.right = '8px';
                    playBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        playArtistTopTracks(item.artist_id, item.artist_name);
                    });
                    card.style.position = 'relative';
                    card.appendChild(playBtn);
                }
            } else if (libraryTab === 'albums') {
                card.innerHTML = `
                    <img src="${getCoverArtUrl(item.album_id)}" class="library-card-img" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIiB2aWV3Qm94PSIwIDAgMzAwIDMwMCI+PHJlY3QgZmlsbD0iIzJhMmEyYSIgd2lkdGg9IjMwMCIgaGVpZ2h0PSIzMDAiLz48Y2lyY2xlIGZpbGw9IiM0NDQiIGN4PSIxNTAiIGN5PSIxMzAiIHI9IjM1Ii8+PHJlY3QgZmlsbD0iIzQ0NCIgeD0iMTE1IiB5PSIxNjUiIHdpZHRoPSI3MCIgaGVpZ2h0PSI4NSIgcng9IjUiLz48L3N2Zz4='">
                    <span class="library-card-name">${escapeHtml(item.album_name)}</span>
                    <span class="library-card-sub">${escapeHtml(item.artist_name)} • ${item.plays} plays</span>
                `;
                card.addEventListener('click', () => openAlbumModal(item.album_name));
                if (item.album_id) {
                    const playBtn = document.createElement('button');
                    playBtn.className = 'inline-play-btn';
                    playBtn.textContent = '▶';
                    playBtn.style.opacity = '1';
                    playBtn.style.position = 'absolute';
                    playBtn.style.bottom = '8px';
                    playBtn.style.right = '8px';
                    playBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        playAlbumFromCover(item.album_id, item.album_name);
                    });
                    card.style.position = 'relative';
                    card.appendChild(playBtn);
                }
            } else {
                card.innerHTML = `
                    <img src="${getCoverArtUrl(item.album_id || item.track_id)}" class="library-card-img" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIiB2aWV3Qm94PSIwIDAgMzAwIDMwMCI+PHJlY3QgZmlsbD0iIzJhMmEyYSIgd2lkdGg9IjMwMCIgaGVpZ2h0PSIzMDAiLz48Y2lyY2xlIGZpbGw9IiM0NDQiIGN4PSIxNTAiIGN5PSIxMzAiIHI9IjM1Ii8+PHJlY3QgZmlsbD0iIzQ0NCIgeD0iMTE1IiB5PSIxNjUiIHdpZHRoPSI3MCIgaGVpZ2h0PSI4NSIgcng9IjUiLz48L3N2Zz4='">
                    <span class="library-card-name">${escapeHtml(item.track_name)}</span>
                    <span class="library-card-sub">${escapeHtml(item.artist_name)} • ${escapeHtml(item.album_name)}</span>
                `;
                if (item.track_id) {
                    const playBtn = document.createElement('button');
                    playBtn.className = 'inline-play-btn';
                    playBtn.textContent = '▶';
                    playBtn.style.opacity = '1';
                    playBtn.style.position = 'absolute';
                    playBtn.style.bottom = '8px';
                    playBtn.style.right = '8px';
                    playBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        playTrackFromListing(item.track_name, item.artist_name, item.album_name, getCoverArtUrl(item.album_id || item.track_id), item.playtime, item.track_id, item.album_id);
                    });
                    card.style.position = 'relative';
                    card.appendChild(playBtn);
                }
            }
            grid.appendChild(card);
        });

        if (data.data.length === 0) {
            grid.innerHTML = '<div class="empty-state">Nothing found.</div>';
        }

        if (pagination) {
            pagination.innerHTML = '';
            const totalPages = Math.ceil(data.total / data.limit);
            if (totalPages > 1) {
                if (data.page > 1) {
                    const prev = document.createElement('button');
                    prev.className = 'page-btn';
                    prev.textContent = '← Prev';
                    prev.addEventListener('click', () => loadLibrary(data.page - 1));
                    pagination.appendChild(prev);
                }
                const span = document.createElement('span');
                span.className = 'page-info';
                span.textContent = `Page ${data.page} of ${totalPages}`;
                pagination.appendChild(span);
                if (data.page < totalPages) {
                    const next = document.createElement('button');
                    next.className = 'page-btn';
                    next.textContent = 'Next →';
                    next.addEventListener('click', () => loadLibrary(data.page + 1));
                    pagination.appendChild(next);
                }
            }
        }
    } catch (e) {
        console.error('Library error:', e);
    }
    if (loader) loader.classList.add('hidden');
}

// ── Search ──
const searchInput = document.getElementById('search-input');
const closeSearchBtn = document.getElementById('close-search-btn');
const mainDashboard = document.getElementById('main-dashboard');
const searchOverlay = document.getElementById('search-results-overlay');

let searchTimeout = null;

async function performSearch() {
    const query = searchInput.value.trim();
    if (!query) { closeSearch(); return; }
    
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    searchOverlay.classList.remove('hidden');
    closeSearchBtn.classList.remove('hidden');
    
    const res = await fetch(`/api/stats/search?q=${encodeURIComponent(query)}&filter=${currentTimeFilter}`);
    const data = await res.json();
    
    renderListItems(data.tracks, 'search-tracks-list', 'tracks');
    renderListItems(data.albums, 'search-albums-list', 'albums');
    renderListItems(data.artists, 'search-artists-list', 'artists');
}

function closeSearch() {
    searchInput.value = '';
    searchOverlay.classList.add('hidden');
    closeSearchBtn.classList.add('hidden');
}

searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(performSearch, 300);
});

closeSearchBtn.addEventListener('click', closeSearch);

// ── Artist Modal ──
const modal = document.getElementById('artist-modal');
const closeModalBtn = document.getElementById('close-modal');

closeModalBtn.addEventListener('click', () => modal.classList.remove('active'));
modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });

async function openArtistModal(artistName, filter) {
    modal.classList.add('active');
    
    document.getElementById('modal-artist-name').innerText = artistName;
    document.getElementById('modal-artist-plays').innerText = 'Loading...';
    document.getElementById('modal-artist-playtime').innerText = '';
    document.getElementById('modal-top-tracks').innerHTML = '';
    document.getElementById('modal-top-albums').innerHTML = '';
    
    try {
        const res = await fetch(`/api/stats/artist/${encodeURIComponent(artistName)}?filter=${filter}`);
        const data = await res.json();
        
        document.getElementById('modal-artist-image').src = getCoverArtUrl(data.summary.artist_id);
        document.getElementById('modal-artist-plays').innerText = `${data.summary.plays || 0} plays`;
        document.getElementById('modal-artist-playtime').innerText = formatPlaytime(data.summary.playtime);
        
        const tracksList = document.getElementById('modal-top-tracks');
        data.top_tracks.forEach(item => {
            const li = document.createElement('li');
            li.innerHTML = `
                <img src="${getCoverArtUrl(item.album_id || item.track_id)}" class="cover-art" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIiB2aWV3Qm94PSIwIDAgMzAwIDMwMCI+PHJlY3QgZmlsbD0iIzJhMmEyYSIgd2lkdGg9IjMwMCIgaGVpZ2h0PSIzMDAiLz48Y2lyY2xlIGZpbGw9IiM0NDQiIGN4PSIxNTAiIGN5PSIxMzAiIHI9IjM1Ii8+PHJlY3QgZmlsbD0iIzQ0NCIgeD0iMTE1IiB5PSIxNjUiIHdpZHRoPSI3MCIgaGVpZ2h0PSI4NSIgcng9IjUiLz48L3N2Zz4='">
                <div class="item-info">
                    <span class="item-name">${escapeHtml(item.track_name)}</span>
                    <span class="item-sub">${item.views} views</span>
                </div>
                <div class="item-stats">
                    <span class="item-playtime">${formatPlaytime(item.playtime)}</span>
                </div>
            `;
            tracksList.appendChild(li);
        });

        const albumsList = document.getElementById('modal-top-albums');
        data.top_albums.forEach(item => {
            const li = document.createElement('li');
            li.innerHTML = `
                <img src="${getCoverArtUrl(item.album_id)}" class="cover-art" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIiB2aWV3Qm94PSIwIDAgMzAwIDMwMCI+PHJlY3QgZmlsbD0iIzJhMmEyYSIgd2lkdGg9IjMwMCIgaGVpZ2h0PSIzMDAiLz48Y2lyY2xlIGZpbGw9IiM0NDQiIGN4PSIxNTAiIGN5PSIxMzAiIHI9IjM1Ii8+PHJlY3QgZmlsbD0iIzQ0NCIgeD0iMTE1IiB5PSIxNjUiIHdpZHRoPSI3MCIgaGVpZ2h0PSI4NSIgcng9IjUiLz48L3N2Zz4='">
                <div class="item-info">
                    <span class="item-name">${escapeHtml(item.album_name)}</span>
                    <span class="item-sub">${item.plays} plays</span>
                </div>
                <div class="item-stats">
                    <span class="item-playtime">${formatPlaytime(item.playtime)}</span>
                </div>
            `;
            albumsList.appendChild(li);
        });
    } catch (e) {
        console.error('Failed to load artist data:', e);
    }
}

// ── Album Modal ──
const albumModal = document.getElementById('album-modal');
const closeAlbumBtn = document.getElementById('close-album-modal');

closeAlbumBtn.addEventListener('click', () => albumModal.classList.remove('active'));
albumModal.addEventListener('click', (e) => { if (e.target === albumModal) albumModal.classList.remove('active'); });

async function openAlbumModal(albumName) {
    albumModal.classList.add('active');
    
    document.getElementById('modal-album-name').innerText = albumName;
    document.getElementById('modal-album-artist').innerText = '';
    document.getElementById('modal-album-plays').innerText = 'Loading...';
    document.getElementById('modal-album-playtime').innerText = '';
    document.getElementById('modal-album-tracks').innerHTML = '';
    
    try {
        const res = await fetch(`/api/stats/album/${encodeURIComponent(albumName)}`);
        const data = await res.json();
        
        document.getElementById('modal-album-image').src = getCoverArtUrl(data.summary.album_id);
        document.getElementById('modal-album-artist').innerText = data.summary.artist_name || '';
        document.getElementById('modal-album-plays').innerText = `${data.summary.plays || 0} plays`;
        document.getElementById('modal-album-playtime').innerText = formatPlaytime(data.summary.playtime);
        
        const tracksList = document.getElementById('modal-album-tracks');
        data.tracks.forEach(item => {
            const li = document.createElement('li');
            li.innerHTML = `
                <div class="item-info">
                    <span class="item-name">${escapeHtml(item.track_name)}</span>
                    <span class="item-sub">${item.views} views</span>
                </div>
                <div class="item-stats">
                    <span class="item-playtime">${formatPlaytime(item.playtime)}</span>
                    <span class="item-views">${item.plays} plays</span>
                </div>
            `;
            tracksList.appendChild(li);
        });
    } catch (e) {
        console.error('Failed to load album data:', e);
    }
}

// ── Export/Import ──
document.getElementById('export-btn').addEventListener('click', async () => {
    try {
        const response = await fetch('/api/export');
        if (!response.ok) throw new Error('Export failed');
        const data = await response.json();
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `viniz-export-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(`Exported ${data.length} records`, 'success');
    } catch (e) {
        showToast('Export failed: ' + e.message, 'error');
    }
});

const importBtn = document.getElementById('import-btn');
const importFile = document.getElementById('import-file');

importBtn.addEventListener('click', () => importFile.click());

importFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const data = JSON.parse(event.target.result);
            if (!Array.isArray(data)) throw new Error('Invalid format. Expected JSON array.');

            importBtn.innerText = 'Importing...';
            importBtn.disabled = true;

            const response = await fetch('/api/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Import failed');
            }

            showToast(`Imported ${data.length} records!`, 'success');
            setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
            showToast('Import failed: ' + err.message, 'error');
        } finally {
            importBtn.innerText = 'Import';
            importBtn.disabled = false;
            importFile.value = '';
        }
    };
    reader.readAsText(file);
});

// ── Settings ──
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings');
const utcOffsetSelect = document.getElementById('utc-offset-select');
const saveSettingsBtn = document.getElementById('save-settings');

function buildUtcOffsetOptions() {
    const browserOffset = -new Date().getTimezoneOffset() / 60;
    utcOffsetSelect.innerHTML = '';
    for (let i = -12; i <= 14; i += 0.5) {
        const opt = document.createElement('option');
        opt.value = i;
        const sign = i >= 0 ? '+' : '';
        const label = i % 1 === 0 ? `${i}:00` : `${Math.floor(i)}:30`;
        opt.textContent = `UTC${sign}${label}${Math.abs(i - browserOffset) < 0.01 ? ' (Your timezone)' : ''}${Math.abs(i - 5.5) < 0.01 ? ' (IST)' : ''}`;
        utcOffsetSelect.appendChild(opt);
    }
}

settingsBtn.addEventListener('click', async () => {
    buildUtcOffsetOptions();
    try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        utcOffsetSelect.value = String(data.utc_offset);
    } catch (e) {
        utcOffsetSelect.value = '5.5';
    }
    settingsModal.classList.add('active');
});

closeSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('active');
});

settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.classList.remove('active');
});

saveSettingsBtn.addEventListener('click', async () => {
    const utc_offset = parseFloat(utcOffsetSelect.value);
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ utc_offset })
        });
        const data = await res.json();
        if (data.status === 'ok') {
            showToast('Settings saved', 'success');
            settingsModal.classList.remove('active');
        }
    } catch (e) {
        showToast('Failed to save settings', 'error');
    }
});

// ── Initial Load ──
initTheme();
initPlayer();
registerSW();
initMobileNav();
initSwipeNavigation();
initScrollReveal();
fetchSummary(currentTimeFilter);
fetchChartData();
fetchList('tracks', currentTimeFilter);
fetchList('albums', currentTimeFilter);
fetchList('artists', currentTimeFilter);
fetchNowPlaying();
nowPlayingInterval = setInterval(fetchNowPlaying, 15000);
loadTimeline(true);

// Sync expanded player info with mini player
setInterval(() => {
  const p = player;
  if (!p || !p.currentTrack || !p.isPlaying) return;
  const track = p.currentTrack;
  document.getElementById('player-track-name-expanded') && (
    document.getElementById('player-track-name-expanded').textContent = track.track_name || ''
  );
  document.getElementById('player-artist-name-expanded') && (
    document.getElementById('player-artist-name-expanded').textContent = `${track.artist_name || ''} • ${track.album_name || ''}`
  );
  document.getElementById('player-current-time-expanded') && (
    document.getElementById('player-current-time-expanded').textContent = p._formatTime(p.audio.currentTime)
  );
  document.getElementById('player-duration-expanded') && (
    document.getElementById('player-duration-expanded').textContent = p._formatTime(track.duration || p.audio.duration)
  );
  const fillExp = document.getElementById('player-progress-fill-expanded');
  if (fillExp) {
    const pct = p.audio.duration ? (p.audio.currentTime / p.audio.duration) * 100 : 0;
    fillExp.style.width = pct + '%';
  }
  const coverExp = document.getElementById('player-cover-expanded');
  if (coverExp && coverExp.src !== document.getElementById('player-cover')?.src) {
    coverExp.src = document.getElementById('player-cover')?.src || '';
  }
}, 500);

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

function initScrollReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
  }, { threshold: 0.1 });
  document.querySelectorAll('.scroll-reveal').forEach(el => observer.observe(el));
}

// ── Mobile Bottom Nav ──
function initMobileNav() {
  document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.mtab;
      switchTab(tab);
    });
  });
}

// ── Swipe Navigation ──
function initSwipeNavigation() {
  let touchStartX = 0, touchStartY = 0;
  const tabOrder = ['dashboard', 'discover', 'insights', 'library', 'year'];
  
  document.addEventListener('touchstart', (e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select') || 
        e.target.closest('.modal-overlay') || e.target.closest('#player-bar')) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (!touchStartX) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) < Math.abs(dy) || Math.abs(dx) < 60) { touchStartX = 0; return; }
    
    const current = tabOrder.findIndex(t => document.getElementById(`tab-${t}`).classList.contains('active'));
    if (dx < -60 && current < tabOrder.length - 1) {
      switchTab(tabOrder[current + 1]);
    } else if (dx > 60 && current > 0) {
      switchTab(tabOrder[current - 1]);
    }
    touchStartX = 0;
  }, { passive: true });
}

function switchTab(tabName) {
  // Desktop tabs
  tabBtns.forEach(b => {
    b.classList.remove('active');
    if (b.dataset.tab === tabName) b.classList.add('active');
  });
  
  // Mobile nav
  document.querySelectorAll('.mobile-nav-btn').forEach(b => {
    b.classList.remove('active');
    if (b.dataset.mtab === tabName) b.classList.add('active');
  });
  
  // Panels
  Object.values(tabPanels).forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(`tab-${tabName}`);
  if (panel) panel.classList.add('active');
  
  // Close search if open
  closeSearch();
  
  // Load tab content
  if (tabName === 'insights') loadInsights();
  if (tabName === 'timeline') loadTimeline(true);
  if (tabName === 'history') loadHistoryTable();
  if (tabName === 'library') loadLibrary();
  if (tabName === 'discover') loadDiscoverTab();
  if (tabName === 'year') loadYearTab();
}

// ── Discover Tab ──
async function loadDiscoverTab() {
  loadRecommendations();
  loadDiscoverTracks();
  loadAtThisHour();
}

async function loadRecommendations() {
  const grid = document.getElementById('for-you-grid');
  if (!grid) return;
  try {
    const res = await fetch('/api/recommendations/for-you');
    const data = await res.json();
    if (data.length === 0) {
      grid.innerHTML = '<div class="empty-state">Listen to more music to get recommendations!</div>';
      return;
    }
    grid.innerHTML = '';
    data.forEach(artist => {
      const card = document.createElement('div');
      card.className = 'discover-card';
      card.innerHTML = `
        <img src="${getCoverArtUrl(artist.artist_id)}" class="discover-card-img round" onerror="this.style.display='none'">
        <div class="discover-card-info">
          <span class="discover-card-name">${escapeHtml(artist.artist_name)}</span>
          <span class="discover-card-sub">${escapeHtml(artist.reason || '')}</span>
        </div>
        <button class="discover-card-play" title="Play top tracks">▶</button>
      `;
      card.addEventListener('click', () => openArtistModal(artist.artist_name, 'all'));
      card.querySelector('.discover-card-play').addEventListener('click', (e) => {
        e.stopPropagation();
        if (artist.artist_id) playArtistTopTracks(artist.artist_id, artist.artist_name);
      });
      grid.appendChild(card);
    });
  } catch (e) { console.error('Recommendations error:', e); }
}

async function loadDiscoverTracks() {
  const grid = document.getElementById('discover-tracks-grid');
  if (!grid) return;
  try {
    const res = await fetch('/api/recommendations/discover');
    const data = await res.json();
    if (data.length === 0) {
      grid.innerHTML = '<div class="empty-state">No undiscovered gems found. Keep listening!</div>';
      return;
    }
    grid.innerHTML = '';
    data.forEach(track => {
      const card = document.createElement('div');
      card.className = 'discover-card';
      card.innerHTML = `
        <img src="${track.cover_url || getCoverArtUrl(track.album_id || track.track_id)}" class="discover-card-img" onerror="this.style.display='none'">
        <div class="discover-card-info">
          <span class="discover-card-name">${escapeHtml(track.track_name)}</span>
          <span class="discover-card-sub">${escapeHtml(track.artist_name)} • ${escapeHtml(track.album_name)}</span>
        </div>
        <button class="discover-card-play" title="Play">▶</button>
      `;
      card.querySelector('.discover-card-play').addEventListener('click', (e) => {
        e.stopPropagation();
        playTrackFromListing(track.track_name, track.artist_name, track.album_name, track.cover_url, track.duration, track.track_id, track.album_id);
      });
      grid.appendChild(card);
    });
  } catch (e) { console.error('Discover error:', e); }
}

async function loadAtThisHour() {
  const grid = document.getElementById('at-hour-grid');
  if (!grid) return;
  try {
    const res = await fetch('/api/recommendations/at-this-hour');
    const data = await res.json();
    if (!data.tracks || data.tracks.length === 0) {
      grid.innerHTML = '<div class="empty-state">No listening data for this hour yet.</div>';
      return;
    }
    grid.innerHTML = '';
    data.tracks.forEach(track => {
      const card = document.createElement('div');
      card.className = 'discover-card';
      card.innerHTML = `
        <img src="${getCoverArtUrl(track.album_id || track.track_id)}" class="discover-card-img" onerror="this.style.display='none'">
        <div class="discover-card-info">
          <span class="discover-card-name">${escapeHtml(track.track_name)}</span>
          <span class="discover-card-sub">${escapeHtml(track.artist_name)}</span>
          <span class="discover-card-meta">${track.play_count} plays at this hour</span>
        </div>
        <button class="discover-card-play" title="Play">▶</button>
      `;
      card.querySelector('.discover-card-play').addEventListener('click', (e) => {
        e.stopPropagation();
        playTrackFromListing(track.track_name, track.artist_name, track.album_name, getCoverArtUrl(track.album_id || track.track_id), 0, track.track_id, track.album_id);
      });
      grid.appendChild(card);
    });
  } catch (e) { console.error('At hour error:', e); }
}

// ── Year in Review Tab ──
let currentYear = new Date().getFullYear();

async function loadYearTab() {
  try {
    const yearsRes = await fetch('/api/stats/years');
    const years = await yearsRes.json();
    const selector = document.getElementById('year-selector');
    if (selector) {
      selector.innerHTML = '';
      years.forEach(y => {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        if (y === currentYear) opt.selected = true;
        selector.appendChild(opt);
      });
      if (years.length === 0) {
        selector.innerHTML = '<option value="">No data yet</option>';
      }
    }
    if (years.length > 0) {
      currentYear = years[0];
      loadYearlyStats(currentYear);
    }
  } catch (e) { console.error('Years error:', e); }
}

document.getElementById('year-selector')?.addEventListener('change', (e) => {
  currentYear = parseInt(e.target.value);
  loadYearlyStats(currentYear);
});

async function loadYearlyStats(year) {
  const container = document.getElementById('yearly-content');
  if (!container) return;
  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><span>Crunching your stats...</span></div>';
  
  try {
    const res = await fetch(`/api/stats/yearly/${year}`);
    const data = await res.json();
    const s = data.summary;
    
    const totalMinutes = Math.round((s.total_playtime || 0) / 60);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    
    container.innerHTML = `
      <div class="yearly-hero">
        <h2>${year}</h2>
        <p class="yearly-subtitle">Your year in music</p>
      </div>
      
      <div class="yearly-stats-grid">
        <div class="yearly-stat-card">
          <div class="yearly-stat-value">${(s.total_plays || 0).toLocaleString()}</div>
          <div class="yearly-stat-label">Total Plays</div>
        </div>
        <div class="yearly-stat-card">
          <div class="yearly-stat-value">${hours}h ${mins}m</div>
          <div class="yearly-stat-label">Total Playtime</div>
        </div>
        <div class="yearly-stat-card">
          <div class="yearly-stat-value">${(s.unique_artists || 0).toLocaleString()}</div>
          <div class="yearly-stat-label">Artists Explored</div>
        </div>
        <div class="yearly-stat-card">
          <div class="yearly-stat-value">${(s.active_days || 0).toLocaleString()}</div>
          <div class="yearly-stat-label">Active Days</div>
        </div>
      </div>
      
      ${data.peak_month.month ? `
        <div class="yearly-stat-card" style="text-align:center;margin-bottom:1.5rem;padding:1.25rem">
          <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">Peak Month</div>
          <div style="font-size:1.4rem;font-weight:700;margin-top:0.25rem">${data.peak_month.month}</div>
          <div style="color:var(--text-dim);font-size:0.8rem">${data.peak_month.plays} plays • ${formatPlaytime(data.peak_month.playtime)}</div>
        </div>
      ` : ''}
      
      ${data.peak_day.day ? `
        <div class="yearly-stat-card" style="text-align:center;margin-bottom:1.5rem;padding:1.25rem">
          <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">Peak Day</div>
          <div style="font-size:1.2rem;font-weight:700;margin-top:0.25rem">${data.peak_day.day}</div>
          <div style="color:var(--text-dim);font-size:0.8rem">${data.peak_day.plays} plays</div>
        </div>
      ` : ''}
      
      <div class="yearly-section">
        <h3>Top Artists</h3>
        ${(data.top_artists || []).map((a, i) => `
          <div class="yearly-rank" onclick="openArtistModal('${escapeHtml(a.artist_name).replace(/'/g, "\\'")}', '${year}')">
            <span class="yearly-rank-pos">${i + 1}</span>
            <img src="${getCoverArtUrl(a.artist_id)}" class="yearly-rank-cover round" onerror="this.style.display='none'">
            <div class="yearly-rank-info">
              <span class="yearly-rank-name">${escapeHtml(a.artist_name)}</span>
            </div>
            <span class="yearly-rank-stat">${a.plays} plays • ${formatPlaytime(a.playtime)}</span>
          </div>
        `).join('')}
      </div>
      
      <div class="yearly-section">
        <h3>Top Songs</h3>
        ${(data.top_tracks || []).map((t, i) => `
          <div class="yearly-rank" onclick="playTrackFromListing('${escapeHtml(t.track_name).replace(/'/g, "\\'")}', '${escapeHtml(t.artist_name).replace(/'/g, "\\'")}', '', '${getCoverArtUrl(t.album_id || t.track_id)}', 0, '${t.track_id || ''}', '${t.album_id || ''}')">
            <span class="yearly-rank-pos">${i + 1}</span>
            <img src="${getCoverArtUrl(t.album_id || t.track_id)}" class="yearly-rank-cover" onerror="this.style.display='none'">
            <div class="yearly-rank-info">
              <span class="yearly-rank-name">${escapeHtml(t.track_name)}</span>
              <span class="yearly-rank-sub">${escapeHtml(t.artist_name)}</span>
            </div>
            <span class="yearly-rank-stat">${t.plays} plays • ${formatPlaytime(t.playtime)}</span>
          </div>
        `).join('')}
      </div>
      
      <div class="yearly-section">
        <h3>Top Albums</h3>
        ${(data.top_albums || []).map((a, i) => `
          <div class="yearly-rank" onclick="openAlbumModal('${escapeHtml(a.album_name).replace(/'/g, "\\'")}')">
            <span class="yearly-rank-pos">${i + 1}</span>
            <img src="${getCoverArtUrl(a.album_id)}" class="yearly-rank-cover" onerror="this.style.display='none'">
            <div class="yearly-rank-info">
              <span class="yearly-rank-name">${escapeHtml(a.album_name)}</span>
              <span class="yearly-rank-sub">${escapeHtml(a.artist_name)}</span>
            </div>
            <span class="yearly-rank-stat">${a.plays} plays • ${formatPlaytime(a.playtime)}</span>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    console.error('Yearly error:', e);
    container.innerHTML = '<div class="empty-state">Failed to load yearly stats.</div>';
  }
}
