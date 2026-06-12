const { naviDb, db } = require('./database');
console.log('Testing naviDb...');
naviDb.get('SELECT 1', (err, row) => {
  if (err) console.error('naviDb err:', err);
  else console.log('naviDb row:', row);
  
  console.log('Testing db...');
  db.get('SELECT 1', (err, row) => {
     if (err) console.error('db err:', err);
     else console.log('db row:', row);
  });
});
