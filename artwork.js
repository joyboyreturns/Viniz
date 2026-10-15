const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { artistNameFromId, splitCredit } = require('./artist-credits');
const cacheRoot = path.join(path.dirname(process.env.VINIZ_DB_PATH || path.join(__dirname, 'data', 'viniz.db')), 'artwork');
const placeholder = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#59406f"/><stop offset="1" stop-color="#192b3c"/></linearGradient></defs><rect width="400" height="400" rx="24" fill="url(#g)"/><circle cx="200" cy="200" r="113" fill="none" stroke="#bda5df" stroke-opacity=".3" stroke-width="2"/><path d="M180 256V135l90-17v113m-90-64 90-17" stroke="#d7c0f0" stroke-width="13" fill="none"/><ellipse cx="157" cy="256" rx="27" ry="19" fill="#d7c0f0"/><ellipse cx="246" cy="231" rx="27" ry="19" fill="#d7c0f0"/></svg>';
const coverId = row => row.album_id || row.track_id || 'cover-' + Buffer.from(JSON.stringify({kind:row.track_name?'song':'album',name:row.track_name||row.album_name,artist:row.artist_name})).toString('base64url');
const cacheKey = key => createHash('sha256').update(key).digest('hex');
function allowedImage(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' && ['googleusercontent.com', 'ggpht.com', 'ytimg.com', 'dzcdn.net'].some(host => parsed.hostname === host || parsed.hostname.endsWith('.' + host));
    } catch (_) { return false; }
}
function createArtwork({ db, naviDb, requestMusic }) {
    const pending = new Map(), failures = new Map();
    let lookupTail = Promise.resolve();
    function lookup(operation,value) {
        const task=lookupTail.then(async()=>{for(let attempt=0;;attempt++){try{return await requestMusic(operation,'ZZ',value);}catch(error){if(error.status!==429||attempt>=3)throw error;await new Promise(resolve=>setTimeout(resolve,1500));}}});
        lookupTail=task.catch(()=>{}).then(()=>new Promise(resolve=>setTimeout(resolve,300)));
        return task;
    }
    const table = name => Boolean(naviDb?.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
    const hasArtists = table('artist');
    const mediaColumns = new Set(naviDb?.prepare('PRAGMA table_info(media_file)').all().map(c => c.name));
    const allHistory = (sql, params=[]) => new Promise((resolve,reject) => db.all(sql, params, (error,rows) => error ? reject(error) : resolve(rows)));
    async function describe(id) {
        if(String(id).startsWith('cover-')) { try { const data=JSON.parse(Buffer.from(id.slice(6),'base64url').toString('utf8')); if(['song','album'].includes(data.kind)&&typeof data.name==='string'&&data.name.length<=300&&typeof data.artist==='string'&&data.artist.length<=300)return {...data,key:'cover:'+id,hasArt:false}; }catch(_){} return null; }
        const name = artistNameFromId(id);
        if (name) return { kind:'artist', name, key:'artist:' + name };
        if (hasArtists) {
            const row = naviDb.prepare('SELECT name FROM artist WHERE id=?').get(id);
            if (row) { const person=splitCredit(row.name)[0]; return {kind:'artist',name:person.name,key:'artist:'+person.name.toLowerCase()}; }
        }
        if (naviDb) {
            const row = naviDb.prepare(`SELECT id,title,artist,album,album_id ${mediaColumns.has('has_cover_art')?',has_cover_art':''} FROM media_file WHERE id=? OR album_id=? LIMIT 1`).get(id,id);
            if (row) return {kind:'song',name:row.title,artist:row.artist,key:'cover:'+id,nativeId:row.album_id||row.id,hasArt:row.has_cover_art!==0};
        }
        const rows = await allHistory('SELECT track_name,artist_name,album_id,artist_id FROM history WHERE album_id=? OR track_id=? OR artist_id=? LIMIT 1',[id,id,id]);
        const row=rows[0];
        if (!row) return null;
        // Older listens sometimes stored the uploader as artist. Match an explicit
        // Artist - Title prefix to local metadata before considering online artwork.
        if(naviDb && row.track_name?.includes(' - ')) {
            const index=row.track_name.indexOf(' - '), person=row.track_name.slice(0,index);
            const norm=text=>String(text||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
            const clean=text=>norm(String(text||'').replace(/[\[(](?:official(?: music)?(?: video| audio)?|lyrics?|audio|visualizer)[^\])]*[\])]/gi,'').replace(/\s*[\[(]?\s*\b(?:feat\.?|ft\.?|featuring)\s+.*$/i,''));
            const match=naviDb.prepare('SELECT id,title,artist,album_id FROM media_file WHERE missing=0').all().find(track=>splitCredit(track.artist).some(a=>norm(a.name)===norm(person))&&clean(track.title)===clean(row.track_name.slice(index+3)));
            if(match)return {kind:'song',name:match.title,artist:match.artist,key:'cover:'+id,nativeId:match.album_id||match.id,hasArt:true};
        }
        if(row.artist_id===id) { const person=splitCredit(row.artist_name)[0]; return {kind:'artist',name:person.name,key:'artist:'+person.name.toLowerCase()}; }
        return {kind:'song',name:row.track_name,artist:row.artist_name,key:'cover:'+id,nativeId:id,hasArt:true};
    }
    function read(key) {
        const base=path.join(cacheRoot,cacheKey(key));
        try { const meta=JSON.parse(fs.readFileSync(base+'.json','utf8')); if(Date.now()-meta.savedAt>30*86400_000)return null;return {mime:meta.mime,bytes:fs.readFileSync(base+'.image')}; }catch(_){return null;}
    }
    function save(key,image) {
        fs.mkdirSync(cacheRoot,{recursive:true});const base=path.join(cacheRoot,cacheKey(key));
        fs.writeFileSync(base+'.image.tmp',image.bytes);fs.renameSync(base+'.image.tmp',base+'.image');
        fs.writeFileSync(base+'.json',JSON.stringify({mime:image.mime,savedAt:Date.now()}));return image;
    }
    async function fetchImage(url, remote=false) {
        if(remote&&!allowedImage(url))return null;
        try {const r=await fetch(url,{signal:AbortSignal.timeout(8000)});const mime=r.headers.get('content-type')?.split(';')[0];
            if(!r.ok||!['image/jpeg','image/png','image/webp','image/avif'].includes(mime)||Number(r.headers.get('content-length'))>3*1024*1024)return null;
            const bytes=Buffer.from(await r.arrayBuffer());return bytes.length&&bytes.length<=3*1024*1024?{mime,bytes}:null;
        }catch(_){return null;}
    }
    function nativeUrl(id) {
        const params=new URLSearchParams({id,u:process.env.NAVIDROME_USER||'',p:process.env.NAVIDROME_PASS||'',v:'1.16.1',c:'Viniz'});
        return `http://${process.env.NAVIDROME_HOST||'localhost'}:${process.env.NAVIDROME_PORT||4533}/rest/getCoverArt?${params}`;
    }
    async function get(descriptor) {
        if(!descriptor)return null;
        const cached=read(descriptor.key);if(cached)return cached;
        if((failures.get(descriptor.key)||0)>Date.now())return null;
        if(pending.has(descriptor.key))return pending.get(descriptor.key);
        const task=(async()=>{
            try {
                let image;
                if(descriptor.kind==='artist'&&hasArtists){
                    const native=naviDb.prepare('SELECT id,large_image_url,small_image_url FROM artist WHERE name=? COLLATE NOCASE').get(descriptor.name);
                    const url=native?.large_image_url||native?.small_image_url;
                    if(url&&!url.includes('d41d8cd98f00b204e9800998ecf8427e'))image=await fetchImage(nativeUrl(native.id));
                }else if(descriptor.nativeId&&descriptor.hasArt) image=await fetchImage(nativeUrl(descriptor.nativeId));
                if(!image){
                    const value=descriptor.kind==='artist'?descriptor.name:JSON.stringify({title:descriptor.name,artists:splitCredit(descriptor.artist).map(a=>a.name)});
                    const result=await lookup(descriptor.kind==='artist'?'artist-art':descriptor.kind==='album'?'album-art':'song-art',value);
                    if(result.image)image=await fetchImage(result.image,true);
                }
                if(!image&&descriptor.kind==='artist') {
                    const history=await allHistory('SELECT track_name,artist_name,album_name,album_id,track_id FROM artist_history WHERE artist_name=? COLLATE NOCASE LIMIT 1',[descriptor.name]);
                    const row=history[0];
                    if(row)image=await get(await describe(coverId({...row,artist_name:descriptor.name})));
                }
                if(image)return save(descriptor.key,image);
            }catch(error){console.warn('Artwork lookup:',descriptor.name,error.status===429?'provider busy':error.message.slice(0,160));}
            failures.set(descriptor.key,Date.now()+5*60_000);return null;
        })().finally(()=>pending.delete(descriptor.key));pending.set(descriptor.key,task);return task;
    }
    let repairJob={status:'idle',completed:0,total:0,missing:[]};
    async function repair() {
        if(repairJob.status==='running')return repairJob;
        failures.clear();
        const credits=await allHistory('SELECT artists FROM artist_credits');
        const people=new Map(credits.flatMap(c=>JSON.parse(c.artists)).filter(a=>a.name!=='Unknown').map(a=>[a.id,a]));
        const targets=[...people.values()].map(a=>({kind:'artist',name:a.name,key:'artist:'+a.name.toLowerCase()}));
        if(naviDb&&mediaColumns.has('has_cover_art'))for(const row of naviDb.prepare('SELECT id,title,artist,album_id FROM media_file WHERE missing=0 AND has_cover_art=0').all())targets.push({kind:'song',name:row.title,artist:row.artist,key:'cover:'+row.album_id,nativeId:row.album_id,hasArt:false});
        for(const row of await allHistory('SELECT track_name,artist_name,album_name,MAX(album_id) AS album_id,MAX(track_id) AS track_id FROM history GROUP BY track_name,artist_name,album_name')) { const target=await describe(coverId(row)); if(target&&!targets.some(t=>t.key===target.key)) targets.push(target); }
        repairJob={status:'running',completed:0,total:targets.length,missing:[]};
        (async()=>{for(const target of targets){if(!await get(target))repairJob.missing.push(target.name);repairJob.completed++;}repairJob.status='complete';})().catch(error=>{repairJob.status='failed';repairJob.error=error.message;});
        return repairJob;
    }
    return {describe,get,repair,status:()=>repairJob,placeholder};
}
module.exports={createArtwork,allowedImage,placeholder,coverId};
