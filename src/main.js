import './style.css';
import { createRoom, joinRoom, listenRoom, updateRoom, updatePlayer, submitGuess } from './db.js';

// --- DOM Elements ---
const screens = document.querySelectorAll('.screen');
function showScreen(id) {
    screens.forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// Landing
const inputPin = document.getElementById('join-pin');
const inputNickname = document.getElementById('join-nickname');
const btnJoin = document.getElementById('btn-join');
const btnCreateRoom = document.getElementById('btn-create-room');

// Host Dashboard
const elHostPin = document.getElementById('host-pin');
const elHostPlayerCount = document.getElementById('host-player-count');
const elHostPlayerList = document.getElementById('host-player-list');
const btnHostStart = document.getElementById('btn-host-start');
const btnHostVoid = document.getElementById('btn-host-void');
const settingWatchTime = document.getElementById('setting-watch-time');
const settingGuessTime = document.getElementById('setting-guess-time');
const settingCardCount = document.getElementById('setting-card-count');
const btnSaveSettings = document.getElementById('btn-save-settings');

// Waiting
const elMyNickname = document.getElementById('my-nickname');
const elMyScore = document.getElementById('my-score');
const elWaitingMsg = document.getElementById('waiting-msg');

// Actor
const elActorEmotion = document.getElementById('actor-emotion');
const elActorSituation = document.getElementById('actor-situation');
const btnActorDone = document.getElementById('btn-actor-done');
const elActorTimer = document.getElementById('actor-timer');

// Blind
const elBlindTimer = document.getElementById('blind-timer');

// Guess
const elGuess1Cards = document.getElementById('guess1-cards');
const elGuess2Cards = document.getElementById('guess2-cards');
const elGuess1Timer = document.getElementById('guess1-timer');
const elGuess2Timer = document.getElementById('guess2-timer');

// Sync
const screenSync = document.getElementById('screen-sync');
const elSyncText = document.getElementById('sync-text');

// Result
const elResultEmotion = document.getElementById('result-emotion');
const elResultSituation = document.getElementById('result-situation');
const elResultList = document.getElementById('result-list');
const elResultTimer = document.getElementById('result-timer');
const elResultNextMsg = document.getElementById('result-next-msg');

// --- State ---
let isHost = false;
let currentPin = null;
let currentUid = null;
let roomData = null;

let localTimerInterval = null;
let syncTimeout = null;

let myGuess1 = null;
let myGuess2 = null;

// On Load
window.addEventListener('DOMContentLoaded', () => {
    const lastNick = localStorage.getItem('lastNickname');
    if (lastNick) inputNickname.value = lastNick;
});

// --- Host Functions ---
btnCreateRoom.addEventListener('click', async () => {
    btnCreateRoom.disabled = true;
    try {
        const hostId = `host_${Date.now()}`;
        currentPin = await createRoom(hostId);
        isHost = true;
        elHostPin.innerText = currentPin;
        showScreen('screen-host');
        listenRoom(currentPin, handleHostUpdate);
    } catch (e) {
        alert(e.message);
        btnCreateRoom.disabled = false;
    }
});

btnSaveSettings.addEventListener('click', async () => {
    if (!isHost) return;
    await updateRoom(currentPin, {
        settings: {
            watchTime: parseInt(settingWatchTime.value) || 30,
            guessTime: parseInt(settingGuessTime.value) || 15,
            cardCount: parseInt(settingCardCount.value) || 6
        }
    });
    alert('설정이 저장되었습니다.');
});

btnHostStart.addEventListener('click', async () => {
    if (!roomData || !roomData.players) return alert('참가자가 없습니다.');
    const players = Object.keys(roomData.players);
    if (players.length < 2) return alert('최소 2명의 참가자가 필요합니다. (연기자 1, 정답자 1)');

    // Reset all 'hasGuessed' for the new round
    const updates = {};
    players.forEach(uid => {
        updates[`players/${uid}/hasGuessed`] = false;
        updates[`players/${uid}/guess1`] = null;
        updates[`players/${uid}/guess2`] = null;
        updates[`players/${uid}/guessTime`] = null;
    });

    // Select Actor
    let unactedPlayers = players.filter(uid => !roomData.players[uid].acted);
    if (unactedPlayers.length === 0) {
        // Everyone acted, reset
        players.forEach(uid => {
            updates[`players/${uid}/acted`] = false;
        });
        unactedPlayers = players;
    }
    const actorId = unactedPlayers[Math.floor(Math.random() * unactedPlayers.length)];
    updates[`players/${actorId}/acted`] = true;

    // Select Target
    const emotions = roomData.cards.emotions;
    const situations = roomData.cards.situations;
    const targetEmotion = emotions[Math.floor(Math.random() * emotions.length)];
    const targetSituation = situations[Math.floor(Math.random() * situations.length)];

    updates['currentRound'] = {
        actorId,
        targetEmotion,
        targetSituation,
        startTime: Date.now(),
        guessStartTime: 0, // Will be set later
        isVoided: false
    };
    updates['status'] = 'acting';

    await updateRoom(currentPin, updates);
});

btnHostVoid.addEventListener('click', async () => {
    if (!isHost || roomData?.status !== 'result') {
        if(confirm('진행중인 게임을 무효화하고 대기실로 돌아갈까요?')) {
            await updateRoom(currentPin, { status: 'waiting', 'currentRound/isVoided': true });
        }
        return;
    }
    if (confirm('이 라운드의 점수를 무효화하시겠습니까?')) {
        await updateRoom(currentPin, { 'currentRound/isVoided': true });
        alert('무효 처리되었습니다.');
        // Host might need to recalculate or revert scores. 
        // For simplicity, we can just say "isVoided" flag will prevent score addition if done before result,
        // but if we are already in result, we should revert.
        // It's easier to only allow voiding BEFORE or DURING result, and handle score logic carefully.
    }
});

let hostTimerInterval = null;

function handleHostUpdate(data) {
    if (!data) return;
    roomData = data;
    
    // Update dashboard UI
    const players = data.players || {};
    elHostPlayerCount.innerText = Object.keys(players).length;
    elHostPlayerList.innerHTML = '';
    
    const actorId = data.currentRound?.actorId;

    Object.values(players).forEach(p => {
        const li = document.createElement('li');
        const isActor = Object.keys(players).find(key => players[key] === p) === actorId;
        if(isActor) li.classList.add('is-actor');
        li.innerText = `${p.nickname} : ${p.score}점 (패널티: ${p.penalties})`;
        elHostPlayerList.appendChild(li);
    });

    settingWatchTime.value = data.settings.watchTime;
    settingGuessTime.value = data.settings.guessTime;
    settingCardCount.value = data.settings.cardCount;

    btnHostStart.disabled = data.status !== 'waiting' && data.status !== 'result';

    // Host authoritative logic
    clearInterval(hostTimerInterval);
    const now = Date.now();

    if (data.status === 'acting' && data.currentRound) {
        // Check watch timer
        const elapsed = (now - data.currentRound.startTime) / 1000;
        const watchTime = data.settings.watchTime;
        if (elapsed > watchTime) {
            // Time's up -> guessing
            updateRoom(currentPin, { 
                status: 'guessing', 
                'currentRound/guessStartTime': Date.now() + 1500 // 1.5s delay for sync animation
            });
        } else {
            hostTimerInterval = setInterval(() => handleHostUpdate(data), 1000); // Polling for timeout
        }
    } else if (data.status === 'guessing' && data.currentRound) {
        // Check if everyone guessed or time's up
        const guessTime = data.settings.guessTime;
        const elapsed = (now - data.currentRound.guessStartTime) / 1000;
        
        let allGuessed = true;
        Object.keys(players).forEach(uid => {
            if (uid !== data.currentRound.actorId && !players[uid].hasGuessed) {
                // Not guessed yet. But wait, what if they joined mid-round? 
                // Mid-round joiners shouldn't block. We skip them if joinTime > round start time.
                if (players[uid].joinTime < data.currentRound.startTime) {
                    allGuessed = false;
                }
            }
        });

        if (elapsed > guessTime || allGuessed) {
            // Goto Result & Calculate Scores
            calculateScores(data);
        } else {
            hostTimerInterval = setInterval(() => handleHostUpdate(data), 1000);
        }
    } else if (data.status === 'result' && data.currentRound && !data.currentRound.nextRoundTime) {
        // Start 10s countdown to next round
        const nextTime = Date.now() + 10000;
        updateRoom(currentPin, { 'currentRound/nextRoundTime': nextTime });
    } else if (data.status === 'result' && data.currentRound && data.currentRound.nextRoundTime) {
        const nextTime = data.currentRound.nextRoundTime;
        if (now >= nextTime) {
            // Trigger next round automatically via the same logic as start
            btnHostStart.click();
        } else {
            hostTimerInterval = setInterval(() => handleHostUpdate(data), 1000);
        }
    }
}

async function calculateScores(data) {
    if (data.currentRound.isVoided) {
        await updateRoom(currentPin, { status: 'result' });
        return;
    }

    const { actorId, targetEmotion, targetSituation, startTime } = data.currentRound;
    const players = data.players || {};
    
    // Evaluate guesses
    let correctGuessers = [];
    let wrongGuessers = [];
    let timeoutGuessers = [];

    Object.keys(players).forEach(uid => {
        if (uid === actorId) return;
        const p = players[uid];
        // Ignore mid-round joins
        if (p.joinTime > startTime) return;

        if (!p.hasGuessed) {
            timeoutGuessers.push(uid);
        } else if (p.guess1 === targetEmotion && p.guess2 === targetSituation) {
            correctGuessers.push({ uid, guessTime: p.guessTime });
        } else {
            wrongGuessers.push(uid);
        }
    });

    // Sort correct guessers by time
    correctGuessers.sort((a, b) => a.guessTime - b.guessTime);

    const updates = {};
    
    let actorBonus = correctGuessers.length * 5;
    let actorTotal = 10 + actorBonus;
    updates[`players/${actorId}/score`] = (players[actorId].score || 0) + actorTotal;

    correctGuessers.forEach((g, index) => {
        let pts = 10;
        if (index === 0) pts = 30;
        else if (index === 1) pts = 20;
        updates[`players/${g.uid}/score`] = (players[g.uid].score || 0) + pts;
    });

    wrongGuessers.forEach(uid => {
        updates[`players/${uid}/score`] = (players[uid].score || 0) - 5;
        updates[`players/${uid}/penalties`] = (players[uid].penalties || 0) + 1;
    });

    timeoutGuessers.forEach(uid => {
        updates[`players/${uid}/penalties`] = (players[uid].penalties || 0) + 1;
    });

    updates['status'] = 'result';
    await updateRoom(currentPin, updates);
}

// --- Player Functions ---
btnJoin.addEventListener('click', async () => {
    const pin = inputPin.value.trim();
    const nickname = inputNickname.value.trim();
    if (pin.length !== 6) return alert('6자리 코드를 입력해주세요.');
    if (!nickname) return alert('닉네임을 입력해주세요.');

    btnJoin.disabled = true;
    try {
        const res = await joinRoom(pin, nickname);
        currentPin = pin;
        currentUid = res.uid;
        isHost = false;
        
        elMyNickname.innerText = nickname;
        listenRoom(currentPin, handlePlayerUpdate);
    } catch (e) {
        alert(e.message);
        btnJoin.disabled = false;
    }
});

let lastStatus = null;

function handlePlayerUpdate(data) {
    if (!data) return alert('방이 삭제되었습니다.');
    roomData = data;
    
    const me = data.players[currentUid];
    if (!me) return; // Kicked?

    elMyScore.innerText = me.score;
    const amActor = data.currentRound?.actorId === currentUid;
    const joinedMidRound = me.joinTime > data.currentRound?.startTime;

    // Status transitions
    if (data.status === 'waiting') {
        showScreen('screen-waiting');
        elWaitingMsg.innerText = "선생님이 게임을 시작할 때까지 기다려주세요!";
    } 
    else if (data.status === 'acting') {
        if (amActor) {
            showScreen('screen-actor');
            elActorEmotion.innerText = data.currentRound.targetEmotion;
            elActorSituation.innerText = data.currentRound.targetSituation;
            updateActorTimer(data.currentRound.startTime, data.settings.watchTime);
        } else {
            showScreen('screen-blind');
            updateBlindTimer(data.currentRound.startTime, data.settings.watchTime);
        }
    } 
    else if (data.status === 'guessing') {
        if (lastStatus === 'acting') {
            // Trigger Sync
            showSyncPopup();
        }
        
        if (amActor) {
            showScreen('screen-waiting');
            elWaitingMsg.innerText = "친구들이 정답을 맞히고 있습니다...";
        } else if (joinedMidRound) {
            showScreen('screen-waiting');
            elWaitingMsg.innerText = "진행중인 라운드입니다. 잠시 기다려주세요.";
        } else {
            if (lastStatus !== 'guessing') {
                myGuess1 = null;
                myGuess2 = null;
                renderGuessCards(1);
                showScreen('screen-guess1');
            }
            updateGuessTimer(data.currentRound.guessStartTime, data.settings.guessTime);
        }
    }
    else if (data.status === 'result') {
        showScreen('screen-result');
        elResultEmotion.innerText = data.currentRound.targetEmotion;
        elResultSituation.innerText = data.currentRound.targetSituation;
        
        // Render Scoreboard
        elResultList.innerHTML = '';
        const sorted = Object.values(data.players).sort((a,b) => b.score - a.score);
        sorted.forEach((p, idx) => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${idx+1}위. ${p.nickname}</span> <span>${p.score}점</span>`;
            if (p.nickname === me.nickname) li.style.color = '#FCD34D';
            elResultList.appendChild(li);
        });

        if (data.currentRound.nextRoundTime) {
            elResultNextMsg.style.display = 'block';
            updateResultTimer(data.currentRound.nextRoundTime);
        } else {
            elResultNextMsg.style.display = 'none';
        }
    }

    lastStatus = data.status;
}

// Actor Done button
btnActorDone.addEventListener('click', async () => {
    if (!roomData || roomData.status !== 'acting') return;
    btnActorDone.disabled = true;
    await updateRoom(currentPin, { 
        status: 'guessing',
        'currentRound/guessStartTime': Date.now() + 1500
    });
    setTimeout(() => { btnActorDone.disabled = false; }, 2000);
});

// Timers
function updateActorTimer(startTime, watchTime) {
    clearInterval(localTimerInterval);
    localTimerInterval = setInterval(() => {
        let left = Math.ceil(watchTime - (Date.now() - startTime)/1000);
        if (left < 0) left = 0;
        elActorTimer.innerText = left;
    }, 200);
}

function updateBlindTimer(startTime, watchTime) {
    clearInterval(localTimerInterval);
    localTimerInterval = setInterval(() => {
        let left = Math.ceil(watchTime - (Date.now() - startTime)/1000);
        if (left < 0) left = 0;
        elBlindTimer.innerText = left;
    }, 200);
}

function updateGuessTimer(guessStartTime, guessTime) {
    clearInterval(localTimerInterval);
    localTimerInterval = setInterval(() => {
        let left = Math.ceil(guessTime - (Date.now() - guessStartTime)/1000);
        if (left < 0) left = 0;
        elGuess1Timer.innerText = left;
        elGuess2Timer.innerText = left;
    }, 200);
}

function updateResultTimer(nextRoundTime) {
    clearInterval(localTimerInterval);
    localTimerInterval = setInterval(() => {
        let left = Math.ceil((nextRoundTime - Date.now())/1000);
        if (left < 0) left = 0;
        elResultTimer.innerText = left;
    }, 200);
}

// Sync Popup
function showSyncPopup() {
    screenSync.classList.remove('hidden');
    let count = 3;
    elSyncText.innerText = count;
    
    const intv = setInterval(() => {
        count--;
        if (count > 0) {
            elSyncText.innerText = count;
            elSyncText.classList.remove('zoom-in');
            void elSyncText.offsetWidth; // trigger reflow
            elSyncText.classList.add('zoom-in');
        } else if (count === 0) {
            elSyncText.innerText = "시작!";
        } else {
            clearInterval(intv);
            screenSync.classList.add('hidden');
        }
    }, 400); // Fast countdown, 1.5s total approx
}

// Guess Cards Rendering
function getRandomCards(target, list, count) {
    let others = list.filter(item => item !== target);
    others.sort(() => 0.5 - Math.random());
    let selected = [target, ...others.slice(0, count - 1)];
    selected.sort(() => 0.5 - Math.random());
    return selected;
}

function renderGuessCards(phase) {
    const r = roomData.currentRound;
    const c = roomData.cards;
    const cardCount = roomData.settings.cardCount;

    if (phase === 1) {
        elGuess1Cards.innerHTML = '';
        const cards = getRandomCards(r.targetEmotion, c.emotions, cardCount);
        cards.forEach(text => {
            const div = document.createElement('div');
            div.className = 'guess-card';
            div.innerText = text;
            div.onclick = () => {
                myGuess1 = text;
                showScreen('screen-guess2');
                renderGuessCards(2);
            };
            elGuess1Cards.appendChild(div);
        });
    } else {
        elGuess2Cards.innerHTML = '';
        const cards = getRandomCards(r.targetSituation, c.situations, cardCount);
        cards.forEach(text => {
            const div = document.createElement('div');
            div.className = 'guess-card';
            div.innerText = text;
            div.onclick = async () => {
                myGuess2 = text;
                div.classList.add('selected');
                elGuess2Cards.style.pointerEvents = 'none'; // Prevent double click
                await submitGuess(currentPin, currentUid, myGuess1, myGuess2, Date.now() - r.guessStartTime);
                elGuess2Cards.style.pointerEvents = 'auto';
                showScreen('screen-waiting');
                elWaitingMsg.innerText = "결과를 기다리는 중...";
            };
            elGuess2Cards.appendChild(div);
        });
    }
}
