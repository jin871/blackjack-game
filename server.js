const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const SUITS = ['♥', '♦', '♣', '♠'];
const VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const STARTING_CHIPS = 1000;
const MINIMUM_BET = 10;
const ROUND_END_TIMER = 10000;
const BETTING_TIMER = 20000;

let games = {};

app.use(express.static('public'));

function createNewGameState(roomId, creatorId) {
    return {
        roomId, creatorId, players: {}, deck: [],
        dealer: { hand: [], score: 0 },
        gamePhase: 'waiting',
        currentRound: 0, maxRounds: 10, roundEndTimeout: null, bettingTimeout: null,
    };
}

function calculateScore(hand) {
    let score = 0;
    let aceCount = 0;
    for (let card of hand) {
        if (card.value === 'A') { aceCount++; score += 11; }
        else if (['J', 'Q', 'K'].includes(card.value)) { score += 10; }
        else { score += parseInt(card.value); }
    }
    while (score > 21 && aceCount > 0) { score -= 10; aceCount--; }
    return score;
}

function updateGameState(roomId) {
    const game = games[roomId];
    if (!game) return;

    for (const playerSocketId in game.players) {
        const personalizedPlayers = {};
        for (const otherPlayerSocketId in game.players) {
            const otherPlayer = game.players[otherPlayerSocketId];
            if (playerSocketId === otherPlayerSocketId || game.gamePhase === 'finished') {
                personalizedPlayers[otherPlayerSocketId] = otherPlayer;
            } else {
                personalizedPlayers[otherPlayerSocketId] = {
                    ...otherPlayer,
                    hand: otherPlayer.hand.map(() => ({ suit: '?', value: '?' })),
                    score: '?'
                };
            }
        }
        
        const showDealerAll = game.gamePhase === 'finished';
        const dealerInfo = {
            hand: showDealerAll ? game.dealer.hand : (game.dealer.hand.length > 0 ? [game.dealer.hand[0], { suit: '?', value: '?' }] : []),
            score: showDealerAll ? game.dealer.score : (game.dealer.hand.length > 0 ? calculateScore([game.dealer.hand[0]]) : 0)
        };
        
        const gameStateForPlayer = { ...game, players: personalizedPlayers, dealer: dealerInfo };
        io.to(playerSocketId).emit('gameState', gameStateForPlayer);
    }
}

function startBettingPhase(roomId) {
    const game = games[roomId];
    if (!game) return;

    clearTimeout(game.roundEndTimeout);
    clearTimeout(game.bettingTimeout);

    if (game.currentRound >= game.maxRounds) {
        io.to(roomId).emit('gameOver', { message: '全10ラウンドが終了しました！お疲れ様でした！' });
        return;
    }
    game.currentRound++;
    game.gamePhase = 'betting';
    
    let activePlayerCount = 0;
    for(const id in game.players) {
        const player = game.players[id];
        player.hand = [];
        player.score = 0;
        player.currentBet = 0;
        player.result = '';
        
        if (player.chips < MINIMUM_BET) {
            player.status = 'out';
        } else {
            player.status = 'betting';
            activePlayerCount++;
        }
    }
    
    game.dealer = { hand: [], score: 0 };
    updateGameState(roomId);

    if (activePlayerCount === 0) {
        io.to(roomId).emit('gameOver', { message: 'プレイ可能なプレイヤーがいません。ゲームを終了します。' });
        return;
    }

    io.to(roomId).emit('bettingTimer', BETTING_TIMER);
    game.bettingTimeout = setTimeout(() => {
        for (const id in game.players) {
            if (game.players[id].status === 'betting') {
                game.players[id].status = 'folded';
            }
        }
        dealCards(roomId);
    }, BETTING_TIMER);
}

function dealCards(roomId) {
    const game = games[roomId];
    if (!game) return;

    clearTimeout(game.bettingTimeout);
    game.gamePhase = 'playing';
    game.deck = [];
    for (let suit of SUITS) {
        for (let value of VALUES) game.deck.push({ suit, value });
    }
    game.deck.sort(() => Math.random() - 0.5);

    for (let id in game.players) {
        const player = game.players[id];
        if(player.status === 'betPlaced') {
            player.hand = [game.deck.pop(), game.deck.pop()];
            player.score = calculateScore(player.hand);
            player.status = 'playing';
            if (player.score === 21) {
                player.status = 'stand';
                player.result = 'ブラックジャック！';
            }
        }
    }
    game.dealer.hand = [game.deck.pop(), game.deck.pop()];
    game.dealer.score = calculateScore(game.dealer.hand);
    
    const allPlayersDone = Object.values(game.players).every(p => p.status !== 'playing');
    if (allPlayersDone) {
        dealerTurn(roomId);
    } else {
        updateGameState(roomId);
    }
}

function dealerTurn(roomId) {
    const game = games[roomId];
    if (!game) return;
    while (game.dealer.score < 17) {
        game.dealer.hand.push(game.deck.pop());
        game.dealer.score = calculateScore(game.dealer.hand);
    }
    endGame(roomId);
}

