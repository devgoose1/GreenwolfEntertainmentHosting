const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'db', 'localstorage.json');
let internal = {};

// Ensure db folder exists
if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

// Load data safely
function load() {
  if (fs.existsSync(dbPath)) {
    try {
      const file = fs.readFileSync(dbPath, 'utf8').trim();
      internal = file ? JSON.parse(file) : {};
    }
    catch (err) {
      console.error('⚠️ Warning: localstorage.json is invalid, resetting to empty object.');
      internal = {};
    }
  } else {
    fs.writeFileSync(dbPath, '{}');
    internal = {};
  }
}

// Save function
function save() {
  fs.writeFileSync(dbPath, JSON.stringify(internal, null, 2));
}

// API
const localstorage = {
  getItem: (key) => internal[key] ?? null,
  setItem: (key, value) => {
    internal[key] = value;
    save();
  },
  removeItem: (key) => {
    delete internal[key];
    save();
  },
  reload: () => {
    load();
    return internal;
  },
  _raw: () => internal // For testing/debugging purposes
};

module.exports = { localstorage };
