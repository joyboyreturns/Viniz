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
                backgroundColor: ['#ff9a9e', '#a1c4fd'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#fff' } }
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
            imgUrl = getCoverArtUrl(item.artist_id); // Often Navidrome artist art is just same endpoint
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

// Initial Load
fetchSummary();
fetchList('tracks', 'today');
fetchList('albums', 'today');
fetchList('artists', 'today');
