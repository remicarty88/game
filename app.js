import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, push, remove, update, onDisconnect, get, query, orderByChild, limitToLast, startAt } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// Firebase configuration
const firebaseConfig = {
    databaseURL: "https://neonapp-a05b0-default-rtdb.firebaseio.com/",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Telegram WebApp SDK
const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

// State
let currentUser = {
    id: String(tg.initDataUnsafe?.user?.id || localStorage.getItem('user_id') || Math.floor(Math.random() * 1000000)),
    name: '',
    photo: tg.initDataUnsafe?.user?.photo_url || '',
    points: 0
};

let currentGameId = null;
let currentMatchId = null;
let playerSymbol = null;

// Сохранение ID в localStorage если это не Telegram
if (!tg.initDataUnsafe?.user?.id) {
    localStorage.setItem('user_id', currentUser.id);
}

// DOM Elements
const authScreenEl = document.getElementById('auth-screen');
const usernameInputEl = document.getElementById('username-input');
const saveUsernameBtn = document.getElementById('save-username-btn');
const skipAuthBtn = document.getElementById('skip-auth-btn');
const gameCanvasEl = document.getElementById('game-canvas');
const userPointsEl = document.getElementById('user-points');
const gameListEl = document.getElementById('game-list');
const leaderboardScreenEl = document.getElementById('leaderboard-screen');
const profileScreenEl = document.getElementById('profile-screen');
const leaderboardListEl = document.getElementById('leaderboard-list');
const roomsScreenEl = document.getElementById('rooms-screen');
const serverListEl = document.getElementById('discord-server-list');
const roomsFeedEl = document.getElementById('rooms-feed');
const roomActiveViewEl = document.getElementById('room-active-view');
const roomWelcomeViewEl = document.getElementById('room-welcome-view');
const chatMessagesEl = document.getElementById('chat-messages');
const voiceMembersEl = document.getElementById('voice-members-list');
// Fix for new design - also get new messages container
const newMessagesEl = document.getElementById('chat-messages');
const modalContainerEl = document.getElementById('modal-container');
const gameContainerEl = document.getElementById('game-container');

let currentDiscordRoomId = null;
let isVoiceActive = false;

// Prevent double-tap zoom and multi-touch zoom
document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
    const now = (new Date()).getTime();
    if (now - lastTouchEnd <= 300) e.preventDefault();
    lastTouchEnd = now;
}, false);

// --- Events Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    if (saveUsernameBtn) {
        saveUsernameBtn.onclick = () => {
            const val = usernameInputEl.value.trim();
            if (val.length >= 2) {
                currentUser.name = val;
                localStorage.setItem('user_name', val);
                safeHaptic('medium');
                completeAuth();
            } else {
                usernameInputEl.style.borderColor = 'var(--secondary-color)';
                setTimeout(() => { if(usernameInputEl) usernameInputEl.style.borderColor = ''; }, 1000);
            }
        };
    }

    if (skipAuthBtn) {
        skipAuthBtn.onclick = () => {
            const adjectives = ['Быстрый', 'Смелый', 'Ловкий', 'Грозный', 'Яркий', 'Тихий'];
            const nouns = ['Игрок', 'Тигр', 'Ниндзя', 'Мастер', 'Герой', 'Странник'];
            const randomName = adjectives[Math.floor(Math.random() * adjectives.length)] + ' ' + 
                               nouns[Math.floor(Math.random() * nouns.length)] + ' #' + 
                               Math.floor(Math.random() * 999);
            
            currentUser.name = randomName;
            localStorage.setItem('user_name', randomName);
            safeHaptic('light');
            completeAuth();
        };
    }

    initUser();
    initOnlineCounter();
});

// Helper for safe Haptic Feedback
const safeHaptic = (type = 'light') => {
    try {
        if (tg.isVersionAtLeast('6.1')) {
            if (type === 'success' || type === 'error' || type === 'warning') {
                tg.HapticFeedback.notificationOccurred(type);
            } else {
                tg.HapticFeedback.impactOccurred(type);
            }
        }
    } catch (e) {
        console.warn('HapticFeedback not supported');
    }
};

// Helper for safe BackButton
const safeBackButton = {
    show: () => {
        if (tg.isVersionAtLeast('6.1')) tg.BackButton.show();
    },
    hide: () => {
        if (tg.isVersionAtLeast('6.1')) tg.BackButton.hide();
    }
};

// Telegram Back Button Init
if (tg.isVersionAtLeast('6.1')) {
    tg.BackButton.onClick(() => {
        if (currentMatchId) {
            leaveMatch();
        }
        showLobby();
    });
}

function initUser() {
    const savedName = localStorage.getItem('user_name');
    
    if (tg.initDataUnsafe?.user?.first_name) {
        currentUser.name = tg.initDataUnsafe.user.first_name;
        completeAuth();
    } else if (savedName) {
        currentUser.name = savedName;
        completeAuth();
    } else {
        authScreenEl.classList.remove('hidden');
    }
}

function completeAuth() {
    authScreenEl.classList.add('hidden');
    
    // UI elements for profile removed from header
    
    // Полная синхронизация профиля с Firebase
    const userRef = ref(db, `users/${currentUser.id}`);
    
    // Сначала проверяем, есть ли уже такой пользователь в Firebase
    get(userRef).then((snapshot) => {
        const data = snapshot.val();
        if (data) {
            // Если пользователь уже есть, подгружаем его данные
            currentUser.points = data.points || 0;
            if (userPointsEl) userPointsEl.innerText = currentUser.points;
            
            // Если имя в Firebase и локально отличается - берем из Firebase (как более актуальное)
            if (data.name && data.name !== currentUser.name) {
                currentUser.name = data.name;
                localStorage.setItem('user_name', data.name);
            }
            
            // Обновляем время последнего входа
            update(userRef, { lastLogin: Date.now() });
        } else {
            // Если пользователя нет - регистрируем его (создаем запись)
            set(userRef, {
                name: currentUser.name,
                points: 0,
                createdAt: Date.now(),
                lastLogin: Date.now(),
                platform: tg.initDataUnsafe?.user?.id ? 'telegram' : 'web'
            });
        }
    });

    // Включаем слушатель изменений данных (чтобы очки обновлялись в реальном времени)
    onValue(userRef, (snapshot) => {
        const data = snapshot.val();
        if (data && data.points !== undefined) {
            currentUser.points = data.points;
            if (userPointsEl) userPointsEl.innerText = currentUser.points;
        }
    });

    initOnlineCounter();
}

export const startGame = (gameId) => {
    safeHaptic('medium');
    currentGameId = gameId;
    
    // Прячем лобби и таб-бар
    gameListEl.classList.add('hidden');
    leaderboardScreenEl.classList.add('hidden');
    profileScreenEl.classList.add('hidden');
    gameContainerEl.classList.remove('hidden');
    document.querySelector('.tab-bar').classList.add('hidden');
    safeBackButton.show();
    
    // Запуск конкретной игры с поиском противника
    if (gameId === 'tictactoe') {
        initTicTacToe();
    }
};

export const showLobby = () => {
    gameContainerEl.classList.add('hidden');
    gameListEl.classList.remove('hidden');
    document.querySelector('.tab-bar').classList.remove('hidden'); // Show tab bar back
    gameCanvasEl.innerHTML = '';
    safeBackButton.hide();
    currentGameId = null;
    currentMatchId = null;
};

// --- Tic Tac Toe Logic ---

function initTicTacToe() {
    gameCanvasEl.innerHTML = `
        <div class="ttt-container">
            <div class="game-online-count">
                <span class="pulse-dot"></span>
                Онлайн: <span id="online-count">0</span>
            </div>
            <div id="status">
                <div class="loader"></div>
                <div>Поиск противника...</div>
            </div>
            <div class="ttt-grid" id="ttt-grid">
                ${Array(9).fill(0).map((_, i) => `<div class="cell" data-index="${i}"></div>`).join('')}
            </div>
        </div>
    `;
    
    // Re-bind online count element
    const newOnlineCountEl = document.getElementById('online-count');
    if (newOnlineCountEl) {
        // Initial value
        get(ref(db, 'status/online')).then(snap => {
            const users = snap.val();
            newOnlineCountEl.innerText = users ? Object.keys(users).length : 0;
        });
    }
    
    findMatch();
}

