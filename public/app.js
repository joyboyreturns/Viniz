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

let pieChartInstance = null;

async function fetchSummary() {
    const res = await fetch('/api/stats/summary?filter=all');
    const data = await res.json();
    
    document.getElementById('total-plays').innerText = data.plays || 0;
    document.getElementById('total-playtime').innerText = formatPlaytime(data.playtime || 0);
    document.getElementById('total-views').innerText = data.views || 0;

    const ctx = document.getElementById('summaryPieChart').getContext('2d');
    
    if (pieChartInstance) pieChartInstance.destroy();
    
    pieChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Completed Plays', 'Views (Incomplete)'],
            datasets: [{
                data: [data.plays || 0, Math.max(0, (data.views || 0) - (data.plays || 0))],
                backgroundColor: ['#fa233b', 'rgba(255,255,255,0.2)'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#fff', font: { family: 'Inter', size: 12 } } }
            }
        }
    });
}

async function fetchList(type, filter) {
    const res = await fetch(`/api/stats/top-${type}?filter=${filter}`);
    const data = await res.json();
    
    const listEl = document.getElementById(`top-${type}-list`);
    listEl.innerHTML = '';
    
    data.forEach(item => {
        const li = document.createElement('li');
        if (type === 'artists') {
            li.classList.add('artist-item');
            li.addEventListener('click', () => openArtistModal(item.artist_name, filter));
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

document.querySelectorAll('.time-toggler').forEach(select => {
    select.addEventListener('change', (e) => {
        const type = e.target.getAttribute('data-target').replace('top-', '');
        fetchList(type, e.target.value);
    });
});

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
fetchList('tracks', 'today');
fetchList('albums', 'today');
fetchList('artists', 'today');
