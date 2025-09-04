const socket = io();

// HTML要素
const lobbyContainer = document.getElementById('lobby-container');
const playerNameInput = document.getElementById('player-name');
const createRoomBtn = document.getElementById('create-room');
const roomIdInput = document.getElementById('room-id');
const joinRoomBtn = document.getElementById('join-room');

const gameContainer = document.getElementById('game-container');
const roomIdDisplay = document.getElementById('room-id-display');
const roundInfoSpan = document.getElementById('round-info');
const playerCountSpan = document.getElementById('player-count');
const countdownTimerDiv = document.getElementById('countdown-timer');
const dealerHandDiv = document.getElementById('dealer-hand');
const dealerScoreH3 = document.getElementById('dealer-score');
const playersAreaDiv = document.getElementById('players-area');
const startGameBtn = document.getElementById('start-game');
const hitBtn = document.getElementById('hit-btn');
const standBtn = document.getElementById('stand-btn');
const doubleDownBtn = document.getElementById('double-down-btn');
const bettingControls = document.getElementById('betting-controls');
const actionControls = document.getElementById('action-controls');
const betAmountInput = document.getElementById('bet-amount');
const placeBetBtn = document.getElementById('place-bet-btn');

// ★★追加★★ ランキング要素
const rankingOverlay = document.getElementById('ranking-overlay');
const rankingList = document.getElementById('ranking-list');
const backToLobbyBtn = document.getElementById('back-to-lobby-btn');

let myId = null;
let countdownInterval = null;

function createCardHTML(card) {
    const isRed = card.suit === '♥' || card.suit === '♦';
    const colorClass = isRed ? 'red' : '';
    if (card.value === '?') return `<div class="card" style="background-color: #555;"></div>`;
    return `<div class="card ${colorClass}"><div class="card-value">${card.value}</div><div class="card-suit">${card.suit}</div></div>`;
}

function renderGame(gameState) {
    const { players, dealer, gamePhase, currentRound, maxRounds, roomId, creatorId } = gameState;

    roomIdDisplay.textContent = `ルームID: ${roomId}`;
    roundInfoSpan.textContent = `ラウンド ${currentRound} / ${maxRounds}`;
    playerCountSpan.textContent = `参加人数: ${Object.keys(players).length}人`;
    
    dealerHandDiv.innerHTML = dealer.hand.map(createCardHTML).join('');
    dealerScoreH3.textContent = `スコア: ${dealer.score}`;

    playersAreaDiv.innerHTML = '';
    for (const id in players) {
        const player = players[id];
        const isMe = id === myId;

        const playerDiv = document.createElement('div');
        playerDiv.className = `player-area ${isMe ? 'my-area' : ''}`;
        let resultHTML = player.result ? `<h4>結果: ${player.result}</h4>` : '';
        if (player.status === 'out') {
            resultHTML = `<h4>チップがなくなりゲームオーバーです</h4>`;
        }
        playerDiv.innerHTML = `
            <h3>${player.name} ${isMe ? '(あなた)' : ''} - <span class="player-status">${player.status}</span></h3>
            <div class="player-info">
                <span>💰 チップ: ${player.chips}</span>
                <span>ベット: ${player.currentBet}</span>
            </div>
            <div class="hand">${player.hand.map(createCardHTML).join('')}</div>
            <h3>スコア: ${player.score}</h3>
            ${resultHTML}
        `;
        playersAreaDiv.appendChild(playerDiv);
    }

    const myPlayer = players[myId];
    startGameBtn.style.display = (gamePhase === 'waiting' && myId === creatorId && currentRound === 0) ? 'inline-block' : 'none';
    bettingControls.style.display = (gamePhase === 'betting' && myPlayer?.status === 'betting') ? 'block' : 'none';
    
    const isMyTurn = gamePhase === 'playing' && myPlayer?.status === 'playing';
    actionControls.style.display = isMyTurn ? 'block' : 'none';
    
    if (isMyTurn) {
        const canDoubleDown = myPlayer.hand.length === 2 && myPlayer.chips >= myPlayer.currentBet;
        doubleDownBtn.style.display = canDoubleDown ? 'inline-block' : 'none';
    }

    if (gamePhase === 'playing') {
        countdownTimerDiv.innerHTML = '';
        clearInterval(countdownInterval);
    }
}

function startCountdown(duration, textPrefix) {
    let timeLeft = duration / 1000;
    countdownTimerDiv.innerHTML = `${textPrefix} ${timeLeft} 秒...`;
    clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        timeLeft--;
        countdownTimerDiv.innerHTML = `${textPrefix} ${timeLeft} 秒...`;
        if (timeLeft <= 0) {
            clearInterval(countdownInterval);
            countdownTimerDiv.innerHTML = '時間切れ！';
        }
    }, 1000);
}

// ロビー操作
createRoomBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (name) socket.emit('createRoom', { name });
    else alert('名前を入力してください。');
});
joinRoomBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    const roomId = roomIdInput.value.trim().toUpperCase();
    if (name && roomId) socket.emit('joinRoom', { name, roomId });
    else alert('名前とルームIDを入力してください。');
});

// ゲーム操作
startGameBtn.addEventListener('click', () => socket.emit('startGame'));
placeBetBtn.addEventListener('click', () => {
    const amount = parseInt(betAmountInput.value, 10);
    if (amount > 0) socket.emit('placeBet', { amount });
});
betAmountInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        placeBetBtn.click();
    }
});
hitBtn.addEventListener('click', () => socket.emit('hit'));
standBtn.addEventListener('click', () => socket.emit('stand'));
doubleDownBtn.addEventListener('click', () => socket.emit('doubleDown'));

// ★★追加★★ ロビーに戻るボタンの操作
backToLobbyBtn.addEventListener('click', () => {
    location.reload();
});

// サーバーからのイベント受信
socket.on('connect', () => { myId = socket.id; });

socket.on('joinSuccess', (gameState) => {
    lobbyContainer.style.display = 'none';
    gameContainer.style.display = 'block';
    renderGame(gameState);
});

socket.on('gameState', (gameState) => {
    if (gameContainer.style.display === 'block') renderGame(gameState);
});

socket.on('nextRoundTimer', (duration) => startCountdown(duration, '次のラウンドまで'));
socket.on('bettingTimer', (duration) => startCountdown(duration, 'ベット時間'));

// ★★変更★★ gameOverをfinalRankingに変更
socket.on('finalRanking', (leaderboard) => {
    gameContainer.style.display = 'none'; // ゲーム画面を隠す
    
    rankingList.innerHTML = ''; // ランキングリストをクリア
    leaderboard.forEach((player, index) => {
        const rank = index + 1;
        const li = document.createElement('li');
        // ランキング、名前、チップ数を表示
        li.innerHTML = `<span class="rank">${rank}位</span> <span class="name">${player.name}</span> <span class="chips">💰 ${player.chips}</span>`;
        rankingList.appendChild(li);
    });

    rankingOverlay.style.display = 'flex'; // ランキング画面を表示
});

socket.on('gameOverMessage', (data) => {
    alert(data.message);
});

socket.on('error', (message) => alert(`エラー: ${message}`));