async function findMatch() {
    const waitingRef = ref(db, 'tictactoe/waiting');
    
    const snapshot = await get(waitingRef);
    const waitingPlayers = snapshot.val();
    
    if (waitingPlayers) {
        const opponentId = Object.keys(waitingPlayers)[0];
        if (opponentId !== currentUser.id) {
            // Match found!
            currentMatchId = `${opponentId}_${currentUser.id}`;
            playerSymbol = 'O';
            
            await set(ref(db, `tictactoe/matches/${currentMatchId}`), {
                board: Array(9).fill(''),
                turn: 'X',
                players: {
                    X: opponentId,
                    O: currentUser.id
                },
                status: 'playing',
                winner: null
            });
            
            await remove(ref(db, `tictactoe/waiting/${opponentId}`));
            listenToMatch();
            return;
        }
    }

    // No one waiting or only self, let's wait
    playerSymbol = 'X';
    await set(ref(db, `tictactoe/waiting/${currentUser.id}`), {
        name: currentUser.name,
        joinedAt: Date.now()
    });
    
    onDisconnect(ref(db, `tictactoe/waiting/${currentUser.id}`)).remove();

    // Listen for match creation
    const matchesRef = ref(db, 'tictactoe/matches');
    onValue(matchesRef, (snap) => {
        const matches = snap.val();
        for (let id in matches) {
            if (id.startsWith(currentUser.id) && !currentMatchId) {
                currentMatchId = id;
                listenToMatch();
                break;
            }
        }
    });
}

function listenToMatch() {
    const matchRef = ref(db, `tictactoe/matches/${currentMatchId}`);
    onDisconnect(matchRef).remove();

    onValue(matchRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        updateBoardUI(data.board);
        const statusEl = document.getElementById('status');

        if (data.status === 'playing') {
            statusEl.innerHTML = data.turn === playerSymbol ? '<b>Ваш ход!</b>' : 'Ход противника...';
        } else if (data.status === 'finished') {
            showGameOverModal(data.winner);
            tg.HapticFeedback.notificationOccurred(data.winner === playerSymbol ? 'success' : 'error');
        }
    });

    document.getElementById('ttt-grid').onclick = (e) => {
        const cell = e.target.closest('.cell');
        if (cell) {
            const index = cell.dataset.index;
            makeMove(index);
        }
    };
}

function updateBoardUI(board) {
    const cells = document.querySelectorAll('.cell');
    board.forEach((val, i) => {
        cells[i].innerText = val;
        cells[i].className = `cell ${val.toLowerCase()}`;
    });
}

async function makeMove(index) {
    if (!currentMatchId) return;
    
    const matchRef = ref(db, `tictactoe/matches/${currentMatchId}`);
    const snapshot = await get(matchRef);
    const data = snapshot.val();
    
    if (data.status !== 'playing' || data.turn !== playerSymbol || data.board[index] !== '') {
        return;
    }

    const newBoard = [...data.board];
    newBoard[index] = playerSymbol;
    
    const winner = checkWinner(newBoard);
    const updates = {
        board: newBoard,
        turn: playerSymbol === 'X' ? 'O' : 'X'
    };

    if (winner) {
        updates.status = 'finished';
        updates.winner = winner;
        // Начисление очков за победу
        if (winner === playerSymbol) {
            const newPoints = currentUser.points + 10;
            update(ref(db, `users/${currentUser.id}`), { points: newPoints });
        }
    } else if (!newBoard.includes('')) {
        updates.status = 'finished';
        updates.winner = 'draw';
        // Начисление очков за ничью
        const newPoints = currentUser.points + 5;
        update(ref(db, `users/${currentUser.id}`), { points: newPoints });
    }

    tg.HapticFeedback.impactOccurred('light');
    await update(matchRef, updates);
}

function showGameOverModal(winner) {
    const existing = document.querySelector('.game-over-overlay');
    if (existing) existing.remove();

    let title, subtitle, icon, titleClass;

    if (winner === 'draw') {
        title = 'НИЧЬЯ';
        subtitle = 'Силы равны. Попробуйте еще раз!';
        icon = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM6 12h12"/></svg>';
        titleClass = 'draw';
    } else if (winner === playerSymbol) {
        title = 'ПОБЕДА';
        subtitle = 'Вы оказались быстрее и точнее!';
        icon = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#2ed573" stroke-width="2.5"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17h4v-2.34a1 1 0 0 0-.29-.71l-.71-.71a1 1 0 0 1-.29-.7V10c0-1.1-.9-2-2-2s-2 .9-2 2v2.6c0 .26-.1.51-.29.7l-.71.71a1 1 0 0 0-.29.7z"/></svg>';
        titleClass = 'win';
    } else {
        title = 'ПОРАЖЕНИЕ';
        subtitle = 'Не повезло. Время для реванша?';
        icon = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ff4757" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
        titleClass = 'lose';
    }

    const modal = document.createElement('div');
    modal.className = 'game-over-overlay';
    modal.innerHTML = `
        <div class="game-over-card">
            <div class="game-over-icon-svg">${icon}</div>
            <h2 class="game-over-title ${titleClass}">${title}</h2>
            <p class="game-over-subtitle">${subtitle}</p>
            <div class="game-over-stats">
                <div class="game-over-stat">
                    <span>ВАШ СЧЕТ</span>
                    <strong id="final-your-score">0</strong>
                </div>
                <div class="game-over-stat">
                    <span>СОПЕРНИК</span>
                    <strong id="final-opp-score">0</strong>
                </div>
            </div>
            <button class="lobby-btn" onclick="closeGameOverModal()">В ЛОББИ</button>
        </div>
    `;
    document.body.appendChild(modal);

    // Подгружаем финальный счет в модалку
    const path = getGamePath(currentGameId);
    if (path && currentMatchId) {
        get(ref(db, `${path}/matches/${currentMatchId}`)).then(snap => {
            const data = snap.val();
            if (data && data.scores) {
                const yourScore = data.scores[playerSymbol] || 0;
                const oppSymbol = playerSymbol === 'P1' ? 'P2' : 'P1';
                const oppScore = data.scores[oppSymbol] || 0;
                document.getElementById('final-your-score').innerText = yourScore;
                document.getElementById('final-opp-score').innerText = oppScore;
            }
        });
    }
}

function getGamePath(gameId) {
    if (gameId === 'tictactoe') return 'tictactoe';
    return null;
}

export const closeGameOverModal = () => {
    const modal = document.querySelector('.game-over-overlay');
    if (modal) modal.remove();
    showLobby();
};

function checkWinner(board) {
    const lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
        [0, 4, 8], [2, 4, 6]             // diags
    ];
    for (let line of lines) {
        const [a, b, c] = line;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }
    return null;
}

// --- Emoji Duel Logic ---
function initEmojiDuel() {
    gameCanvasEl.innerHTML = `
        <div class="duel-container">
            <div class="game-online-count">
                <span class="pulse-dot"></span>
                Онлайн: <span id="online-count">0</span>
            </div>
            <div id="duel-status" style="text-align:center; font-weight:700;">
                <div class="loader"></div>
                Поиск соперника...
            </div>
            <div class="duel-players hidden" id="duel-players">
                <div class="duel-player" id="p1-info">
                    <span class="duel-player-name" id="p1-name">?</span>
                    <span class="duel-player-score" id="p1-score">0</span>
                </div>
                <div class="duel-player" id="p2-info">
                    <span class="duel-player-name" id="p2-name">?</span>
                    <span class="duel-player-score" id="p2-score">0</span>
                </div>
            </div>
            <div class="duel-emoji-button disabled" id="emoji-target">⚔️</div>
            <div class="duel-timer hidden" id="duel-timer">READY</div>
        </div>
    `;
    
    findDuelMatch();
}

async function findDuelMatch() {
    const waitingRef = ref(db, 'emojiduel/waiting');
    const snapshot = await get(waitingRef);
    const waitingPlayers = snapshot.val();
    
    if (waitingPlayers) {
        const opponentId = Object.keys(waitingPlayers)[0];
        if (opponentId !== currentUser.id) {
            currentMatchId = `${opponentId}_${currentUser.id}`;
            playerSymbol = 'P2'; // Player 2
            
            await set(ref(db, `emojiduel/matches/${currentMatchId}`), {
                players: {
                    P1: opponentId,
                    P2: currentUser.id,
                    P1_name: waitingPlayers[opponentId].name,
                    P2_name: currentUser.name
                },
                scores: { P1: 0, P2: 0 },
                currentEmoji: '⚔️',
                status: 'starting',
                winner: null,
                lastUpdate: Date.now()
            });
            
            await remove(ref(db, `emojiduel/waiting/${opponentId}`));
            listenToDuel();
            return;
        }
    }

    playerSymbol = 'P1'; // Player 1
    await set(ref(db, `emojiduel/waiting/${currentUser.id}`), {
        name: currentUser.name,
        joinedAt: Date.now()
    });
    
    onDisconnect(ref(db, `emojiduel/waiting/${currentUser.id}`)).remove();

    const matchesRef = ref(db, 'emojiduel/matches');
    onValue(matchesRef, (snap) => {
        const matches = snap.val();
        for (let id in matches) {
            if (id.startsWith(currentUser.id) && !currentMatchId) {
                currentMatchId = id;
                listenToDuel();
                break;
            }
        }
    });
}

