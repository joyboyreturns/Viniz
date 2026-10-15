const test=require('node:test');
const assert=require('node:assert/strict');
const Sqlite=require('sqlite3');
const BetterSqlite=require('better-sqlite3');
const {splitCredit,artistId,createArtistCredits}=require('../artist-credits');
const {allowedImage}=require('../artwork');

test('credits split collaborations, preserve band punctuation and deduplicate people',()=>{
    assert.deepEqual(splitCredit('Arijit Singh, Shashwat Sachdev').map(a=>a.name),['Arijit Singh','Shashwat Sachdev']);
    assert.deepEqual(splitCredit('The Chainsmokers ft. Halsey').map(a=>a.name),['The Chainsmokers','Halsey']);
    for(const name of ['Earth, Wind & Fire','AC/DC','Simon & Garfunkel','Tyler, The Creator'])assert.deepEqual(splitCredit(name).map(a=>a.name),[name]);
    assert.equal(splitCredit('Arijit Singh; arijit singh').length,1);
    assert.deepEqual(splitCredit('Earth, Wind & Fire, Guest',{artist:[{name:'Earth, Wind & Fire'},{name:'Guest'}]}).map(a=>a.name),['Earth, Wind & Fire','Guest']);
    assert.equal(artistId('Arijit Singh'),artistId(' arijit  singh '));
});

test('artist membership includes collaborations while raw plays and total bytes stay unique',async()=>{
    const db=new Sqlite.Database(':memory:');const navi=new BetterSqlite(':memory:');
    const run=sql=>new Promise((resolve,reject)=>db.exec(sql,err=>err?reject(err):resolve()));
    const all=sql=>new Promise((resolve,reject)=>db.all(sql,(err,rows)=>err?reject(err):resolve(rows)));
    try{
        await run(`CREATE TABLE history(id INTEGER,user_name TEXT,track_name TEXT,artist_name TEXT,album_name TEXT,track_id TEXT,album_id TEXT,artist_id TEXT,duration INTEGER,genre TEXT,event_type TEXT,timestamp INTEGER);
        INSERT INTO history VALUES(1,'u','Solo','Arijit Singh','A','1','a','old1',100,'pop','play',1),(2,'u','Duet','Arijit Singh, Shashwat Sachdev','B','2','b','old2',200,'pop','play',2);`);
        navi.exec(`CREATE TABLE media_file(id TEXT,artist TEXT,participants TEXT,album_id TEXT,size INTEGER,updated_at TEXT,missing INTEGER);
        INSERT INTO media_file VALUES('1','Arijit Singh',NULL,'a',100,'2026-01-01',0),('2','Arijit Singh, Shashwat Sachdev',NULL,'b',300,'2026-01-02',0);`);
        const credits=createArtistCredits(db,navi);await credits.refresh();
        const grouped=await all('SELECT artist_name,COUNT(*) AS plays FROM artist_history GROUP BY artist_name ORDER BY artist_name');
        assert.deepEqual(grouped,[{artist_name:'Arijit Singh',plays:2},{artist_name:'Shashwat Sachdev',plays:1}]);
        assert.equal((await all('SELECT COUNT(*) AS count FROM history'))[0].count,2);
        assert.equal((await all("SELECT COUNT(*) AS count FROM artist_history WHERE artist_name='Arijit'"))[0].count,0);
        const artists=navi.prepare(credits.artistRows('WHERE missing=0')).all();
        assert.equal(artists.find(a=>a.name==='Arijit Singh').tracks,2);
        assert.equal(artists.find(a=>a.name==='Arijit Singh').bytes,400);
        assert.equal(artists.find(a=>a.name==='Shashwat Sachdev').tracks,1);
        assert.equal(navi.prepare('SELECT SUM(size) AS bytes FROM media_file').get().bytes,400);
        await run("INSERT INTO history VALUES(3,'u','New','New Artist, Arijit Singh','C','3','c','old3',10,'pop','play',3)");
        credits.invalidate();await credits.refresh();
        assert.equal((await all("SELECT COUNT(*) AS count FROM artist_history WHERE artist_name='Arijit Singh'"))[0].count,3);
    }finally{navi.close();await new Promise(resolve=>db.close(resolve));}
});

test('thumbnail sources reject arbitrary URLs and insecure/private hosts',()=>{
    assert.equal(allowedImage('https://lh3.googleusercontent.com/art.jpg'),true);
    for(const url of ['http://lh3.googleusercontent.com/a','https://127.0.0.1/a','https://googleusercontent.com.evil.test/a','file:///etc/passwd'])assert.equal(allowedImage(url),false);
});
