import './style.css';
import { createRoom, joinRoom, listenRoom, updateRoom, updatePlayer, submitGuess, saveDeck, listenDecks, listenHostRooms } from './db.js';

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
const btnEnterHost = document.getElementById('btn-enter-host');

// Host Lobby
const elNewRoomTitle = document.getElementById('new-room-title');
const btnCreateRoom = document.getElementById('btn-create-room');
const elHostRoomList = document.getElementById('host-room-list');

// Host Dashboard
const elHostRoomTitle = document.getElementById('host-room-title');
const elHostPin = document.getElementById('host-pin');
const elHostPlayerCount = document.getElementById('host-player-count');
const elHostPlayerList = document.getElementById('host-player-list');
const btnHostStart = document.getElementById('btn-host-start');
const btnHostVoid = document.getElementById('btn-host-void');
const settingWatchTime = document.getElementById('setting-watch-time');
const settingGuessTime = document.getElementById('setting-guess-time');
const settingCardCount = document.getElementById('setting-card-count');
const btnSaveSettings = document.getElementById('btn-save-settings');
const btnBackLobby = document.getElementById('btn-back-lobby');

// Card Manager
const inputEmotion = document.getElementById('input-emotion');
const btnAddEmotion = document.getElementById('btn-add-emotion');
const listEmotions = document.getElementById('list-emotions');
const inputSituation = document.getElementById('input-situation');
const btnAddSituation = document.getElementById('btn-add-situation');
const listSituations = document.getElementById('list-situations');

const deckSelector = document.getElementById('deck-selector');
const btnLoadDeck = document.getElementById('btn-load-deck');
const inputDeckName = document.getElementById('input-deck-name');
const btnSaveDeck = document.getElementById('btn-save-deck');

// Waiting / Actor / Blind / Guess / Sync / Result (Omitted DOM queries for brevity, assuming existing references below work)
const elMyNickname = document.getElementById('my-nickname');
const elMyScore = document.getElementById('my-score');
const elWaitingMsg = document.getElementById('waiting-msg');
const elActorEmotion = document.getElementById('actor-emotion');
const elActorSituation = document.getElementById('actor-situation');
const btnActorDone = document.getElementById('btn-actor-done');
const elActorTimer = document.getElementById('actor-timer');
const elBlindTimer = document.getElementById('blind-timer');
const elGuess1Cards = document.getElementById('guess1-cards');
const elGuess2Cards = document.getElementById('guess2-cards');
const elGuess1Timer = document.getElementById('guess1-timer');
const elGuess2Timer = document.getElementById('guess2-timer');
const screenSync = document.getElementById('screen-sync');
const elSyncText = document.getElementById('sync-text');
const elResultEmotion = document.getElementById('result-emotion');
const elResultSituation = document.getElementById('result-situation');
const elResultList = document.getElementById('result-list');
const elResultTimer = document.getElementById('result-timer');
const elResultNextMsg = document.getElementById('result-next-msg');

// --- State ---
let isHost = false;
let myHostId = null;
let currentPin = null;
let currentUid = null;
let roomData = null;
let myDecks = {};

let localTimerInterval = null;
let hostTimerInterval = null;
let roomListenerUnsubscribe = null;

let myGuess1 = null;
let myGuess2 = null;

// On Load
window.addEventListener('DOMContentLoaded', () => {
    const lastNick = localStorage.getItem('lastNickname');
    if (lastNick) inputNickname.value = lastNick;
});

// --- Host Lobby Functions ---
btnEnterHost.addEventListener('click', () => {
    myHostId = localStorage.getItem('myHostId');
    if (!myHostId) {
        myHostId = `host_${Date.now()}`;
        localStorage.setItem('myHostId', myHostId);
    }
    isHost = true;
    showScreen('screen-host-lobby');
    
    listenHostRooms(myHostId, (rooms) => {
        elHostRoomList.innerHTML = '';
        Object.keys(rooms).forEach(pin => {
            const r = rooms[pin];
            const li = document.createElement('li');
            li.style.cursor = 'pointer';
            li.innerHTML = `<div><strong>[${pin}]</strong> ${r.title} <br><small>접속자: ${r.players ? Object.keys(r.players).length : 0}명</small></div>
            <button class="btn-primary" style="padding:5px 10px; font-size:1rem;">관리하기</button>`;
            li.onclick = () => enterHostRoom(pin);
            elHostRoomList.appendChild(li);
        });
    });

    listenDecks(myHostId, (decks) => {
        myDecks = decks;
        deckSelector.innerHTML = '<option value="">덱 선택 안함</option>';
        Object.keys(decks).forEach(id => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.innerText = decks[id].name;
            deckSelector.appendChild(opt);
        });
    });
});

btnCreateRoom.addEventListener('click', async () => {
    const title = elNewRoomTitle.value.trim();
    if(!title) return alert('방 제목을 입력하세요.');
    btnCreateRoom.disabled = true;
    try {
        await createRoom(myHostId, title);
        elNewRoomTitle.value = '';
    } catch (e) {
        alert(e.message);
    } finally {
        btnCreateRoom.disabled = false;
    }
});