function listenToDuel() {
    const matchRef = ref(db, `emojiduel/matches/${currentMatchId}`);
    onDisconnect(matchRef).remove();

    onValue(matchRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        const statusEl = document.getElementById('duel-status');
        const playersEl = document.getElementById('duel-players');
        const emojiBtn = document.getElementById('emoji-target');
        const timerEl = document.getElementById('duel-timer');
        
        if (playersEl) {
            playersEl.classList.remove('hidden');
            document.getElementById('p1-name').innerText = data.players.P1_name;
            document.getElementById('p2-name').innerText = data.players.P2_name;
            document.getElementById('p1-score').innerText = data.scores.P1;
            document.getElementById('p2-score').innerText = data.scores.P2;
            
            document.getElementById('p1-info').classList.toggle('active', data.lastWinner === 'P1');
            document.getElementById('p2-info').classList.toggle('active', data.lastWinner === 'P2');
        }

        if (data.status === 'starting') {
            statusEl.innerText = 'Приготовьтесь...';
            emojiBtn.innerText = '⌛';
            emojiBtn.classList.add('disabled');
            if (playerSymbol === 'P1') {
                setTimeout(() => {
                    update(matchRef, { status: 'playing', currentEmoji: getRandomEmoji() });
                }, 2000);
            }
        } else if (data.status === 'playing') {
            statusEl.innerText = 'ЖМИ НА ЭМОДЗИ!';
            emojiBtn.innerText = data.currentEmoji;
            emojiBtn.classList.remove('disabled');
        } else if (data.status === 'finished') {
            showGameOverModal(data.winner === playerSymbol ? playerSymbol : 'lose');
        }
    });

    document.getElementById('emoji-target').onclick = () => {
        handleDuelClick();
    };
}

async function handleDuelClick() {
    if (!currentMatchId) return;
    const matchRef = ref(db, `emojiduel/matches/${currentMatchId}`);
    const snapshot = await get(matchRef);
    const data = snapshot.val();
    
    if (data.status !== 'playing') return;

    const newScores = { ...data.scores };
    newScores[playerSymbol] += 1;
    
    const updates = {
        scores: newScores,
        lastWinner: playerSymbol,
        lastUpdate: Date.now()
    };

    if (newScores[playerSymbol] >= 10) {
        updates.status = 'finished';
        updates.winner = playerSymbol;
        // Points for win
        const newPoints = currentUser.points + 15;
        update(ref(db, `users/${currentUser.id}`), { points: newPoints });
    } else {
        updates.currentEmoji = getRandomEmoji();
    }

    safeHaptic('light');
    await update(matchRef, updates);
}

function getRandomEmoji() {
    const emojis = ['🔥', '⚡', '💣', '💎', '🌟', '🍀', '🍎', '🍕', '🚀', '🎯', '🎸', '👾'];
    return emojis[Math.floor(Math.random() * emojis.length)];
}

function leaveMatch() {
    if (currentMatchId) {
        let path = '';
        if (currentGameId === 'tictactoe') path = 'tictactoe';
        
        if (path) remove(ref(db, `${path}/matches/${currentMatchId}`));
        currentMatchId = null;
    }
    remove(ref(db, 'tictactoe/waiting/' + currentUser.id));
}

export const switchTab = (tabId) => {
    safeHaptic('light');
    const tabs = document.querySelectorAll('.tab-item');
    const indicator = document.querySelector('.active-indicator');
    
    // Hide all screens
    gameListEl.classList.add('hidden');
    leaderboardScreenEl.classList.add('hidden');
    roomsScreenEl.classList.add('hidden');
    profileScreenEl.classList.add('hidden');
    
    tabs.forEach((tab, index) => {
        tab.classList.remove('active');
        const isTarget = (tabId === 'games' && tab.innerText.includes('Игры')) ||
                         (tabId === 'leaderboard' && tab.innerText.includes('Топ')) ||
                         (tabId === 'rooms' && tab.innerText.includes('Комнаты')) ||
                         (tabId === 'profile' && tab.innerText.includes('Профиль'));
        
        if (isTarget) {
            tab.classList.add('active');
            if (indicator) {
                indicator.style.display = 'block';
                const tabWidth = tab.offsetWidth;
                const tabLeft = tab.offsetLeft;
                indicator.style.width = `${tabWidth - 20}px`;
                indicator.style.left = `${tabLeft + 10}px`;
            }

            // Show target screen
            if (tabId === 'games') gameListEl.classList.remove('hidden');
            if (tabId === 'leaderboard') {
                leaderboardScreenEl.classList.remove('hidden');
                loadLeaderboard();
            }
            if (tabId === 'rooms') {
                roomsScreenEl.classList.remove('hidden');
                loadDiscordRooms();
            }
            if (tabId === 'profile') {
                profileScreenEl.classList.remove('hidden');
                updateProfileUI();
            }
        }
    });
};

// --- Discord Rooms Logic ---

export const openRoomSettings = async () => {
    if (!currentDiscordRoomId) return;
    
    const roomRef = ref(db, `rooms/${currentDiscordRoomId}`);
    const snap = await get(roomRef);
    const room = snap.val();
    const isOwner = room.owner === currentUser.id;
    
    modalContainerEl.classList.remove('hidden');
    modalContainerEl.innerHTML = `
        <div class="modal-card">
            <h2 class="modal-title">Настройки пространства</h2>
            
            <div class="settings-section">
                <span class="settings-label">Громкость голоса</span>
                <input type="range" class="volume-slider" min="0" max="1" step="0.1" value="${localStorage.getItem('voice_volume') || 1}" oninput="setVolume(this.value)">
            </div>
            
            ${isOwner ? `
            <div class="settings-section">
                <span class="settings-label">Название</span>
                <input type="text" id="edit-room-name" class="modal-input" value="${room.name}" maxlength="15">
            </div>
            <div class="settings-section">
                <span class="settings-label">PIN-код</span>
                <input type="tel" id="edit-room-pin" class="modal-input" value="${room.pin || ''}" maxlength="4" placeholder="Нет PIN-кода">
            </div>
            ` : ''}
            
            <div class="modal-btns">
                <button class="modal-btn secondary" onclick="closeModal()">Закрыть</button>
                ${isOwner ? `
                    <button class="modal-btn primary" onclick="updateRoomSettings()">Сохранить</button>
                ` : ''}
            </div>
            
            ${isOwner ? `
                <button class="modal-btn danger" style="margin-top: 12px; width: 100%;" onclick="deleteRoom()">Удалить пространство</button>
            ` : ''}
        </div>
    `;
};

export const setVolume = (val) => {
    localStorage.setItem('voice_volume', val);
    const audios = document.querySelectorAll('#remote-audio-container audio');
    audios.forEach(audio => {
        audio.volume = val;
    });
};

export const updateRoomSettings = async () => {
    const newName = document.getElementById('edit-room-name').value.trim();
    const newPin = document.getElementById('edit-room-pin').value.trim();
    
    if (!newName) return;
    
    const roomRef = ref(db, `rooms/${currentDiscordRoomId}`);
    await update(roomRef, {
        name: newName,
        pin: newPin || null
    });
    
    document.getElementById('active-room-name').innerText = newName;
    closeModal();
    safeHaptic('success');
};

export const deleteRoom = async () => {
    if (!confirm('Вы уверены, что хотите удалить это пространство?')) return;
    
    const roomRef = ref(db, `rooms/${currentDiscordRoomId}`);
    await remove(roomRef);
    
    closeModal();
    leaveDiscordRoom();
    safeHaptic('warning');
};

function loadDiscordRooms() {
    const roomsRef = ref(db, 'rooms');
    onValue(roomsRef, (snapshot) => {
        const rooms = [];
        snapshot.forEach((child) => {
            rooms.push({ id: child.key, ...child.val() });
        });
        renderDiscordSidebar(rooms);
        renderDiscordFeed(rooms);
    });
}

function renderDiscordSidebar(rooms) {
    // Эта функция больше не нужна, так как мы удалили сайдбар
}

function renderDiscordFeed(rooms) {
    if (!roomsFeedEl) return;
    if (rooms.length === 0) {
        roomsFeedEl.innerHTML = `
            <div style="text-align:center; padding: 40px; background: rgba(255,255,255,0.02); border-radius: 20px; border: 1px dashed rgba(255,255,255,0.1);">
                <p style="color:var(--hint-color); font-size: 14px;">Пока пусто. Создайте пространство!</p>
            </div>`;
        return;
    }
    roomsFeedEl.innerHTML = rooms.map(room => `
        <div class="room-glass-card" onclick="joinDiscordRoom('${room.id}')">
            <h4>${room.name}</h4>
            <div class="room-glass-info">
                <div class="room-glass-meta">
                    <span class="meta-item live">LIVE</span>
                    <span class="meta-item">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="margin-right:4px;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>
                        ${Object.keys(room.players || {}).length}
                    </span>
                    ${room.pin ? '<span class="meta-item">🔒</span>' : ''}
                </div>
            </div>
        </div>
    `).join('');
}

