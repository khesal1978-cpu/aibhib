const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Connect to SQLite database
const db = new sqlite3.Database(path.join(__dirname, 'bot.sqlite'), (err) => {
    if (err) {
        console.error('Database connection error:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initDb();
    }
});

function initDb() {
    // Basic settings for groups
    db.run(`CREATE TABLE IF NOT EXISTS group_settings (
        chat_id TEXT PRIMARY KEY,
        anti_spam_enabled BOOLEAN DEFAULT 1
    )`);

    // Tracking user warnings (violations)
    db.run(`CREATE TABLE IF NOT EXISTS warnings (
        user_id TEXT,
        chat_id TEXT,
        count INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, chat_id)
    )`);
}

// Wrapper for Promises to make async queries easier
const dbAsync = {
    get: (query, params) => new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => err ? reject(err) : resolve(row));
    }),
    run: (query, params) => new Promise((resolve, reject) => {
        db.run(query, params, function(err) {
            if(err) reject(err);
            else resolve(this);
        });
    })
};

module.exports = { db, dbAsync };