function enterHostRoom(pin) {
    currentPin = pin;
    if (roomListenerUnsubscribe) roomListenerUnsubscribe(); // Unsubscribe prev room
    roomListenerUnsubscribe = listenRoom(currentPin, handleHostUpdate);
    showScreen('screen-host');
}

btnBackLobby.addEventListener('click', () => {
    if (roomListenerUnsubscribe) roomListenerUnsubscribe();
    roomListenerUnsubscribe = null;
    currentPin = null;
    clearInterval(hostTimerInterval);
    showScreen('screen-host-lobby');
});

// --- Host Dashboard Functions ---
function handleHostUpdate(data) {
    if (!data) return;
    roomData = data;
    
    elHostRoomTitle.innerText = `👑 ${data.title}`;
    elHostPin.innerText = currentPin;
    
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

    // Render Cards
    renderHostCards(data.cards);

    // Host authoritative logic
    clearInterval(hostTimerInterval);
    const now = Date.now();

    if (data.status === 'acting' && data.currentRound) {
        const elapsed = (now - data.currentRound.startTime) / 1000;
        if (elapsed > data.settings.watchTime) {
            updateRoom(currentPin, { status: 'guessing', 'currentRound/guessStartTime': Date.now() + 1500 });
        } else {
            hostTimerInterval = setInterval(() => handleHostUpdate(data), 1000);
        }
    } else if (data.status === 'guessing' && data.currentRound) {
        const elapsed = (now - data.currentRound.guessStartTime) / 1000;
        let allGuessed = true;
        Object.keys(players).forEach(uid => {
            if (uid !== data.currentRound.actorId && !players[uid].hasGuessed) {
                if (players[uid].joinTime < data.currentRound.startTime) allGuessed = false;
            }
        });

        if (elapsed > data.settings.guessTime || allGuessed) {
            calculateScores(data);
        } else {
            hostTimerInterval = setInterval(() => handleHostUpdate(data), 1000);
        }
    } else if (data.status === 'result' && data.currentRound) {
        if (!data.currentRound.nextRoundTime) {
            updateRoom(currentPin, { 'currentRound/nextRoundTime': Date.now() + 10000 });
        } else if (now >= data.currentRound.nextRoundTime) {
            btnHostStart.click();
        } else {
            hostTimerInterval = setInterval(() => handleHostUpdate(data), 1000);
        }
    }
}

// --- Card Management ---
function renderHostCards(cards) {
    if (!cards) return;
    listEmotions.innerHTML = '';
    (cards.emotions || []).forEach((w, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${w}</span> <button class="btn-delete-word" data-idx="${idx}" data-type="emotions">X</button>`;
        listEmotions.appendChild(li);
    });
    listSituations.innerHTML = '';
    (cards.situations || []).forEach((w, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${w}</span> <button class="btn-delete-word" data-idx="${idx}" data-type="situations">X</button>`;
        listSituations.appendChild(li);
    });

    document.querySelectorAll('.btn-delete-word').forEach(btn => {
        btn.onclick = async (e) => {
            const type = e.target.dataset.type;
            const idx = parseInt(e.target.dataset.idx);
            let arr = [...roomData.cards[type]];
            arr.splice(idx, 1);
            await updateRoom(currentPin, { [`cards/${type}`]: arr });
        };
    });
}

btnAddEmotion.addEventListener('click', async () => {
    const w = inputEmotion.value.trim();
    if(w) {
        let arr = [...(roomData.cards.emotions || []), w];
        await updateRoom(currentPin, { 'cards/emotions': arr });
        inputEmotion.value = '';
    }
});

btnAddSituation.addEventListener('click', async () => {
    const w = inputSituation.value.trim();
    if(w) {
        let arr = [...(roomData.cards.situations || []), w];
        await updateRoom(currentPin, { 'cards/situations': arr });
        inputSituation.value = '';
    }
});

btnSaveDeck.addEventListener('click', async () => {
    const name = inputDeckName.value.trim();
    if(!name) return alert('덱 이름을 입력하세요.');
    await saveDeck(myHostId, name, roomData.cards);
    inputDeckName.value = '';
    alert('저장되었습니다!');
});