export const joinDiscordRoom = async (roomId) => {
    console.log('🔥 Joining Discord room:', roomId);
    console.log('🔥 Current user:', currentUser);
    console.log('🔥 Firebase DB initialized:', !!db);
    
    const roomRef = ref(db, `rooms/${roomId}`);
    const snap = await get(roomRef);
    const room = snap.val();
    console.log('🔥 Room data:', room);

    if (!room) {
        alert('Пространство не найдено или было удалено');
        return;
    }

    if (room.pin) {
        const pin = prompt('Введите PIN-код для входа:');
        if (pin !== room.pin) {
            alert('Неверный код доступа!');
            return;
        }
    }

    currentDiscordRoomId = roomId;
    console.log('🔥 Set currentDiscordRoomId to:', currentDiscordRoomId);

    // Прячем ленту комнат и показываем активную комнату
    roomWelcomeViewEl.classList.add('hidden');
    roomActiveViewEl.classList.remove('hidden');
    
    // Обновляем название комнаты если элемент существует
    const roomNameEl = document.getElementById('active-room-name');
    if (roomNameEl) {
        roomNameEl.innerText = room.name;
    }

    // Скрываем таб-бар в активной комнате
    const tabBar = document.querySelector('.tab-bar');
    if (tabBar) tabBar.style.display = 'none';

    initVoiceCommunication(roomId);

    // Добавляем игрока в Firebase комнаты
    const playerRef = ref(db, `rooms/${roomId}/players/${currentUser.id}`);
    await update(playerRef, {
        name: currentUser.name,
        lastSeen: Date.now(),
        isVoice: false
    });

    onDisconnect(playerRef).remove();
    console.log('🔥 Player added to room');

    console.log('🔥 Starting real-time listeners...');
    listenToChat(roomId);
    listenToVoice(roomId);
    console.log('🔥 Room joined successfully');
};

function listenToChat(roomId) {
    console.log('🔥 Starting to listen to chat for room:', roomId);
    console.log('🔥 Firebase DB available:', !!db);
    console.log('🔥 Full Firebase path:', `rooms/${roomId}/messages`);
    
    if (!db) {
        console.error('🔥 Firebase not initialized - cannot listen to chat');
        return;
    }
    
    const chatRef = ref(db, `rooms/${roomId}/messages`);
    console.log('🔥 Chat reference created:', chatRef.toString());
    
    onValue(chatRef, (snapshot) => {
        console.log('🔥 Chat snapshot received!');
        console.log('🔥 Snapshot exists:', snapshot.exists());
        console.log('🔥 Snapshot size:', snapshot.size);
        
        const msgs = [];
        snapshot.forEach(child => {
            const msg = child.val();
            if (msg) {
                msgs.push({ id: child.key, ...msg });
                console.log('🔥 Message found:', { id: child.key, ...msg });
            }
        });
        
        console.log('🔥 Total messages to render:', msgs.length);
        console.log('🔥 Messages data:', msgs);
        renderMessages(msgs);
    }, (error) => {
        console.error('🔥 Error listening to chat:', error);
        console.error('🔥 Error details:', error.code, error.message);
    });
}

function renderMessages(msgs) {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) {
        console.error('🔥 Messages container not found');
        return;
    }
    
    console.log('🔥 Rendering messages:', msgs.length, 'messages');
    
    if (msgs.length === 0) {
        messagesContainer.innerHTML = '<div style="text-align: center; color: rgba(255,255,255,0.3); padding: 20px;">Нет сообщений</div>';
        return;
    }
    
    // Сортируем сообщения по времени
    const sortedMsgs = msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    
    messagesContainer.innerHTML = sortedMsgs.map(m => {
        const isSelf = m.userId === currentUser.id;
        const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
        
        console.log('🔥 Rendering message:', { text: m.text, userId: m.userId, isSelf, userName: m.userName });
        
        return `
            <div class="new-message ${isSelf ? 'self' : 'other'}">
                ${!isSelf ? `<span class="new-message-sender">${m.userName || 'Anonymous'}</span>` : ''}
                <div class="new-message-bubble">
                    ${m.text || ''}
                    ${time ? `<span class="new-message-time">${time}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
    
    // Scroll to bottom
    setTimeout(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, 100);
    
    console.log('🔥 Messages rendered and scrolled to bottom');
}

// Export functions for global access
// All functions are available globally via window object

// Make functions global for onclick handlers
window.sendChatMessage = async () => {
    console.log('🔥 sendChatMessage called');
    const input = document.getElementById('chat-input');
    console.log('🔥 Input element:', input);
    
    if (!input) {
        console.error('🔥 Chat input not found');
        return;
    }
    
    const text = input.value.trim();
    console.log('🔥 Text:', text, 'Room ID:', currentDiscordRoomId, 'User:', currentUser);
    
    if (!text) {
        console.log('🔥 No text, returning');
        return;
    }
    
    if (!currentDiscordRoomId) {
        console.log('🔥 No room ID, showing test message locally');
        // Show test message locally if no room
        const messagesContainer = document.getElementById('chat-messages');
        if (messagesContainer) {
            const testMsg = document.createElement('div');
            testMsg.className = 'new-message self';
            testMsg.innerHTML = `
                <div class="new-message-bubble">
                    ${text}
                    <span class="new-message-time">${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
            `;
            messagesContainer.appendChild(testMsg);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        input.value = '';
        return;
    }
    
    try {
        console.log('🔥 Sending message to Firebase...');
        console.log('🔥 Firebase DB available:', !!db);
        console.log('🔥 Current room ID:', currentDiscordRoomId);
        console.log('🔥 Current user:', currentUser);
        
        if (!db) {
            throw new Error('Firebase not initialized');
        }
        
        if (!currentDiscordRoomId) {
            throw new Error('No active room');
        }
        
        const chatRef = ref(db, `rooms/${currentDiscordRoomId}/messages`);
        console.log('🔥 Chat reference:', chatRef.toString());
        
        const messageData = {
            userId: currentUser.id,
            userName: currentUser.name || 'Anonymous',
            text: text,
            timestamp: Date.now()
        };
        
        console.log('🔥 Message data prepared:', messageData);
        console.log('🔥 Firebase path:', `rooms/${currentDiscordRoomId}/messages`);
        
        const result = await push(chatRef, messageData);
        console.log('🔥 Message pushed to Firebase successfully!');
        console.log('🔥 New message key:', result.key);
        
        input.value = '';
        console.log('🔥 Input cleared');
        
        // Test immediate read-back
        console.log('🔥 Testing immediate read-back...');
        const testRead = await get(chatRef);
        console.log('🔥 Read-back test - messages count:', testRead.size);
        
    } catch (error) {
        console.error('🔥 Error sending to Firebase:', error);
        console.error('🔥 Error stack:', error.stack);
        alert('Ошибка отправки сообщения: ' + error.message);
    }
};

window.toggleMute = () => {
    console.log('🔥 Toggle mute clicked');
    
    // Mute/unmute all remote audio streams
    Object.values(audioElements).forEach(audio => {
        if (audio.muted) {
            audio.muted = false;
            console.log('🔥 Audio unmuted');
        } else {
            audio.muted = true;
            console.log('🔥 Audio muted');
        }
    });
    
    // Update button state
    const muteBtn = document.querySelector('[onclick="toggleMute()"]');
    if (muteBtn) {
        muteBtn.classList.toggle('muted');
    }
};

window.setVolume = (volume) => {
    console.log('🔥 Setting volume to:', volume);
    localStorage.setItem('voice_volume', volume);
    
    Object.values(audioElements).forEach(audio => {
        audio.volume = volume;
    });
};

// Make toggleVoice globally available
// window.toggleVoice will be set after function definition

// Make switchTab globally available
window.switchTab = switchTab;

window.leaveRoom = () => {
    console.log('🔥 Leaving room:', currentDiscordRoomId);
    
    if (!currentDiscordRoomId) {
        console.log('🔥 No room to leave');
        return;
    }
    
    // Очищаем голосовой чат
    cleanupVoice();
    
    // Удаляем пользователя из комнаты
    const playerRef = ref(db, `rooms/${currentDiscordRoomId}/players/${currentUser.id}`);
    remove(playerRef).then(() => {
        console.log('🔥 Successfully left room');
    }).catch((error) => {
        console.error('🔥 Error leaving room:', error);
    });
    
    // Сбрасываем ID комнаты
    currentDiscordRoomId = null;
    
    // Показываем список комнат и скрываем активную комнату
    if (roomWelcomeViewEl) roomWelcomeViewEl.classList.remove('hidden');
    if (roomActiveViewEl) roomActiveViewEl.classList.add('hidden');
    
    // Показываем таб-бар обратно
    const tabBar = document.querySelector('.tab-bar');
    if (tabBar) tabBar.style.display = '';
    
    console.log('🔥 Room left successfully');
};

// Simple test function to check Firebase connection
window.testFirebase = () => {
    console.log('🔥 Testing Firebase connection...');
    console.log('🔥 DB object:', !!db);
    console.log('🔥 Current user:', currentUser);
    console.log('🔥 Current room ID:', currentDiscordRoomId);
    
    if (!db) {
        console.error('🔥 Firebase not initialized!');
        alert('Firebase не инициализирован. Проверьте подключение к интернету.');
        return;
    }
    
    if (currentDiscordRoomId) {
        console.log('🔥 Testing chat functionality...');
        const chatRef = ref(db, `rooms/${currentDiscordRoomId}/messages`);
        
        // Test write
        const testMessage = {
            userId: currentUser.id,
            userName: currentUser.name || 'Test User',
            text: 'Test message - ' + new Date().toLocaleTimeString(),
            timestamp: Date.now()
        };
        
        push(chatRef, testMessage).then((result) => {
            console.log('🔥 Test message sent with key:', result.key);
            
            // Test read
            setTimeout(() => {
                get(chatRef).then((snapshot) => {
                    console.log('🔥 Chat read test - messages count:', snapshot.size);
                    snapshot.forEach(child => {
                        console.log('🔥 Message in chat:', child.val());
                    });
                });
            }, 1000);
            
        }).catch(error => {
            console.error('🔥 Chat test failed:', error);
        });
    } else {
        console.log('🔥 No room ID - testing basic connection');
        const testRef = ref(db, 'test');
        set(testRef, {
            message: 'Connection test',
            timestamp: Date.now()
        }).then(() => {
            console.log('🔥 Basic Firebase connection successful');
            remove(testRef);
        }).catch(error => {
            console.error('🔥 Basic Firebase test failed:', error);
            alert('Ошибка подключения к Firebase: ' + error.message);
        });
    }
};

// Force refresh chat
window.refreshChat = () => {
    console.log('🔥 Force refreshing chat...');
    if (currentDiscordRoomId) {
        listenToChat(currentDiscordRoomId);
    } else {
        console.log('🔥 No room to refresh chat');
    }
};

// Test voice chat functionality
window.testVoice = () => {
    console.log('🔥 Testing voice chat...');
    console.log('🔥 PeerJS available:', typeof Peer !== 'undefined');
    console.log('🔥 myPeer:', !!myPeer);
    console.log('🔥 myStream:', !!myStream);
    console.log('🔥 isVoiceActive:', isVoiceActive);
    console.log('🔥 currentDiscordRoomId:', currentDiscordRoomId);
    
    if (myPeer) {
        console.log('🔥 Peer ID:', myPeer.id);
        console.log('🔥 Peer open:', myPeer.open);
        console.log('🔥 Peer connections:', Object.keys(peers));
    }
    
    if (myStream) {
        console.log('🔥 Stream tracks:', myStream.getTracks().length);
        myStream.getTracks().forEach(track => {
            console.log('🔥 Track:', track.kind, track.label, track.enabled);
        });
    }
};

// Ensure leaveRoom is available globally
window.leaveRoom = window.leaveRoom || (() => {
    console.log('🔥 Fallback leaveRoom called');
    if (currentDiscordRoomId) {
        currentDiscordRoomId = null;
        if (roomWelcomeViewEl) roomWelcomeViewEl.classList.remove('hidden');
        if (roomActiveViewEl) roomActiveViewEl.classList.add('hidden');
        const tabBar = document.querySelector('.tab-bar');
        if (tabBar) tabBar.style.display = '';
    }
});

// Ensure switchTab is available globally
window.switchTab = window.switchTab || ((tabName) => {
    console.log('🔥 Switching to tab:', tabName);
    
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
    });
    
    // Remove active from all tabs
    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Show selected tab content
    const selectedContent = document.getElementById(tabName + '-tab');
    if (selectedContent) {
        selectedContent.classList.remove('hidden');
    }
    
    // Add active to selected tab
    const selectedTab = document.querySelector(`[data-tab="${tabName}"]`);
    if (selectedTab) {
        selectedTab.classList.add('active');
    }
});

