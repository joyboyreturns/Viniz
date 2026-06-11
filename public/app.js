const NAVIDROME_USER = 'Vincent';
const NAVIDROME_PASS = 'dog';

function getNavidromeHostname() {
    return window.location.hostname;
}

function getCoverArtUrl(id) {
    if (!id) return '';
    return `http://${getNavidromeHostname()}:4533/rest/getCoverArt?id=${id}&u=${NAVIDROME_USER}&p=${NAVIDROME_PASS}&v=1.12.0&c=Viniz`;
}

function formatPlaytime(seconds) {
    if (!seconds) return '0m';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

let barChartInstance = null;
let chartDataCache = [];
let currentChartMode = 'views';

async function fetchChartData() {
    const res = await fetch('/api/stats/chart');
    chartDataCache = await res.json();
    renderChart();
}

function renderChart() {
    const ctx = document.getElementById('summaryBarChart').getContext('2d');
    if (barChartInstance) barChartInstance.destroy();
    
    // Fill missing days
    const labels = [];
    const dataPoints = [];
    
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dayStr = d.toISOString().split('T')[0];
        
        const row = chartDataCache.find(r => r.day === dayStr);
        labels.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
        if (row) {
            dataPoints.push(currentChartMode === 'views' ? row.views : row.plays);
        } else {
            dataPoints.push(0);
        }
    }

    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, '#fa233b');
    gradient.addColorStop(1, 'rgba(250, 35, 59, 0.1)');

    barChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: currentChartMode === 'views' ? 'Views' : 'Plays',
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
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.5)' } },
                x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.5)' } }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

document.querySelectorAll('input[name="chart-toggle"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        currentChartMode = e.target.value;
        renderChart();
    });
});

async function fetchSummary() {
    const res = await fetch('/api/stats/summary?filter=all');
    const data = await res.json();
    
    document.getElementById('total-plays').innerText = data.plays || 0;
    document.getElementById('total-playtime').innerText = formatPlaytime(data.playtime || 0);
    document.getElementById('total-views').innerText = data.views || 0;
}

function renderListItems(dataList, listElId, type) {
    const listEl = document.getElementById(listElId);
    listEl.innerHTML = '';
    
    dataList.forEach(item => {
        const li = document.createElement('li');
        if (type === 'artists') {
            li.classList.add('artist-item');
            li.addEventListener('click', () => openArtistModal(item.artist_name, 'all'));
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
                <span class="item-name">${title}</span>
                <span class="item-sub">${sub}</span>
            </div>
            <div class="item-stats">
                <span class="item-playtime">${formatPlaytime(item.playtime)}</span>
                <span class="item-views">${item.views} views</span>
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

document.querySelectorAll('.time-toggler:not(#search-time-filter)').forEach(select => {
    select.addEventListener('change', (e) => {
        const type = e.target.getAttribute('data-target').replace('top-', '');
        fetchList(type, e.target.value);
    });
});

// Search Logic
const searchInput = document.getElementById('search-input');
const searchFilter = document.getElementById('search-time-filter');
const closeSearchBtn = document.getElementById('close-search-btn');
const mainDashboard = document.getElementById('main-dashboard');
const searchOverlay = document.getElementById('search-results-overlay');

let searchTimeout = null;

async function performSearch() {
    const query = searchInput.value.trim();
    if (!query) {
        closeSearch();
        return;
    }
    
    mainDashboard.classList.add('hidden');
    searchOverlay.classList.remove('hidden');
    closeSearchBtn.classList.remove('hidden');
    
    const filter = searchFilter.value;
    const res = await fetch(`/api/stats/search?q=${encodeURIComponent(query)}&filter=${filter}`);
    const data = await res.json();
    
    renderListItems(data.tracks, 'search-tracks-list', 'tracks');
    renderListItems(data.albums, 'search-albums-list', 'albums');
    renderListItems(data.artists, 'search-artists-list', 'artists');
}

function closeSearch() {
    searchInput.value = '';
    mainDashboard.classList.remove('hidden');
    searchOverlay.classList.add('hidden');
    closeSearchBtn.classList.add('hidden');
}

searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(performSearch, 300);
});

searchFilter.addEventListener('change', () => {
    if (searchInput.value.trim()) {
        performSearch();
    }
});

closeSearchBtn.addEventListener('click', closeSearch);

// Modal Logic
const modal = document.getElementById('artist-modal');
const closeModalBtn = document.getElementById('close-modal');

closeModalBtn.addEventListener('click', () => {
    modal.classList.remove('active');
});

modal.addEventListener('click', (e) => {
    if (e.target === modal) {
        modal.classList.remove('active');
    }
});

async function openArtistModal(artistName, filter) {
    modal.classList.add('active');
    
    // Clear old data while loading
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
        
        // Render Top Tracks
        const tracksList = document.getElementById('modal-top-tracks');
        data.top_tracks.forEach(item => {
            const li = document.createElement('li');
            li.innerHTML = `
                <img src="${getCoverArtUrl(item.album_id || item.track_id)}" class="cover-art" onerror="this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='">
                <div class="item-info">
                    <span class="item-name">${item.track_name}</span>
                    <span class="item-sub">${item.views} views</span>
                </div>
                <div class="item-stats">
                    <span class="item-playtime">${formatPlaytime(item.playtime)}</span>
                </div>
            `;
            tracksList.appendChild(li);
        });

        // Render Top Albums
        const albumsList = document.getElementById('modal-top-albums');
        data.top_albums.forEach(item => {
            const li = document.createElement('li');
            li.innerHTML = `
                <img src="${getCoverArtUrl(item.album_id)}" class="cover-art" onerror="this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='">
                <div class="item-info">
                    <span class="item-name">${item.album_name}</span>
                    <span class="item-sub">${item.plays} plays</span>
                </div>
                <div class="item-stats">
                    <span class="item-playtime">${formatPlaytime(item.playtime)}</span>
                </div>
            `;
            albumsList.appendChild(li);
        });
        
    } catch (err) {
        console.error('Failed to fetch artist details:', err);
    }
}

// Initial Load
fetchSummary();
fetchChartData();
fetchList('tracks', 'today');
fetchList('albums', 'today');
fetchList('artists', 'today');
