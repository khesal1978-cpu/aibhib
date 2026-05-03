const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

// Load or initialize data
function loadData() {
    try {
        if (fs.existsSync(DB_PATH)) {
            return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        }
    } catch (e) {
        console.error('[DB] Failed to load data, starting fresh:', e.message);
    }
    return { warnings: {} };
}

function saveData(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

let data = loadData();

const dbAsync = {
    get: async (query, params) => {
        // Simulates: SELECT count FROM warnings WHERE user_id = ? AND chat_id = ?
        const key = `${params[0]}_${params[1]}`;
        const count = data.warnings[key];
        return count !== undefined ? { count } : null;
    },
    run: async (query, params) => {
        if (query.includes('INSERT') || query.includes('UPDATE')) {
            // INSERT or UPDATE warnings
            const key = `${params[1]}_${params[2]}`;
            data.warnings[key] = params[0]; // count is first param
            saveData(data);
        } else if (query.includes('DELETE')) {
            // DELETE FROM warnings WHERE user_id = ? AND chat_id = ?
            const key = `${params[0]}_${params[1]}`;
            delete data.warnings[key];
            saveData(data);
        }
    }
};

console.log('Connected to JSON database.');

module.exports = { dbAsync };