// Final fallback to ensure switchTab is always available
if (!window.switchTab) {
    window.switchTab = function(tabName) {
        console.log('🔥 Fallback switchTab called:', tabName);
        // Basic tab switching logic
        document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
        const target = document.getElementById(tabName + '-tab');
        if (target) target.classList.remove('hidden');
    };
}

// Old event listener removed - using inline function in HTML

function listenToVoice(roomId) {
    console.log('🔥 Starting to listen to voice participants for room:', roomId);
    const playersRef = ref(db, `rooms/${roomId}/players`);
    
    onValue(playersRef, (snapshot) => {
        console.log('🔥 Players snapshot received:', snapshot.exists());
        const members = [];
        snapshot.forEach(child => {
            const player = child.val();
            if (player) {
                members.push({ id: child.key, ...player });
                console.log('🔥 Player found:', { id: child.key, ...player });
            }
        });
        console.log('🔥 Total members to render:', members.length);
        renderVoiceMembers(members);
    }, (error) => {
        console.error('🔥 Error listening to players:', error);
    });
}

function renderVoiceMembers(members) {
    if (!voiceMembersEl) return;
    
    // Generate beautiful avatars with gradients and icons
    const avatarStyles = [
        { bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', icon: '👤' },
        { bg: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', icon: '🎭' },
        { bg: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', icon: '🎨' },
        { bg: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', icon: '🌟' },
        { bg: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', icon: '🎪' },
        { bg: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)', icon: '🎯' }
    ];
    
    voiceMembersEl.innerHTML = members.map((m, index) => {
        const style = avatarStyles[index % avatarStyles.length];
        const firstLetter = m.name.charAt(0).toUpperCase();
        const isSpeaking = m.isVoice;
        
        return `
            <div class="new-participant ${isSpeaking ? 'speaking' : ''}" title="${m.name}">
                <div class="new-participant-avatar" style="background: ${style.bg}">
                    ${firstLetter}
                </div>
                <span class="new-participant-name">${m.name}</span>
            </div>
        `;
    }).join('');
    
    // Add speaking animation dynamically
    members.forEach((m, index) => {
        if (m.isVoice) {
            const participantEl = voiceMembersEl.children[index];
            if (participantEl) {
                participantEl.classList.add('speaking');
            }
        }
    });
}

// --- Real-time Voice (WebRTC) Logic ---
let myPeer;
let myStream;
const peers = {};
const audioElements = {};

// Initialize PeerJS for P2P connections
function initializePeer() {
    console.log('🔥 Initializing PeerJS...');
    console.log('🔥 Peer class available:', typeof Peer !== 'undefined');
    
    if (typeof Peer === 'undefined') {
        console.error('🔥 PeerJS not loaded - checking CDN...');
        // Try to load PeerJS from CDN if not available
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';
        script.onload = () => {
            console.log('🔥 PeerJS loaded from CDN');
            // Retry initialization after script loads
            setTimeout(() => {
                myPeer = initializePeer();
            }, 500);
        };
        script.onerror = () => {
            console.error('🔥 Failed to load PeerJS from CDN');
        };
        document.head.appendChild(script);
        return null;
    }
    
    try {
        console.log('🔥 Creating peer with ID:', currentUser.id);
        
        // Use public PeerJS server if no server specified
        const peerConfig = {
            debug: 2,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            }
        };
        
        myPeer = new Peer(currentUser.id, peerConfig);
        
        myPeer.on('open', (id) => {
            console.log('🔥 My peer ID is:', id);
            console.log('🔥 Peer connection opened successfully');
        });
        
        myPeer.on('call', (call) => {
            console.log('🔥 Receiving call from:', call.peer);
            
            if (!myStream) {
                console.warn('🔥 No local stream to answer call');
                return;
            }
            
            call.answer(myStream);
            
            call.on('stream', (userAudioStream) => {
                console.log('🔥 Received stream from:', call.peer);
                addAudioStream(call.peer, userAudioStream);
            });
            
            call.on('close', () => {
                console.log('🔥 Call closed with:', call.peer);
                removeAudioStream(call.peer);
            });
            
            call.on('error', (error) => {
                console.error('🔥 Call error:', error);
            });
            
            peers[call.peer] = call;
        });
        
        myPeer.on('error', (error) => {
            console.error('🔥 Peer error:', error);
            console.error('🔥 Peer error type:', error.type);
            console.error('🔥 Peer error details:', error);
        });
        
        myPeer.on('disconnected', () => {
            console.log('🔥 Peer disconnected');
        });
        
        myPeer.on('close', () => {
            console.log('🔥 Peer connection closed');
        });
        
        console.log('🔥 Peer instance created successfully');
        return myPeer;
        
    } catch (error) {
        console.error('🔥 Error initializing peer:', error);
        console.error('🔥 Peer initialization error details:', error.message);
        return null;
    }
}

function initVoiceCommunication(roomId) {
    console.log('🔥 Initializing voice communication for room:', roomId);
    
    // Initialize PeerJS
    myPeer = initializePeer();
    if (!myPeer) {
        console.log('🔥 Voice chat disabled - PeerJS not available');
        return;
    }
    
    // Listen for new users joining voice
    const playersRef = ref(db, `rooms/${roomId}/players`);
    onValue(playersRef, (snapshot) => {
        // КРИТИЧЕСКИ ВАЖНО: Не звоним никому, пока у нас нет своего потока (микрофон выключен)
        if (!isVoiceActive || !myStream) {
            return;
        }

        const players = snapshot.val() || {};
        Object.keys(players).forEach(userId => {
            if (userId !== currentUser.id && players[userId].isVoice && !peers[userId]) {
                console.log('🔥 New voice user detected, attempting to connect:', userId);
                connectToNewUser(userId, myStream);
            }
        });
    });
}

function connectToNewUser(userId, stream) {
    console.log('🔥 connectToNewUser called with:', { userId, stream: !!stream, myPeer: !!myPeer });
    
    if (!myPeer) {
        console.error('🔥 Cannot connect - myPeer is null');
        console.log('🔥 Attempting to initialize peer...');
        myPeer = initializePeer();
        if (!myPeer) {
            console.error('🔥 Failed to initialize peer');
            return;
        }
        
        // Wait a bit for peer to initialize
        setTimeout(() => {
            if (myPeer && myPeer.open) {
                console.log('🔥 Peer initialized, retrying connection to:', userId);
                connectToNewUser(userId, stream);
            }
        }, 1000);
        return;
    }
    
    if (!stream) {
        console.error('🔥 Cannot connect - stream is null');
        return;
    }
    
    if (!myPeer.open) {
        console.error('🔥 Cannot connect - peer is not open yet');
        // Wait for peer to open and retry
        myPeer.on('open', () => {
            console.log('🔥 Peer opened, connecting to user:', userId);
            connectToNewUser(userId, stream);
        });
        return;
    }
    
    console.log('🔥 Calling user:', userId);
    const call = myPeer.call(userId, stream);
    
    if (!call) {
        console.error('🔥 Failed to create call to user:', userId);
        return;
    }
    
    call.on('stream', (userAudioStream) => {
        console.log('🔥 Received stream from user:', userId);
        addAudioStream(userId, userAudioStream);
    });
    
    call.on('close', () => {
        console.log('🔥 Call with user closed:', userId);
        removeAudioStream(userId);
    });
    
    call.on('error', (error) => {
        console.error('🔥 Call error with user:', userId, error);
    });
    
    peers[userId] = call;
    console.log('🔥 Call established with user:', userId);
}

function addAudioStream(userId, stream) {
    // Remove existing audio element if any
    removeAudioStream(userId);
    
    const audio = document.createElement('audio');
    audio.id = `audio-${userId}`;
    audio.autoplay = true;
    audio.srcObject = stream;
    
    // Set volume from localStorage or default
    audio.volume = parseFloat(localStorage.getItem('voice_volume') || '0.5');
    
    // Add to hidden container
    let container = document.getElementById('remote-audio-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'remote-audio-container';
        container.style.display = 'none';
        document.body.appendChild(container);
    }
    
    container.appendChild(audio);
    audioElements[userId] = audio;
    
    console.log('🔥 Audio stream added for user:', userId);
}

function removeAudioStream(userId) {
    const audio = document.getElementById(`audio-${userId}`);
    if (audio) {
        audio.remove();
    }
    delete audioElements[userId];
    
    // Close peer connection
    if (peers[userId]) {
        peers[userId].close();
        delete peers[userId];
    }
    
    console.log('🔥 Audio stream removed for user:', userId);
}

function cleanupVoice() {
    console.log('🔥 Cleaning up voice communication');
    
    // Stop local stream
    if (myStream) {
        myStream.getTracks().forEach(track => track.stop());
        myStream = null;
    }
    
    // Close all peer connections
    Object.values(peers).forEach(peer => peer.close());
    Object.keys(peers).forEach(userId => removeAudioStream(userId));
    
    // Close peer
    if (myPeer) {
        myPeer.destroy();
        myPeer = null;
    }
    
    isVoiceActive = false;
}

export const toggleVoice = async () => {
    if (!currentDiscordRoomId) return;
    
    const btn = document.getElementById('voice-toggle-btn');
    if (!btn) {
        console.error('🔥 Voice toggle button not found');
        return;
    }
    
    if (!isVoiceActive) {
        try {
            console.log('🔥 Requesting microphone access...');
            
            // Запрашиваем микрофон
            myStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });
            
            console.log('🔥 Microphone access granted');
            
            // Инициализируем PeerJS если еще не инициализирован
            if (!myPeer) {
                myPeer = initializePeer();
                if (!myPeer) {
                    throw new Error('Failed to initialize PeerJS');
                }
                
                // Ждем подключения к PeerJS серверу
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('PeerJS connection timeout')), 10000);
                    myPeer.on('open', () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                });
            }
            
            isVoiceActive = true;
            btn.classList.add('active');
            
            // Обновляем статус в Firebase
            const userRef = ref(db, `rooms/${currentDiscordRoomId}/players/${currentUser.id}`);
            await update(userRef, {
                isVoice: true,
                name: currentUser.name,
                peerId: currentUser.id
            });
            
            console.log('🔥 Voice activated, connecting to other users...');
            
            // Подключаемся к другим активным пользователям
            const playersRef = ref(db, `rooms/${currentDiscordRoomId}/players`);
            const snapshot = await get(playersRef);
            const players = snapshot.val() || {};
            
            Object.keys(players).forEach(userId => {
                if (userId !== currentUser.id && players[userId].isVoice) {
                    console.log('🔥 Connecting to user:', userId);
                    connectToNewUser(userId, myStream);
                }
            });
            
            console.log('🔥 Voice chat fully activated');
            
        } catch (error) {
            console.error('🔥 Failed to activate voice:', error);
            alert('Не удалось получить доступ к микрофону или подключиться к голосовому чату: ' + error.message);
            
            // Очистка при ошибке
            if (myStream) {
                myStream.getTracks().forEach(track => track.stop());
                myStream = null;
            }
        }
    } else {
        console.log('🔥 Deactivating voice...');
        
        // Выключаем микрофон
        if (myStream) {
            myStream.getTracks().forEach(track => track.stop());
            myStream = null;
        }
        
        isVoiceActive = false;
        btn.classList.remove('active');
        
        // Обновляем статус в Firebase
        const userRef = ref(db, `rooms/${currentDiscordRoomId}/players/${currentUser.id}`);
        await update(userRef, {
            isVoice: false,
            name: currentUser.name
        });
        
        // Закрываем все соединения
        Object.values(peers).forEach(peer => peer.close());
        Object.keys(peers).forEach(userId => removeAudioStream(userId));
        
        console.log('🔥 Voice deactivated');
    }
    
    const playerRef = ref(db, `rooms/${currentDiscordRoomId}/players/${currentUser.id}`);
    await update(playerRef, { isVoice: isVoiceActive });
};