function endGame(roomId) {
    const game = games[roomId];
    if (!game) return;

    game.gamePhase = 'finished';
    const dealerScore = game.dealer.score;

    for (let id in game.players) {
        const player = game.players[id];
        const bet = player.currentBet;
        
        if (player.result === 'ブラックジャック！') player.chips += Math.floor(bet * 1.5);
        else if (player.status === 'stand' || player.status === 'bust') {
            if (player.score > 21) { player.result = '負け (バスト)'; player.chips -= bet; }
            else if (dealerScore > 21 || player.score > dealerScore) { player.result = '勝ち！'; player.chips += bet; }
            else if (player.score < dealerScore) { player.result = '負け'; player.chips -= bet; }
            else { player.result = '引き分け'; }
        }
    }
    
    updateGameState(roomId);
    
    io.to(roomId).emit('nextRoundTimer', ROUND_END_TIMER);
    game.roundEndTimeout = setTimeout(() => startBettingPhase(roomId), ROUND_END_TIMER);
}

io.on('connection', (socket) => {
    socket.on('createRoom', ({ name }) => {
        let roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        while (games[roomId]) roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        
        socket.join(roomId);
        socket.roomId = roomId;
        games[roomId] = createNewGameState(roomId, socket.id);
        games[roomId].players[socket.id] = { id: socket.id, name, chips: STARTING_CHIPS, currentBet: 0, hand: [], score: 0, status: 'waiting', result: '' };
        
        socket.emit('joinSuccess', games[roomId]);
    });

    socket.on('joinRoom', ({ name, roomId }) => {
        const room = games[roomId];
        if (!room) return socket.emit('error', 'ルームが見つかりません。');
        if (room.gamePhase !== 'waiting' && room.gamePhase !== 'betting') return socket.emit('error', 'ゲームは既に進行中です。');

        socket.join(roomId);
        socket.roomId = roomId;
        room.players[socket.id] = { id: socket.id, name, chips: STARTING_CHIPS, currentBet: 0, hand: [], score: 0, status: 'waiting', result: '' };
        
        socket.emit('joinSuccess', room);
        updateGameState(roomId);
    });

    socket.on('startGame', () => {
        const roomId = socket.roomId;
        const game = games[roomId];
        if (game && game.creatorId === socket.id && game.currentRound === 0) {
            startBettingPhase(roomId);
        }
    });

    socket.on('placeBet', ({ amount }) => {
        const roomId = socket.roomId;
        const game = games[roomId];
        const player = game?.players[socket.id];

        if (game && player && game.gamePhase === 'betting' && player.status === 'betting') {
            const betAmount = parseInt(amount, 10);
            if (isNaN(betAmount) || betAmount <= 0 || betAmount > player.chips) return;
            player.currentBet = betAmount;
            player.status = 'betPlaced';
            updateGameState(roomId);
            
            const activePlayers = Object.values(game.players).filter(p => p.status !== 'out' && p.status !== 'folded');
            const allActivePlayersBet = activePlayers.every(p => p.status === 'betPlaced');
            if(allActivePlayersBet) {
                dealCards(roomId);
            }
        }
    });

    // ★★ここから修正★★
    // 'hit', 'stand', 'doubleDown'イベントが、どのルームから来たかを
    // socketオブジェクトに保存されたroomIdから判断するようにします。
    socket.on('hit', () => {
        const roomId = socket.roomId;
        const game = games[roomId];
        const player = game?.players[socket.id];
        if (game && player && game.gamePhase === 'playing' && player.status === 'playing') {
            player.hand.push(game.deck.pop());
            player.score = calculateScore(player.hand);
            if (player.score > 21) player.status = 'bust';
            
            const allPlayersDone = Object.values(game.players).every(p => p.status !== 'playing');
            if (allPlayersDone) dealerTurn(roomId);
            else updateGameState(roomId);
        }
    });

    socket.on('stand', () => {
        const roomId = socket.roomId;
        const game = games[roomId];
        const player = game?.players[socket.id];
        if (game && player && game.gamePhase === 'playing' && player.status === 'playing') {
            player.status = 'stand';
            const allPlayersDone = Object.values(game.players).every(p => p.status !== 'playing');
            if (allPlayersDone) dealerTurn(roomId);
            else updateGameState(roomId);
        }
    });
    
    socket.on('doubleDown', () => {
        const roomId = socket.roomId;
        const game = games[roomId];
        const player = game?.players[socket.id];
        if (game && player && game.gamePhase === 'playing' && player.status === 'playing' && player.hand.length === 2 && player.chips >= player.currentBet) {
            player.chips -= player.currentBet;
            player.currentBet *= 2;
            player.hand.push(game.deck.pop());
            player.score = calculateScore(player.hand);
            player.status = (player.score > 21) ? 'bust' : 'stand';
            
            const allPlayersDone = Object.values(game.players).every(p => p.status !== 'playing');
            if (allPlayersDone) dealerTurn(roomId);
            else updateGameState(roomId);
        }
    });
    // ★★修正ここまで★★

    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (!roomId || !games[roomId]) return;

        delete games[roomId].players[socket.id];

        if (Object.keys(games[roomId].players).length === 0) {
            clearTimeout(games[roomId].bettingTimeout);
            clearTimeout(games[roomId].roundEndTimeout);
            delete games[roomId];
        } else {
            if (games[roomId].creatorId === socket.id) {
                games[roomId].creatorId = Object.keys(games[roomId].players)[0];
            }
            updateGameState(roomId);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`サーバーがポート ${PORT} で起動しました`));