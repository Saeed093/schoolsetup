const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database', 'cards.db');
const cardId = process.argv[2] || '0088914039';

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Cannot open database:', err);
    process.exit(1);
  }
});

db.run('DELETE FROM cards WHERE card_id = ?', [cardId], function(err) {
  if (err) {
    console.error('Error:', err);
    db.close();
    process.exit(1);
  }
  console.log('Deleted', this.changes, 'row(s) for card_id', cardId);
  db.close();
});