// Make toggleVoice globally available after definition
window.toggleVoice = toggleVoice;


export const leaveDiscordRoom = () => {
    if (currentDiscordRoomId) {
        remove(ref(db, `rooms/${currentDiscordRoomId}/players/${currentUser.id}`));
    }
    cleanupVoice();
    currentDiscordRoomId = null;
    isVoiceActive = false;
    roomActiveViewEl.classList.add('hidden');
    roomWelcomeViewEl.classList.remove('hidden');

    // Показываем таб-бар при выходе из комнаты
    const tabBar = document.querySelector('.tab-bar');
    if (tabBar) tabBar.style.display = 'flex';

    loadDiscordRooms();
};

export const openCreateRoomModal = () => {
    modalContainerEl.classList.remove('hidden');
    modalContainerEl.innerHTML = `
        <div class="modal-card">
            <h2 class="modal-title">Создать сервер</h2>
            <input type="text" id="room-name-input" class="modal-input" placeholder="Название сервера" maxlength="15">
            <input type="tel" id="room-pin-input" class="modal-input" placeholder="PIN (необязательно)" maxlength="4">
            <div class="modal-btns">
                <button class="modal-btn secondary" onclick="closeModal()">Отмена</button>
                <button class="modal-btn primary" onclick="processCreateRoom()">Создать</button>
            </div>
        </div>
    `;
};

