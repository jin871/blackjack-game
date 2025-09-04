const socket = io();

// ロビー要素
const lobbyContainer = document.getElementById('lobby-container');
const playerNameInput = document.getElementById('player-name');
const createRoomBtn = document.getElementById('create-room');
const roomIdInput = document.getElementById('room-id');
const joinRoomBtn = document.getElementById('join-room');

// ゲーム要素
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

let myId = null;
let countdownInterval = null;
let currentRoomId = null; // ★★追加★★

function createCardHTML(card) {
    const isRed = card.suit === '♥' || card.suit === '♦';
    const colorClass = isRed ? 'red' : '';
    if (card.value === '?') return `<div class="card" style="background-color: #555;"></div>`;
    return `<div class="card ${colorClass}"><div class="card-value">${card.value}</div><div class="card-suit">${card.suit}</div></div>`;
}

function renderGame(gameState) {
    const { players, dealer, gamePhase, currentRound, maxRounds, roomId, creatorId } = gameState;
    currentRoomId = roomId; // ルームIDを保存

    // ヘッダー情報
    roomIdDisplay.textContent = `ルームID: ${roomId}`;
    roundInfoSpan.textContent = `ラウンド ${currentRound} / ${maxRounds}`;
    playerCountSpan.textContent = `参加人数: ${Object.keys(players).length}人`;
    
    // ディーラー
    dealerHandDiv.innerHTML = dealer.hand.map(createCardHTML).join('');
    dealerScoreH3.textContent = `スコア: ${dealer.score}`;

    // プレイヤー
    playersAreaDiv.innerHTML = '';
    const myPlayer = players[myId];
    if (myPlayer) {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-area my-area';
        let resultHTML = myPlayer.result ? `<h4>結果: ${myPlayer.result}</h4>` : '';
        // ★★変更★★ ゲームオーバー時の表示を追加
        if (myPlayer.status === 'out') {
            resultHTML = `<h4>チップがなくなりゲームオーバーです</h4>`;
        }
        playerDiv.innerHTML = `
            <h3>${myPlayer.name} (あなた) - <span class="player-status">${myPlayer.status}</span></h3>
            <div class="player-info">
                <span>💰 チップ: ${myPlayer.chips}</span>
                <span>ベット: ${myPlayer.currentBet}</span>
            </div>
            <div class="hand">${myPlayer.hand.map(createCardHTML).join('')}</div>
            <h3>スコア: ${myPlayer.score}</h3>
            ${resultHTML}
        `;
        playersAreaDiv.appendChild(playerDiv);
    }

    // UIコントロールの表示切り替え
    startGameBtn.style.display = (gamePhase === 'waiting' && myId === creatorId && currentRound === 0) ? 'inline-block' : 'none';
    bettingControls.style.display = (gamePhase === 'betting' && myPlayer?.status === 'betting') ? 'block' : 'none';
    
    const isMyTurn = gamePhase === 'playing' && myPlayer?.status === 'playing';
    actionControls.style.display = isMyTurn ? 'block' : 'none';
    
    if (isMyTurn) {
        const canDoubleDown = myPlayer.hand.length === 2 && myPlayer.chips >= myPlayer.currentBet;
        doubleDownBtn.style.display = canDoubleDown ? 'inline-block' : 'none';
    }

    if (gamePhase !== 'finished') {
        countdownTimerDiv.innerHTML = '';
        clearInterval(countdownInterval);
    }
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
// ★★追加★★ Enterキーでベット
betAmountInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault(); // デフォルトのフォーム送信を防止
        placeBetBtn.click();
    }
});

hitBtn.addEventListener('click', () => socket.emit('hit', { roomId: currentRoomId }));
standBtn.addEventListener('click', () => socket.emit('stand', { roomId: currentRoomId }));
doubleDownBtn.addEventListener('click', () => socket.emit('doubleDown', { roomId: currentRoomId }));

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

socket.on('nextRoundTimer', (duration) => {
    let timeLeft = duration / 1000;
    countdownTimerDiv.innerHTML = `次のラウンドまで ${timeLeft} 秒...`;
    clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        timeLeft--;
        countdownTimerDiv.innerHTML = `次のラウンドまで ${timeLeft} 秒...`;
        if (timeLeft <= 0) clearInterval(countdownInterval);
    }, 1000);
});

socket.on('gameOver', (data) => {
    alert(data.message);
    countdownTimerDiv.innerHTML = 'ゲーム終了！';
    bettingControls.style.display = 'none';
    actionControls.style.display = 'none';
});

socket.on('error', (message) => alert(`エラー: ${message}`));