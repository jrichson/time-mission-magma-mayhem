const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// Data file path
const DATA_FILE = path.join(__dirname, 'leaderboard.json');

// Initialize data file if it doesn't exist
function initDataFile() {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ entries: [], nextId: 1 }, null, 2));
    }
}

// Read leaderboard data
function readData() {
    initDataFile();
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading data file:', error);
        return { entries: [], nextId: 1 };
    }
}

// Write leaderboard data
function writeData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing data file:', error);
        return false;
    }
}

// API Endpoints

// Get top 10 scores
app.get('/api/leaderboard', (req, res) => {
    try {
        const data = readData();
        const topScores = data.entries
            .sort((a, b) => b.score - a.score || new Date(a.created_at) - new Date(b.created_at))
            .slice(0, 10);
        res.json(topScores);
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

// Submit a new score
app.post('/api/leaderboard', (req, res) => {
    const { name, score, level, character } = req.body;

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Name is required' });
    }
    if (typeof score !== 'number' || score < 0 || score > 120) {
        return res.status(400).json({ error: 'Invalid score' });
    }
    if (typeof level !== 'number' || level < 1 || level > 12) {
        return res.status(400).json({ error: 'Invalid level' });
    }

    const sanitizedName = name.trim().substring(0, 20); // Max 20 chars
    const validCharacters = ['chicken', 'banana', 'skier', 'turtle'];
    const sanitizedCharacter = validCharacters.includes(character) ? character : 'chicken';

    try {
        const data = readData();

        const newEntry = {
            id: data.nextId++,
            name: sanitizedName,
            score: score,
            level: level,
            character: sanitizedCharacter,
            created_at: new Date().toISOString()
        };

        data.entries.push(newEntry);

        // Keep only top 100 entries to prevent file from growing too large
        data.entries.sort((a, b) => b.score - a.score);
        if (data.entries.length > 100) {
            data.entries = data.entries.slice(0, 100);
        }

        writeData(data);

        // Calculate rank
        const rank = data.entries.findIndex(e => e.id === newEntry.id) + 1;

        res.json({
            success: true,
            id: newEntry.id,
            rank: rank
        });
    } catch (error) {
        console.error('Error saving score:', error);
        res.status(500).json({ error: 'Failed to save score' });
    }
});

// Get player's rank for a specific score
app.get('/api/leaderboard/rank/:score', (req, res) => {
    const score = parseInt(req.params.score);
    if (isNaN(score)) {
        return res.status(400).json({ error: 'Invalid score' });
    }

    try {
        const data = readData();
        const higherScores = data.entries.filter(e => e.score > score).length;
        res.json({ rank: higherScores + 1 });
    } catch (error) {
        console.error('Error getting rank:', error);
        res.status(500).json({ error: 'Failed to get rank' });
    }
});

// Initialize and start server
initDataFile();
app.listen(PORT, () => {
    console.log(`Leaderboard server running on http://localhost:${PORT}`);
    console.log(`Game available at http://localhost:${PORT}/index.html`);
});
