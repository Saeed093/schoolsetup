const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'cards.db');
let db;

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function initializeDatabase() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Error opening database:', err);
        reject(err);
        return;
      }
      console.log('Connected to SQLite database');

      // Ensure schema exists, then run lightweight migrations if needed
      db.serialize(async () => {
        try {
          await run(
            db,
            `
            CREATE TABLE IF NOT EXISTS cards (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              card_id TEXT UNIQUE NOT NULL,
              student_name TEXT NOT NULL,
              student_class TEXT DEFAULT '',
              alarm_enabled INTEGER DEFAULT 0,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          `
          );

          const cols = await all(db, `PRAGMA table_info(cards)`);
          const colNames = new Set(cols.map((c) => c.name));

          const hasOldName = colNames.has('name');
          const hasStudentName = colNames.has('student_name');
          const hasStudentClass = colNames.has('student_class');
          const hasAlarmEnabled = colNames.has('alarm_enabled');
          const hasAdultName = colNames.has('adult_name');

          // Migrate old schema: name -> student_name, add student_class
          if (hasOldName && !hasStudentName) {
            console.log('Migrating cards schema: name -> student_name, adding student_class...');
            await run(db, `ALTER TABLE cards RENAME TO cards_old`);
            await run(
              db,
              `
              CREATE TABLE cards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                card_id TEXT UNIQUE NOT NULL,
                student_name TEXT NOT NULL,
                student_class TEXT DEFAULT '',
                alarm_enabled INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
              )
            `
            );
            // Preserve existing ids/timestamps if present
            await run(
              db,
              `
              INSERT INTO cards (id, card_id, student_name, student_class, alarm_enabled, created_at, updated_at)
              SELECT id, card_id, name, '', 0, created_at, updated_at
              FROM cards_old
            `
            );
            await run(db, `DROP TABLE cards_old`);
            console.log('Migration complete.');
          } else if (hasStudentName && !hasStudentClass) {
            console.log('Migrating cards schema: adding student_class...');
            await run(db, `ALTER TABLE cards ADD COLUMN student_class TEXT DEFAULT ''`);
            console.log('Migration complete.');
          }

          // Add alarm_enabled column if it doesn't exist
          if (!hasAlarmEnabled) {
            console.log('Migrating cards schema: adding alarm_enabled...');
            await run(db, `ALTER TABLE cards ADD COLUMN alarm_enabled INTEGER DEFAULT 0`);
            console.log('Migration complete.');
          }

          // Add adult_name column (pickup contact / adult linked to child)
          if (!hasAdultName) {
            console.log('Migrating cards schema: adding adult_name...');
            await run(db, `ALTER TABLE cards ADD COLUMN adult_name TEXT DEFAULT ''`);
            console.log('Migration complete.');
          }

          // Add image columns for adult and child photos
          const hasAdultImage = colNames.has('adult_image');
          const hasChildImage = colNames.has('child_image');
          if (!hasAdultImage) {
            console.log('Migrating cards schema: adding adult_image...');
            await run(db, `ALTER TABLE cards ADD COLUMN adult_image TEXT DEFAULT ''`);
            console.log('Migration complete.');
          }
          if (!hasChildImage) {
            console.log('Migrating cards schema: adding child_image...');
            await run(db, `ALTER TABLE cards ADD COLUMN child_image TEXT DEFAULT ''`);
            console.log('Migration complete.');
          }

          // Add checkin_card_id column for separate check-in RFID card
          const hasCheckinCardId = colNames.has('checkin_card_id');
          if (!hasCheckinCardId) {
            console.log('Migrating cards schema: adding checkin_card_id...');
            await run(db, `ALTER TABLE cards ADD COLUMN checkin_card_id TEXT DEFAULT ''`);
            console.log('Migration complete.');
          }

          const colsAfter = await all(db, `PRAGMA table_info(cards)`);
          const colNamesAfter = new Set(colsAfter.map((c) => c.name));
          if (!colNamesAfter.has('guardians_json')) {
            console.log('Migrating cards schema: adding guardians_json...');
            await run(db, `ALTER TABLE cards ADD COLUMN guardians_json TEXT DEFAULT ''`);
            console.log('Migration complete.');
          }

          // Pickups log (for Principal view: who was picked up, when, guardian photo)
          await run(
            db,
            `
            CREATE TABLE IF NOT EXISTS pickups (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              card_id TEXT NOT NULL,
              student_name TEXT NOT NULL,
              student_class TEXT DEFAULT '',
              adult_name TEXT DEFAULT '',
              adult_image TEXT DEFAULT '',
              child_image TEXT DEFAULT '',
              pickup_image TEXT DEFAULT '',
              picked_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          `
          );

          // Add pickup_image column if it doesn't exist (migration)
          const pickupCols = await all(db, `PRAGMA table_info(pickups)`);
          const pickupColNames = new Set(pickupCols.map((c) => c.name));
          if (!pickupColNames.has('pickup_image')) {
            console.log('Migrating pickups schema: adding pickup_image...');
            await run(db, `ALTER TABLE pickups ADD COLUMN pickup_image TEXT DEFAULT ''`);
            console.log('Migration complete.');
          }

          // Add direction column for check-in/check-out tracking ('in' or 'out')
          if (!pickupColNames.has('direction')) {
            console.log('Migrating pickups schema: adding direction...');
            await run(db, `ALTER TABLE pickups ADD COLUMN direction TEXT DEFAULT 'out'`);
            console.log('Migration complete.');
          }

          // Add uhf_tag_id column to cards for UHF child attendance tracking
          const colsForUhf = await all(db, `PRAGMA table_info(cards)`);
          const colNamesUhf = new Set(colsForUhf.map((c) => c.name));
          if (!colNamesUhf.has('uhf_tag_id')) {
            console.log('Migrating cards schema: adding uhf_tag_id...');
            await run(db, `ALTER TABLE cards ADD COLUMN uhf_tag_id TEXT DEFAULT ''`);
            console.log('Migration complete.');
          }

          // Attendance table: current in/out status per child
          await run(
            db,
            `
            CREATE TABLE IF NOT EXISTS attendance (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              uhf_tag_id TEXT NOT NULL,
              card_id TEXT NOT NULL,
              student_name TEXT NOT NULL,
              student_class TEXT DEFAULT '',
              status TEXT DEFAULT 'out',
              last_changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          `
          );

          // Migrate attendance table: add missing columns if the table pre-dates them
          const attCols = await all(db, `PRAGMA table_info(attendance)`);
          const attColNames = new Set(attCols.map((c) => c.name));
          if (!attColNames.has('uhf_tag_id')) {
            console.log('Migrating attendance schema: adding uhf_tag_id...');
            await run(db, `ALTER TABLE attendance ADD COLUMN uhf_tag_id TEXT NOT NULL DEFAULT ''`);
            console.log('Migration complete.');
          }
          if (!attColNames.has('card_id')) {
            console.log('Migrating attendance schema: adding card_id...');
            await run(db, `ALTER TABLE attendance ADD COLUMN card_id TEXT NOT NULL DEFAULT ''`);
            console.log('Migration complete.');
          }
          if (!attColNames.has('student_name')) {
            console.log('Migrating attendance schema: adding student_name...');
            await run(db, `ALTER TABLE attendance ADD COLUMN student_name TEXT NOT NULL DEFAULT ''`);
            console.log('Migration complete.');
          }
          if (!attColNames.has('student_class')) {
            console.log('Migrating attendance schema: adding student_class...');
            await run(db, `ALTER TABLE attendance ADD COLUMN student_class TEXT DEFAULT ''`);
            console.log('Migration complete.');
          }
          if (!attColNames.has('last_changed_at')) {
            console.log('Migrating attendance schema: adding last_changed_at...');
            await run(db, `ALTER TABLE attendance ADD COLUMN last_changed_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
            console.log('Migration complete.');
          }

          // Attendance log: historical record of all in/out transitions
          await run(
            db,
            `
            CREATE TABLE IF NOT EXISTS attendance_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              uhf_tag_id TEXT NOT NULL,
              card_id TEXT NOT NULL,
              student_name TEXT NOT NULL,
              student_class TEXT DEFAULT '',
              direction TEXT NOT NULL,
              timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          `
          );

          // UHF settings: key/value store for configurable settings
          await run(
            db,
            `
            CREATE TABLE IF NOT EXISTS uhf_settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            )
          `
          );

          // Seed default UHF settings if they don't exist
          const existingSettings = await all(db, `SELECT key FROM uhf_settings`);
          const settingKeys = new Set(existingSettings.map((s) => s.key));
          const defaults = {
            debounce_seconds: '5',
            sdk_url: 'http://localhost:8888',
            com_port: '',
            baud_rate: '115200',
            auto_connect: 'false'
          };
          for (const [key, value] of Object.entries(defaults)) {
            if (!settingKeys.has(key)) {
              await run(db, `INSERT INTO uhf_settings (key, value) VALUES (?, ?)`, [key, value]);
            }
          }

          console.log('Database tables initialized');
          resolve();
        } catch (e) {
          console.error('Error initializing/migrating database:', e);
          reject(e);
        }
      });
    });
  });
}

function getDatabase() {
  return db;
}

/**
 * Log a pickup/checkin (card scan) for Principal view. Call after broadcasting card_scan for authorized cards.
 * @param {object} payload - { card_id, student_name, student_class, adult_name, adult_image, child_image, pickup_image, direction, timestamp }
 * direction: 'in' = check-in (arriving at school), 'out' = check-out/pickup (leaving school)
 */
function logPickup(payload) {
  if (!db || !payload) return;
  const ts = payload.timestamp || new Date().toISOString();
  
  // Use pickup_image (captured at pickup) if available, otherwise use adult_image
  // Remove query string parameters from image paths for storage
  let adultImage = (payload.adult_image || '').split('?')[0];
  let pickupImage = (payload.pickup_image || payload.captured_image || '').split('?')[0];
  
  // Direction: 'in' for check-in, 'out' for check-out/pickup (default)
  const direction = payload.direction === 'in' ? 'in' : 'out';
  
  db.run(
    'INSERT INTO pickups (card_id, student_name, student_class, adult_name, adult_image, child_image, pickup_image, direction, picked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      payload.card_id || '',
      payload.student_name || 'Unknown',
      payload.student_class || '',
      payload.adult_name || '',
      adultImage,
      payload.child_image || '',
      pickupImage,
      direction,
      ts
    ],
    (err) => {
      if (err) console.error('logPickup error:', err);
    }
  );
}

function closeDatabase() {
  return new Promise((resolve, reject) => {
    if (db) {
      db.close((err) => {
        if (err) {
          reject(err);
        } else {
          console.log('Database connection closed');
          resolve();
        }
      });
    } else {
      resolve();
    }
  });
}

module.exports = {
  initializeDatabase,
  getDatabase,
  closeDatabase,
  logPickup
};
