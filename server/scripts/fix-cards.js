/**
 * One-off script: Remove cards without student names (up to 4), rename saeed iqbal to ayesha
 * Run from project root: node server/scripts/fix-cards.js
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database', 'cards.db');
const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function main() {
  console.log('Database:', dbPath);

  // 1. Find cards without student name (null, empty, or whitespace)
  const allCards = await all('SELECT id, card_id, student_name, student_class FROM cards ORDER BY id');
  const noName = allCards.filter(
    (r) => r.student_name == null || String(r.student_name).trim() === ''
  );
  console.log('Cards without student name:', noName.length, noName);

  // Delete up to 4 of them
  const toDelete = noName.slice(0, 4);
  for (const row of toDelete) {
    await run('DELETE FROM cards WHERE id = ?', [row.id]);
    console.log('Deleted card id', row.id, 'card_id', row.card_id);
  }
  console.log('Deleted', toDelete.length, 'cards without student name.');

  // 2. Rename saeed iqbal to ayesha (case-insensitive)
  const { changes } = await run(
    "UPDATE cards SET student_name = 'ayesha' WHERE LOWER(TRIM(student_name)) = 'saeed iqbal'"
  );
  console.log('Renamed "saeed iqbal" to "ayesha":', changes, 'row(s) updated.');

  db.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  db.close();
  process.exit(1);
});