btnLoadDeck.addEventListener('click', async () => {
    const deckId = deckSelector.value;
    if(!deckId) return alert('불러올 덱을 선택하세요.');
    const deck = myDecks[deckId];
    if(deck) {
        await updateRoom(currentPin, {
            'cards/emotions': deck.emotions || [],
            'cards/situations': deck.situations || []
        });
        alert('덱을 성공적으로 불러왔습니다!');
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

    const emotions = roomData.cards.emotions || [];
    const situations = roomData.cards.situations || [];
    if(emotions.length < 2 || situations.length < 2) return alert('감정과 상황 카드가 최소 2개 이상 필요합니다.');

    const updates = {};
    players.forEach(uid => {
        updates[`players/${uid}/hasGuessed`] = false;
        updates[`players/${uid}/guess1`] = null;
        updates[`players/${uid}/guess2`] = null;
        updates[`players/${uid}/guessTime`] = null;
    });

    let unactedPlayers = players.filter(uid => !roomData.players[uid].acted);
    if (unactedPlayers.length === 0) {
        players.forEach(uid => updates[`players/${uid}/acted`] = false);
        unactedPlayers = players;
    }
    const actorId = unactedPlayers[Math.floor(Math.random() * unactedPlayers.length)];
    updates[`players/${actorId}/acted`] = true;

    const targetEmotion = emotions[Math.floor(Math.random() * emotions.length)];
    const targetSituation = situations[Math.floor(Math.random() * situations.length)];

    updates['currentRound'] = {
        actorId, targetEmotion, targetSituation,
        startTime: Date.now(), guessStartTime: 0, isVoided: false
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
    }
});

async function calculateScores(data) {
    if (data.currentRound.isVoided) {
        await updateRoom(currentPin, { status: 'result' });
        return;
    }

    const { actorId, targetEmotion, targetSituation, startTime } = data.currentRound;
    const players = data.players || {};
    
    let correctGuessers = [];
    let wrongGuessers = [];
    let timeoutGuessers = [];

    Object.keys(players).forEach(uid => {
        if (uid === actorId) return;
        const p = players[uid];
        if (p.joinTime > startTime) return;

        if (!p.hasGuessed) timeoutGuessers.push(uid);
        else if (p.guess1 === targetEmotion && p.guess2 === targetSituation) correctGuessers.push({ uid, guessTime: p.guessTime });
        else wrongGuessers.push(uid);
    });

    correctGuessers.sort((a, b) => a.guessTime - b.guessTime);
    const updates = {};
    
    let actorTotal = 10 + (correctGuessers.length * 5);
    updates[`players/${actorId}/score`] = (players[actorId].score || 0) + actorTotal;

    correctGuessers.forEach((g, index) => {
        let pts = index === 0 ? 30 : index === 1 ? 20 : 10;
        updates[`players/${g.uid}/score`] = (players[g.uid].score || 0) + pts;
    });

    wrongGuessers.forEach(uid => {
        updates[`players/${uid}/score`] = (players[uid].score || 0) - 5;
        updates[`players/${uid}/penalties`] = (players[uid].penalties || 0) + 1;
    });
    timeoutGuessers.forEach(uid => updates[`players/${uid}/penalties`] = (players[uid].penalties || 0) + 1);

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
    if (!me) return; 

    elMyScore.innerText = me.score;
    const amActor = data.currentRound?.actorId === currentUid;
    const joinedMidRound = me.joinTime > data.currentRound?.startTime;

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
        if (lastStatus === 'acting') showSyncPopup();
        
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

btnActorDone.addEventListener('click', async () => {
    if (!roomData || roomData.status !== 'acting') return;
    btnActorDone.disabled = true;
    await updateRoom(currentPin, { status: 'guessing', 'currentRound/guessStartTime': Date.now() + 1500 });
    setTimeout(() => { btnActorDone.disabled = false; }, 2000);
});

// Timers
function updateActorTimer(st, wt) {
    clearInterval(localTimerInterval);
    localTimerInterval = setInterval(() => {
        let left = Math.ceil(wt - (Date.now() - st)/1000);
        elActorTimer.innerText = Math.max(0, left);
    }, 200);
}
function updateBlindTimer(st, wt) {
    clearInterval(localTimerInterval);
    localTimerInterval = setInterval(() => {
        let left = Math.ceil(wt - (Date.now() - st)/1000);
        elBlindTimer.innerText = Math.max(0, left);
    }, 200);
}
function updateGuessTimer(st, gt) {
    clearInterval(localTimerInterval);
    localTimerInterval = setInterval(() => {
        let left = Math.ceil(gt - (Date.now() - st)/1000);
        elGuess1Timer.innerText = Math.max(0, left);
        elGuess2Timer.innerText = Math.max(0, left);
    }, 200);
}
function updateResultTimer(nt) {
    clearInterval(localTimerInterval);
    localTimerInterval = setInterval(() => {
        let left = Math.ceil((nt - Date.now())/1000);
        elResultTimer.innerText = Math.max(0, left);
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
            void elSyncText.offsetWidth;
            elSyncText.classList.add('zoom-in');
        } else if (count === 0) {
            elSyncText.innerText = "시작!";
        } else {
            clearInterval(intv);
            screenSync.classList.add('hidden');
        }
    }, 400);
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
                elGuess2Cards.style.pointerEvents = 'none';
                await submitGuess(currentPin, currentUid, myGuess1, myGuess2, Date.now() - r.guessStartTime);
                elGuess2Cards.style.pointerEvents = 'auto';
                showScreen('screen-waiting');
                elWaitingMsg.innerText = "결과를 기다리는 중...";
            };
            elGuess2Cards.appendChild(div);
        });
    }
}