export const closeModal = () => {
    modalContainerEl.classList.add('hidden');
    modalContainerEl.innerHTML = '';
};

export const processCreateRoom = async () => {
    const name = document.getElementById('room-name-input').value.trim() || 'Новый сервер';
    const pin = document.getElementById('room-pin-input').value.trim();
    
    const roomsRef = ref(db, 'rooms');
    const newRoomRef = push(roomsRef);
    
    await set(newRoomRef, {
        name: name,
        pin: pin || null,
        owner: currentUser.id,
        createdAt: Date.now()
    });
    
    closeModal();
    joinDiscordRoom(newRoomRef.key);
};

function loadLeaderboard() {
    const usersRef = ref(db, 'users');
    // Filter by points > 0 to show only active players
    const leaderboardQuery = query(usersRef, orderByChild('points'), startAt(1), limitToLast(50));
    
    onValue(leaderboardQuery, (snapshot) => {
        const users = [];
        snapshot.forEach((child) => {
            const userData = child.val();
            // Double check points just in case startAt behaves unexpectedly
            if (userData.points && userData.points > 0) {
                users.push({ id: child.key, ...userData });
            }
        });
        
        // Firebase returns ascending, we need descending
        users.reverse();
        
        renderLeaderboard(users);
    });
}

function renderLeaderboard(users) {
    if (!leaderboardListEl) return;
    
    if (users.length === 0) {
        leaderboardListEl.innerHTML = '<p style="text-align:center; padding:20px; color:var(--hint-color);">Пока здесь пусто...</p>';
        return;
    }
    
    leaderboardListEl.innerHTML = users.map((user, index) => `
        <div class="leaderboard-item ${index < 3 ? 'top-' + (index + 1) : ''}">
            <div class="rank">${index + 1}</div>
            <div class="lb-avatar">${user.name ? user.name.charAt(0).toUpperCase() : '?'}</div>
            <div class="lb-info">
                <div class="lb-name">${user.name || 'Аноним'}</div>
            </div>
            <div class="lb-points">${user.points || 0}</div>
        </div>
    `).join('');
}

function updateProfileUI() {
    const profileNameEl = document.getElementById('profile-name');
    const profilePointsEl = document.getElementById('profile-points');
    const profileAvatarEl = document.getElementById('profile-avatar-large');
    
    if (profileNameEl) profileNameEl.innerText = currentUser.name;
    if (profilePointsEl) profilePointsEl.innerText = currentUser.points;
    if (profileAvatarEl) profileAvatarEl.innerText = currentUser.name.charAt(0).toUpperCase();
}

// Initialize indicator position on load
// Удалено из app.js, так как инициализация перенесена в index.html
// document.addEventListener('DOMContentLoaded', () => {
//     setTimeout(() => switchTab('games'), 100);
// });

// --- Color Catch Logic ---
function initColorCatch() {
    gameCanvasEl.innerHTML = `
        <div class="color-container">
            <div class="game-online-count">
                <span class="pulse-dot"></span>
                Онлайн: <span id="online-count">0</span>
            </div>
            <div id="color-status" style="text-align:center; font-weight:700;">
                <div class="loader"></div>
                Поиск соперника...
            </div>
            <div class="duel-players hidden" id="color-players">
                <div class="duel-player" id="cp1-info">
                    <span class="duel-player-name" id="cp1-name">?</span>
                    <span class="duel-player-score" id="cp1-score">0</span>
                </div>
                <div class="duel-player" id="cp2-info">
                    <span class="duel-player-name" id="cp2-name">?</span>
                    <span class="duel-player-score" id="cp2-score">0</span>
                </div>
            </div>
            <div class="color-word-display" id="color-target">ГОТОВЫ?</div>
            <div class="color-buttons-grid disabled" id="color-grid">
                <div class="color-btn red" onclick="handleColorClick('red')"></div>
                <div class="color-btn blue" onclick="handleColorClick('blue')"></div>
                <div class="color-btn green" onclick="handleColorClick('green')"></div>
                <div class="color-btn yellow" onclick="handleColorClick('yellow')"></div>
            </div>
        </div>
    `;
    
    findColorMatch();
}

async function findColorMatch() {
    const waitingRef = ref(db, 'colorcatch/waiting');
    const snapshot = await get(waitingRef);
    const waitingPlayers = snapshot.val();
    
    if (waitingPlayers) {
        const opponentId = Object.keys(waitingPlayers)[0];
        if (opponentId !== currentUser.id) {
            currentMatchId = `${opponentId}_${currentUser.id}`;
            playerSymbol = 'P2';
            
            await set(ref(db, `colorcatch/matches/${currentMatchId}`), {
                players: {
                    P1: opponentId,
                    P2: currentUser.id,
                    P1_name: waitingPlayers[opponentId].name,
                    P2_name: currentUser.name
                },
                scores: { P1: 0, P2: 0 },
                currentWord: 'ЖДИ',
                currentColor: 'white',
                status: 'starting',
                winner: null,
                lastUpdate: Date.now()
            });
            
            await remove(ref(db, `colorcatch/waiting/${opponentId}`));
            listenToColorCatch();
            return;
        }
    }

    playerSymbol = 'P1';
    await set(ref(db, `colorcatch/waiting/${currentUser.id}`), {
        name: currentUser.name,
        joinedAt: Date.now()
    });
    
    onDisconnect(ref(db, `colorcatch/waiting/${currentUser.id}`)).remove();

    const matchesRef = ref(db, 'colorcatch/matches');
    onValue(matchesRef, (snap) => {
        const matches = snap.val();
        for (let id in matches) {
            if (id.startsWith(currentUser.id) && !currentMatchId) {
                currentMatchId = id;
                listenToColorCatch();
                break;
            }
        }
    });
}

function listenToColorCatch() {
    const matchRef = ref(db, `colorcatch/matches/${currentMatchId}`);
    onDisconnect(matchRef).remove();

    onValue(matchRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        const statusEl = document.getElementById('color-status');
        const playersEl = document.getElementById('color-players');
        const targetEl = document.getElementById('color-target');
        const gridEl = document.getElementById('color-grid');
        
        if (playersEl) {
            playersEl.classList.remove('hidden');
            document.getElementById('cp1-name').innerText = data.players.P1_name;
            document.getElementById('cp2-name').innerText = data.players.P2_name;
            document.getElementById('cp1-score').innerText = data.scores.P1;
            document.getElementById('cp2-score').innerText = data.scores.P2;
        }

        if (data.status === 'starting') {
            statusEl.innerText = 'Приготовьтесь...';
            targetEl.innerText = '...';
            targetEl.style.color = 'white';
            gridEl.classList.add('disabled');
            if (playerSymbol === 'P1') {
                setTimeout(() => {
                    const next = getRandomColorTask();
                    update(matchRef, { 
                        status: 'playing', 
                        currentWord: next.word, 
                        currentColor: next.color,
                        correctColor: next.correct 
                    });
                }, 2000);
            }
        } else if (data.status === 'playing') {
            statusEl.innerText = 'НАЖМИ ЦВЕТ ТЕКСТА!';
            targetEl.innerText = data.currentWord;
            targetEl.style.color = getColorValue(data.currentColor);
            gridEl.classList.remove('disabled');
        } else if (data.status === 'finished') {
            showGameOverModal(data.winner === playerSymbol ? playerSymbol : 'lose');
        }
    });
}

export async function handleColorClick(clickedColor) {
    if (!currentMatchId) return;
    const matchRef = ref(db, `colorcatch/matches/${currentMatchId}`);
    const snapshot = await get(matchRef);
    const data = snapshot.val();
    
    if (data.status !== 'playing') return;

    const newScores = { ...data.scores };
    const isCorrect = clickedColor === data.correctColor;
    
    if (isCorrect) {
        newScores[playerSymbol] += 1;
        safeHaptic('success');
    } else {
        newScores[playerSymbol] = Math.max(0, newScores[playerSymbol] - 1);
        safeHaptic('error');
    }
    
    const updates = {
        scores: newScores,
        lastUpdate: Date.now()
    };

    if (newScores[playerSymbol] >= 10) {
        updates.status = 'finished';
        updates.winner = playerSymbol;
        const newPoints = currentUser.points + 20;
        update(ref(db, `users/${currentUser.id}`), { points: newPoints });
    } else {
        const next = getRandomColorTask();
        updates.currentWord = next.word;
        updates.currentColor = next.color;
        updates.correctColor = next.correct;
    }

    await update(matchRef, updates);
}

function getRandomColorTask() {
    const colors = [
        { name: 'КРАСНЫЙ', id: 'red' },
        { name: 'СИНИЙ', id: 'blue' },
        { name: 'ЗЕЛЕНЫЙ', id: 'green' },
        { name: 'ЖЕЛТЫЙ', id: 'yellow' }
    ];
    
    const wordIdx = Math.floor(Math.random() * colors.length);
    let colorIdx;
    do {
        colorIdx = Math.floor(Math.random() * colors.length);
    } while (colorIdx === wordIdx); // Всегда разные слово и цвет для сложности
    
    return {
        word: colors[wordIdx].name,
        color: colors[colorIdx].id,
        correct: colors[wordIdx].id // Нужно нажать цвет, который НАПИСАН
    };
}

