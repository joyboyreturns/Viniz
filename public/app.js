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
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Object.values(tabPanels).forEach(p => p.classList.remove('active'));
        const tab = btn.dataset.tab;
        tabPanels[tab].classList.add('active');
        if (tab === 'insights') loadInsights();
        if (tab === 'timeline') loadTimeline();
        if (tab === 'history') loadHistoryTable();
        if (tab === 'library') loadLibrary();
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
            <img src="${imgUrl}" class="cover-art" onerror="this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='">
            <div class="item-info">
                <span class="item-name">${escapeHtml(title)}</span>
                <span class="item-sub">${escapeHtml(sub)}</span>
            </div>
            <div class="item-stats">
                <span class="item-playtime">${formatPlaytime(item.playtime)}</span>
                <span class="item-views">${item.plays} plays</span>
            </div>
        `;
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
                <img src="${imgUrl}" class="cover-art timeline-cover" onerror="this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='">
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
    timingLoading = false;
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
                    <img src="${getCoverArtUrl(item.artist_id)}" class="library-card-img round" onerror="this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='">
                    <span class="library-card-name">${escapeHtml(item.artist_name)}</span>
                    <span class="library-card-sub">${item.plays} plays</span>
                `;
                card.addEventListener('click', () => openArtistModal(item.artist_name, 'all'));
            } else if (libraryTab === 'albums') {
                card.innerHTML = `
                    <img src="${getCoverArtUrl(item.album_id)}" class="library-card-img" onerror="this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='">
                    <span class="library-card-name">${escapeHtml(item.album_name)}</span>
                    <span class="library-card-sub">${escapeHtml(item.artist_name)} • ${item.plays} plays</span>
                `;
                card.addEventListener('click', () => openAlbumModal(item.album_name));
            } else {
                card.innerHTML = `
                    <img src="${getCoverArtUrl(item.album_id || item.track_id)}" class="library-card-img" onerror="this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='">
                    <span class="library-card-name">${escapeHtml(item.track_name)}</span>
                    <span class="library-card-sub">${escapeHtml(item.artist_name)} • ${escapeHtml(item.album_name)}</span>
                `;
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
                <img src="${getCoverArtUrl(item.album_id || item.track_id)}" class="cover-art" onerror="this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='">
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
                <img src="${getCoverArtUrl(item.album_id)}" class="cover-art" onerror="this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='">
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

// ── Initial Load ──
initTheme();
fetchSummary(currentTimeFilter);
fetchChartData();
fetchList('tracks', currentTimeFilter);
fetchList('albums', currentTimeFilter);
fetchList('artists', currentTimeFilter);
fetchNowPlaying();
nowPlayingInterval = setInterval(fetchNowPlaying, 15000);
loadTimeline(true);
