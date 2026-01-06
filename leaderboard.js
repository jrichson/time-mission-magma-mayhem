// ============================================
// LEADERBOARD FUNCTIONALITY
// ============================================

const LeaderboardAPI = {
    baseUrl: window.location.origin,

    async getLeaderboard() {
        try {
            const response = await fetch(`${this.baseUrl}/api/leaderboard`);
            if (!response.ok) throw new Error('Failed to fetch leaderboard');
            return await response.json();
        } catch (error) {
            console.error('Error fetching leaderboard:', error);
            return [];
        }
    },

    async submitScore(name, score, level, character) {
        try {
            const response = await fetch(`${this.baseUrl}/api/leaderboard`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, score, level, character })
            });
            if (!response.ok) throw new Error('Failed to submit score');
            return await response.json();
        } catch (error) {
            console.error('Error submitting score:', error);
            return null;
        }
    }
};

// Character emoji mapping
const CHARACTER_ICONS = {
    chicken: '🐔',
    banana: '🍌',
    skier: '⛷️',
    turtle: '🐢'
};

// Render leaderboard entries to a container
function renderLeaderboard(entries, containerId, highlightRank = null) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (entries.length === 0) {
        container.innerHTML = '<p class="no-scores">No scores yet. Be the first!</p>';
        return;
    }

    const html = entries.map((entry, index) => {
        const rank = index + 1;
        const isHighlighted = highlightRank === rank;
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
        const charIcon = CHARACTER_ICONS[entry.character] || '🎮';

        return `
            <div class="leaderboard-entry ${isHighlighted ? 'highlighted' : ''} ${rank <= 3 ? 'top-three' : ''}">
                <span class="entry-rank">${medal}</span>
                <span class="entry-char">${charIcon}</span>
                <span class="entry-name">${escapeHtml(entry.name)}</span>
                <span class="entry-score">${entry.score}</span>
            </div>
        `;
    }).join('');

    container.innerHTML = html;
}

// HTML escape helper
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Get current game state (exposed from game.js via window)
function getGameState() {
    return window.GameState || {
        totalScore: 0,
        currentLevel: 1,
        selectedCharacter: 'chicken'
    };
}

// Show leaderboard overlay from home screen
async function showLeaderboardOverlay() {
    const overlay = document.getElementById('leaderboard-overlay');
    overlay.classList.remove('hidden');

    const entries = await LeaderboardAPI.getLeaderboard();
    renderLeaderboard(entries, 'main-leaderboard-list');
}

// Hide leaderboard overlay
function hideLeaderboardOverlay() {
    document.getElementById('leaderboard-overlay').classList.add('hidden');
}

// Submit score and show leaderboard in game over screen
async function submitScoreAndShowLeaderboard() {
    const nameInput = document.getElementById('player-name-input');
    const submitBtn = document.getElementById('submit-score-btn');
    const statusEl = document.getElementById('submit-status');
    const submitSection = document.getElementById('score-submit-section');
    const leaderboardSection = document.getElementById('game-over-leaderboard');

    const name = nameInput.value.trim();
    if (!name) {
        statusEl.textContent = 'Please enter your name!';
        statusEl.className = 'submit-status error';
        nameInput.focus();
        return;
    }

    submitBtn.disabled = true;
    statusEl.textContent = 'Submitting...';
    statusEl.className = 'submit-status';

    const gameState = getGameState();
    const result = await LeaderboardAPI.submitScore(
        name,
        gameState.totalScore,
        gameState.currentLevel,
        gameState.selectedCharacter
    );

    if (result && result.success) {
        statusEl.textContent = result.rank <= 10
            ? `You ranked #${result.rank}!`
            : `Score submitted! Rank: #${result.rank}`;
        statusEl.className = 'submit-status success';

        // Hide submit section, show leaderboard
        submitSection.style.display = 'none';
        leaderboardSection.classList.remove('hidden');

        // Fetch and display updated leaderboard
        const entries = await LeaderboardAPI.getLeaderboard();
        renderLeaderboard(entries, 'game-over-leaderboard-list', result.rank <= 10 ? result.rank : null);
    } else {
        statusEl.textContent = 'Failed to submit. Try again!';
        statusEl.className = 'submit-status error';
        submitBtn.disabled = false;
    }
}

// Reset game over screen state (called when showing game over)
function resetGameOverLeaderboard() {
    const submitSection = document.getElementById('score-submit-section');
    const leaderboardSection = document.getElementById('game-over-leaderboard');
    const nameInput = document.getElementById('player-name-input');
    const submitBtn = document.getElementById('submit-score-btn');
    const statusEl = document.getElementById('submit-status');

    if (submitSection) submitSection.style.display = 'block';
    if (leaderboardSection) leaderboardSection.classList.add('hidden');
    if (nameInput) {
        nameInput.value = '';
        nameInput.disabled = false;
    }
    if (submitBtn) submitBtn.disabled = false;
    if (statusEl) {
        statusEl.textContent = '';
        statusEl.className = 'submit-status';
    }
}

// Initialize leaderboard event listeners
function initLeaderboard() {
    // View leaderboard button on home screen
    const viewLeaderboardBtn = document.getElementById('view-leaderboard-btn');
    if (viewLeaderboardBtn) {
        viewLeaderboardBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showLeaderboardOverlay();
        });
    }

    // Close leaderboard overlay button
    const closeLeaderboardBtn = document.getElementById('close-leaderboard-btn');
    if (closeLeaderboardBtn) {
        closeLeaderboardBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hideLeaderboardOverlay();
        });
    }

    // Submit score button
    const submitScoreBtn = document.getElementById('submit-score-btn');
    if (submitScoreBtn) {
        submitScoreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            submitScoreAndShowLeaderboard();
        });
    }

    // Allow Enter key to submit score
    const nameInput = document.getElementById('player-name-input');
    if (nameInput) {
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitScoreAndShowLeaderboard();
            }
        });
    }

    console.log('Leaderboard initialized');
}

// Expose functions for game.js to call
window.LeaderboardAPI = LeaderboardAPI;
window.resetGameOverLeaderboard = resetGameOverLeaderboard;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLeaderboard);
} else {
    initLeaderboard();
}