function getColorValue(id) {
    const map = {
        'red': '#ff4757',
        'blue': '#2e86de',
        'green': '#2ed573',
        'yellow': '#eab000',
        'white': '#ffffff'
    };
    return map[id] || id;
}

// --- Math Battle Logic ---
function initMathBattle() {
    gameCanvasEl.innerHTML = `
        <div class="math-container">
            <div class="game-online-count">
                <span class="pulse-dot"></span>
                Онлайн: <span id="online-count">0</span>
            </div>
            <div id="math-status" style="text-align:center; font-weight:700;">
                <div class="loader"></div>
                Поиск соперника...
            </div>
            <div class="duel-players hidden" id="math-players">
                <div class="duel-player" id="mp1-info">
                    <span class="duel-player-name" id="mp1-name">?</span>
                    <span class="duel-player-score" id="mp1-score">0</span>
                </div>
                <div class="duel-player" id="mp2-info">
                    <span class="duel-player-name" id="mp2-name">?</span>
                    <span class="duel-player-score" id="mp2-score">0</span>
                </div>
            </div>
            <div class="math-problem" id="math-target">?</div>
            <div class="math-answers-grid disabled" id="math-grid">
                <div class="math-btn" id="ans-0" onclick="handleMathClick(0)">?</div>
                <div class="math-btn" id="ans-1" onclick="handleMathClick(1)">?</div>
                <div class="math-btn" id="ans-2" onclick="handleMathClick(2)">?</div>
                <div class="math-btn" id="ans-3" onclick="handleMathClick(3)">?</div>
            </div>
        </div>
    `;
    
    findMathMatch();
}

async function findMathMatch() {
    const waitingRef = ref(db, 'mathbattle/waiting');
    const snapshot = await get(waitingRef);
    const waitingPlayers = snapshot.val();
    
    if (waitingPlayers) {
        const opponentId = Object.keys(waitingPlayers)[0];
        if (opponentId !== currentUser.id) {
            currentMatchId = `${opponentId}_${currentUser.id}`;
            playerSymbol = 'P2';
            
            await set(ref(db, `mathbattle/matches/${currentMatchId}`), {
                players: {
                    P1: opponentId,
                    P2: currentUser.id,
                    P1_name: waitingPlayers[opponentId].name,
                    P2_name: currentUser.name
                },
                scores: { P1: 0, P2: 0 },
                status: 'starting',
                winner: null,
                lastUpdate: Date.now()
            });
            
            await remove(ref(db, `mathbattle/waiting/${opponentId}`));
            listenToMathBattle();
            return;
        }
    }

    playerSymbol = 'P1';
    await set(ref(db, `mathbattle/waiting/${currentUser.id}`), {
        name: currentUser.name,
        joinedAt: Date.now()
    });
    
    onDisconnect(ref(db, `mathbattle/waiting/${currentUser.id}`)).remove();

    const matchesRef = ref(db, 'mathbattle/matches');
    onValue(matchesRef, (snap) => {
        const matches = snap.val();
        for (let id in matches) {
            if (id.startsWith(currentUser.id) && !currentMatchId) {
                currentMatchId = id;
                listenToMathBattle();
                break;
            }
        }
    });
}

function listenToMathBattle() {
    const matchRef = ref(db, `mathbattle/matches/${currentMatchId}`);
    onDisconnect(matchRef).remove();

    onValue(matchRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        const statusEl = document.getElementById('math-status');
        const playersEl = document.getElementById('math-players');
        const targetEl = document.getElementById('math-target');
        const gridEl = document.getElementById('math-grid');
        
        if (playersEl) {
            playersEl.classList.remove('hidden');
            document.getElementById('mp1-name').innerText = data.players.P1_name;
            document.getElementById('mp2-name').innerText = data.players.P2_name;
            document.getElementById('mp1-score').innerText = data.scores.P1;
            document.getElementById('mp2-score').innerText = data.scores.P2;
        }

        if (data.status === 'starting') {
            statusEl.innerText = 'Приготовьтесь...';
            targetEl.innerText = 'READY';
            gridEl.classList.add('disabled');
            if (playerSymbol === 'P1') {
                setTimeout(() => {
                    const task = generateMathTask();
                    update(matchRef, { 
                        status: 'playing', 
                        problem: task.problem,
                        options: task.options,
                        answer: task.answer
                    });
                }, 2000);
            }
        } else if (data.status === 'playing') {
            statusEl.innerText = 'РЕШАЙ БЫСТРЕЕ!';
            targetEl.innerText = data.problem;
            gridEl.classList.remove('disabled');
            data.options.forEach((opt, i) => {
                const btn = document.getElementById(`ans-${i}`);
                if (btn) {
                    btn.innerText = opt;
                    btn.className = 'math-btn';
                }
            });
        } else if (data.status === 'finished') {
            showGameOverModal(data.winner === playerSymbol ? playerSymbol : 'lose');
        }
    });
}

export async function handleMathClick(idx) {
    if (!currentMatchId) return;
    const matchRef = ref(db, `mathbattle/matches/${currentMatchId}`);
    const snapshot = await get(matchRef);
    const data = snapshot.val();
    
    if (data.status !== 'playing') return;

    const selectedValue = data.options[idx];
    const isCorrect = selectedValue === data.answer;
    const btn = document.getElementById(`ans-${idx}`);
    
    if (isCorrect) {
        btn.classList.add('correct');
        const newScores = { ...data.scores };
        newScores[playerSymbol] += 1;
        
        const updates = {
            scores: newScores,
            lastUpdate: Date.now()
        };

        if (newScores[playerSymbol] >= 15) {
            updates.status = 'finished';
            updates.winner = playerSymbol;
            const newPoints = currentUser.points + 25;
            update(ref(db, `users/${currentUser.id}`), { points: newPoints });
        } else {
            const next = generateMathTask();
            updates.problem = next.problem;
            updates.options = next.options;
            updates.answer = next.answer;
        }
        
        safeHaptic('success');
        setTimeout(() => update(matchRef, updates), 200);
    } else {
        btn.classList.add('wrong');
        safeHaptic('error');
        // Subtract point for wrong answer
        const newScores = { ...data.scores };
        newScores[playerSymbol] = Math.max(0, newScores[playerSymbol] - 1);
        update(matchRef, { scores: newScores, lastUpdate: Date.now() });
    }
}

function generateMathTask() {
    const ops = ['+', '-', '*'];
    const op = ops[Math.floor(Math.random() * ops.length)];
    let a, b, ans;

    if (op === '+') {
        a = Math.floor(Math.random() * 50) + 1;
        b = Math.floor(Math.random() * 50) + 1;
        ans = a + b;
    } else if (op === '-') {
        a = Math.floor(Math.random() * 50) + 20;
        b = Math.floor(Math.random() * a);
        ans = a - b;
    } else {
        a = Math.floor(Math.random() * 12) + 2;
        b = Math.floor(Math.random() * 12) + 2;
        ans = a * b;
    }

    let options = [ans];
    while (options.length < 4) {
        let wrong = ans + (Math.floor(Math.random() * 10) - 5);
        if (wrong !== ans && wrong > 0 && !options.includes(wrong)) {
            options.push(wrong);
        }
    }
    options.sort(() => Math.random() - 0.5);

    return { problem: `${a} ${op === '*' ? '×' : op} ${b}`, options, answer: ans };
}

// Логика отслеживания онлайна
function initOnlineCounter() {
    const onlineRef = ref(db, 'status/online');
    const userStatusRef = ref(db, `status/online/${currentUser.id}`);

    // При подключении/отключении
    onValue(ref(db, '.info/connected'), (snapshot) => {
        if (snapshot.val() === true) {
            set(userStatusRef, {
                name: currentUser.name || 'Аноним',
                lastSeen: Date.now()
            });
            onDisconnect(userStatusRef).remove();
        }
    });

    // Слушаем количество игроков
    onValue(onlineRef, (snapshot) => {
        const onlineUsers = snapshot.val();
        const count = onlineUsers ? Object.keys(onlineUsers).length : 0;
        
        // Update both game-specific and global counters
        const currentOnlineEl = document.getElementById('online-count');
        const globalOnlineEl = document.getElementById('global-online-count');
        
        if (currentOnlineEl) currentOnlineEl.innerText = count;
        if (globalOnlineEl) globalOnlineEl.innerText = count;
    });
}

// Конец файла
// Удалены дублирующие вызовы, они теперь в DOMContentLoaded




