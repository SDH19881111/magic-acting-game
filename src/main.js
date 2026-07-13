import './style.css';
import {
    createRoom, joinRoom, listenRoom, updateRoom, submitGuess,
    saveDeck, listenDecks, listenHostRooms, removeRoom, finishRoom,
    loginOrRegisterHost, kickPlayer, duplicateRoom
} from './db.js';

// --- Helpers ---
// HTML 이스케이프 (닉네임/카드 등 사용자 입력을 innerHTML에 넣을 때 XSS 방지)
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// 비밀번호 해시 (SHA-256, secure context 필요: https 또는 localhost)
async function hashPassword(hostId, password) {
    const enc = new TextEncoder().encode(`magic-acting::${hostId}::${password}`);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 아이디(이름) → Firebase 경로에 안전한 hostId
function hostIdFromName(name) {
    return 'host_' + name.trim().toLowerCase().replace(/[.#$[\]/\s]+/g, '_');
}

// 시계 오차(서버 joinTime vs 호스트 Date.now startTime)를 흡수하기 위한 버퍼
const JOIN_BUFFER = 3000;
function joinedBeforeRound(player, round) {
    if (!round) return true;
    return (player.joinTime || 0) <= (round.startTime || 0) + JOIN_BUFFER;
}

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

// Host Login Modal
const modalHostLogin = document.getElementById('modal-host-login');
const hostLoginId = document.getElementById('host-login-id');
const hostLoginPw = document.getElementById('host-login-pw');
const btnHostLoginSubmit = document.getElementById('btn-host-login-submit');
const btnHostLoginCancel = document.getElementById('btn-host-login-cancel');
const hostLoginError = document.getElementById('host-login-error');

// Host Lobby
const elNewRoomTitle = document.getElementById('new-room-title');
const btnCreateRoom = document.getElementById('btn-create-room');
const elHostRoomList = document.getElementById('host-room-list');
const btnLobbyStart = document.getElementById('btn-lobby-start');
const btnLobbyEnd = document.getElementById('btn-lobby-end');
const btnLobbyDelete = document.getElementById('btn-lobby-delete');
const chkSelectAll = document.getElementById('chk-select-all');
const btnLogout = document.getElementById('btn-logout');

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

// Waiting / Actor / Blind / Guess / Sync / Result
const elMyNickname = document.getElementById('my-nickname');
const elMyScore = document.getElementById('my-score');
const elWaitingMsg = document.getElementById('waiting-msg');
const readyActorBlock = document.getElementById('ready-actor');
const readyGuesserBlock = document.getElementById('ready-guesser');
const btnReadyStart = document.getElementById('btn-ready-start');
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

const elFinalResultList = document.getElementById('final-result-list');

// --- State ---
let isHost = false;
let myHostId = null;
let currentPin = null;
let currentUid = null;
let roomData = null;
let myDecks = {};
let hostRoomsData = {};   // 로비에서 관리하는 방들의 최신 데이터

let localTimerInterval = null;
let roomListenerUnsubscribe = null;   // 호스트 대시보드 방 리스너
let playerRoomUnsub = null;           // 플레이어 방 리스너
let hostRoomsUnsub = null;
let decksUnsub = null;

let myGuess1 = null;
let myGuess2 = null;
let wasInRoom = false;               // 플레이어가 방에 실제로 들어와 있었는지 (강퇴 감지용)

let isStartingRound = false;         // 다음 라운드 시작 재진입 방지
let autoStartedKey = null;           // 자동 시작한 nextRoundTime 기록 (중복 시작 방지)

// On Load
window.addEventListener('DOMContentLoaded', () => {
    const lastNick = localStorage.getItem('lastNickname');
    if (lastNick) inputNickname.value = lastNick;
});

// --- Host Login ---
function openLoginModal() {
    hostLoginError.innerText = '';
    hostLoginPw.value = '';
    const lastName = localStorage.getItem('lastHostName');
    if (lastName) hostLoginId.value = lastName;
    modalHostLogin.classList.remove('hidden');
    hostLoginId.focus();
}
function closeLoginModal() {
    modalHostLogin.classList.add('hidden');
}

btnEnterHost.addEventListener('click', openLoginModal);
btnHostLoginCancel.addEventListener('click', closeLoginModal);
hostLoginPw.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnHostLoginSubmit.click(); });
hostLoginId.addEventListener('keydown', (e) => { if (e.key === 'Enter') hostLoginPw.focus(); });

btnHostLoginSubmit.addEventListener('click', async () => {
    const name = hostLoginId.value.trim();
    const pw = hostLoginPw.value;
    if (!name) { hostLoginError.innerText = '아이디를 입력하세요.'; return; }
    if (!pw) { hostLoginError.innerText = '비밀번호를 입력하세요.'; return; }

    btnHostLoginSubmit.disabled = true;
    hostLoginError.innerText = '';
    try {
        const hostId = hostIdFromName(name);
        const passHash = await hashPassword(hostId, pw);
        const res = await loginOrRegisterHost(hostId, passHash);
        if (res === 'wrong') {
            hostLoginError.innerText = '비밀번호가 올바르지 않습니다.';
            return;
        }
        localStorage.setItem('lastHostName', name);
        localStorage.setItem('myHostId', hostId);
        closeLoginModal();
        if (res === 'created') alert('새 계정으로 등록되었습니다. 다음부터는 이 아이디/비밀번호로 로그인하세요.');
        startHostSession(hostId);
    } catch (e) {
        hostLoginError.innerText = e.message || '로그인 중 오류가 발생했습니다.';
    } finally {
        btnHostLoginSubmit.disabled = false;
    }
});

function startHostSession(hostId) {
    myHostId = hostId;
    isHost = true;
    showScreen('screen-host-lobby');

    if (hostRoomsUnsub) hostRoomsUnsub();
    hostRoomsUnsub = listenHostRooms(myHostId, renderRoomList);

    if (decksUnsub) decksUnsub();
    decksUnsub = listenDecks(myHostId, (decks) => {
        myDecks = decks;
        deckSelector.innerHTML = '<option value="">덱 선택 안함</option>';
        Object.keys(decks).forEach(id => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.innerText = decks[id].name;
            deckSelector.appendChild(opt);
        });
    });
}

btnLogout?.addEventListener('click', () => {
    if (hostRoomsUnsub) { hostRoomsUnsub(); hostRoomsUnsub = null; }
    if (decksUnsub) { decksUnsub(); decksUnsub = null; }
    if (roomListenerUnsubscribe) { roomListenerUnsubscribe(); roomListenerUnsubscribe = null; }
    isHost = false;
    myHostId = null;
    currentPin = null;
    roomData = null;
    hostRoomsData = {};
    showScreen('screen-landing');
});

// --- Host Lobby: 방 목록 렌더링 ---
const STATUS_LABEL = {
    waiting: '대기중', acting: '진행중', guessing: '진행중',
    result: '결과 발표', finished: '종료됨', calculating_final: '종료 처리중'
};

function renderRoomList(rooms) {
    hostRoomsData = rooms;
    if (chkSelectAll) chkSelectAll.checked = false;
    elHostRoomList.innerHTML = '';

    const pins = Object.keys(rooms);
    if (pins.length === 0) {
        elHostRoomList.innerHTML = '<li style="opacity:0.7; justify-content:center;">아직 만든 방이 없습니다.</li>';
        return;
    }

    pins.forEach(pin => {
        const r = rooms[pin];
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.alignItems = 'center';
        const count = r.players ? Object.keys(r.players).length : 0;
        const statusLabel = STATUS_LABEL[r.status] || r.status;
        li.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                <input type="checkbox" class="room-checkbox" value="${pin}" style="width:20px; height:20px;">
                <div><strong>[${pin}]</strong> ${escapeHtml(r.title)} <br><small>상태: ${statusLabel} | 접속자: ${count}명</small></div>
            </div>
            <div class="room-actions">
                <button class="btn-secondary btn-dup-room" data-pin="${pin}" title="같은 덱으로 새 방 만들기">복제</button>
                <button class="btn-primary btn-manage-room" data-pin="${pin}">관리</button>
            </div>
        `;
        elHostRoomList.appendChild(li);
    });

    elHostRoomList.querySelectorAll('.btn-manage-room').forEach(btn => {
        btn.onclick = (e) => enterHostRoom(e.currentTarget.dataset.pin);
    });
    elHostRoomList.querySelectorAll('.btn-dup-room').forEach(btn => {
        btn.onclick = async (e) => {
            const pin = e.currentTarget.dataset.pin;
            const src = hostRoomsData[pin];
            if (!src) return;
            e.currentTarget.disabled = true;
            try {
                await duplicateRoom(myHostId, src);
            } catch (err) {
                alert(err.message);
            } finally {
                e.currentTarget.disabled = false;
            }
        };
    });
}

function getCheckedPins() {
    return Array.from(document.querySelectorAll('.room-checkbox:checked')).map(cb => cb.value);
}

chkSelectAll?.addEventListener('change', () => {
    document.querySelectorAll('.room-checkbox').forEach(cb => { cb.checked = chkSelectAll.checked; });
});

btnCreateRoom.addEventListener('click', async () => {
    const title = elNewRoomTitle.value.trim();
    if (!title) return alert('방 제목을 입력하세요.');
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

// 선택 시작: 방에 들어가지 않고도 선택한 방들의 첫 라운드를 시작
btnLobbyStart.addEventListener('click', async () => {
    const checked = getCheckedPins();
    if (checked.length === 0) return alert('시작할 방을 선택하세요.');

    let started = 0;
    const skipped = [];
    for (const pin of checked) {
        const data = hostRoomsData[pin];
        if (!data) { skipped.push(`[${pin}] 정보 없음`); continue; }
        if (data.status !== 'waiting') {
            skipped.push(`[${pin}] 이미 진행중`); continue;
        }
        const { updates, error } = buildReadyUpdates(data, Date.now());
        if (error) { skipped.push(`[${pin}] ${error}`); continue; }
        try {
            await updateRoom(pin, updates);
            started++;
        } catch (e) {
            skipped.push(`[${pin}] ${e.message}`);
        }
    }
    let msg = `${started}개 방을 시작했습니다.`;
    if (skipped.length) msg += `\n\n건너뛴 방:\n${skipped.join('\n')}`;
    alert(msg);
});

// 선택 종료: 호스트가 직접 최종 정산 (접속자가 없어도 확실히 종료됨)
btnLobbyEnd.addEventListener('click', async () => {
    const checked = getCheckedPins();
    if (checked.length === 0) return alert('종료할 방을 선택하세요.');
    if (!confirm(`선택한 ${checked.length}개의 방을 최종 종료하시겠습니까?\n모든 플레이어 화면에 최종 순위표가 표시됩니다.`)) return;

    for (const pin of checked) {
        const data = hostRoomsData[pin];
        await finishRoom(pin, (data && data.players) || {});
    }
    alert('종료 처리되었습니다.');
});

btnLobbyDelete.addEventListener('click', async () => {
    const checked = getCheckedPins();
    if (checked.length === 0) return alert('삭제할 방을 선택하세요.');
    if (!confirm(`선택한 ${checked.length}개의 방 데이터를 영구 삭제하시겠습니까?`)) return;

    for (const pin of checked) {
        await removeRoom(pin);
    }
    alert('삭제 완료');
});

function enterHostRoom(pin) {
    currentPin = pin;
    if (roomListenerUnsubscribe) roomListenerUnsubscribe(); // 이전 방 리스너 해제
    roomListenerUnsubscribe = listenRoom(currentPin, handleHostUpdate);
    showScreen('screen-host');
}

btnBackLobby.addEventListener('click', () => {
    if (roomListenerUnsubscribe) roomListenerUnsubscribe();
    roomListenerUnsubscribe = null;
    currentPin = null;
    roomData = null;
    showScreen('screen-host-lobby');
});

// 문자열 → 안정적인 정수 해시 (연기자 이탈 시 재구성 seed용)
function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
}

// --- 다음 라운드를 '준비(ready)' 상태로 구성하는 updates 생성 ---
// seed를 기준으로 연기자/문제를 '결정론적으로' 고릅니다.
// 같은 스냅샷 + 같은 seed면 모든 클라이언트가 동일한 결과를 계산하므로,
// 여러 명이 동시에 써도 값이 같아(멱등) 호스트 없이도 안전하게 자동 진행됩니다.
function buildReadyUpdates(data, seed) {
    if (!data || !data.players || Object.keys(data.players).length === 0) {
        return { error: '참가자가 없습니다.' };
    }
    const players = Object.keys(data.players).sort(); // 정렬로 순서 고정 → 결정론 보장
    if (players.length < 2) return { error: '최소 2명이 필요합니다.' };

    const emotions = data.cards?.emotions || [];
    const situations = data.cards?.situations || [];
    if (emotions.length < 2 || situations.length < 2) {
        return { error: '감정/상황 카드가 각각 2개 이상 필요합니다.' };
    }

    const updates = {};
    players.forEach(uid => {
        updates[`players/${uid}/hasGuessed`] = false;
        updates[`players/${uid}/guess1`] = null;
        updates[`players/${uid}/guess2`] = null;
        updates[`players/${uid}/guessTime`] = null;
        updates[`players/${uid}/roundScore`] = 0;
        updates[`players/${uid}/roundPenalty`] = 0;
    });

    let unactedPlayers = players.filter(uid => !data.players[uid].acted);
    if (unactedPlayers.length === 0) {
        players.forEach(uid => (updates[`players/${uid}/acted`] = false));
        unactedPlayers = players; // 이미 정렬됨
    }

    const s = Math.abs(Math.floor(seed || 0));
    const actorId = unactedPlayers[s % unactedPlayers.length];
    updates[`players/${actorId}/acted`] = true;

    const targetEmotion = emotions[s % emotions.length];
    const targetSituation = situations[(s + 7) % situations.length];

    updates['currentRound'] = {
        actorId, targetEmotion, targetSituation,
        startTime: null, guessStartTime: 0, isVoided: false, nextRoundTime: null
    };
    updates['status'] = 'ready';
    return { updates };
}

// --- Core Distributed Logic ---
// 접속한 모든 클라이언트가 타이머를 확인하고 상태를 전이시킵니다.
// (점수는 절대값으로 기록하므로 여러 클라이언트가 동시에 써도 결과가 같습니다.)
function runDistributedChecks(data) {
    if (!data || !currentPin) return;
    const now = Date.now();

    if (data.status === 'calculating_final') {
        finishRoom(currentPin, data.players || {});
        return;
    }

    if (data.status === 'acting' && data.currentRound) {
        const endTime = data.currentRound.startTime + ((data.settings?.watchTime || 30) * 1000);
        if (now > endTime + 500) {
            updateRoom(currentPin, { status: 'guessing', 'currentRound/guessStartTime': endTime + 1500 });
        }
    } else if (data.status === 'guessing' && data.currentRound) {
        const endTime = data.currentRound.guessStartTime + ((data.settings?.guessTime || 15) * 1000);
        let allGuessed = true;
        Object.keys(data.players || {}).forEach(uid => {
            const p = data.players[uid];
            if (uid === data.currentRound.actorId) return;
            if (!joinedBeforeRound(p, data.currentRound)) return; // 라운드 도중 입장자는 무시
            if (!p.hasGuessed) allGuessed = false;
        });

        if (now > endTime + 500 || allGuessed) {
            calculateScores(data);
        }
    } else if (data.status === 'result' && data.currentRound && data.currentRound.nextRoundTime) {
        // 결과 카운트다운 종료 → 다음 라운드 '준비(ready)' 상태로 자동 전환.
        // 결정론적 계산이라 접속한 모든 클라이언트가 실행해도 결과가 동일(멱등).
        if (now > data.currentRound.nextRoundTime + 500 && !isStartingRound
            && autoStartedKey !== data.currentRound.nextRoundTime) {
            autoStartedKey = data.currentRound.nextRoundTime;
            transitionToReady(data, data.currentRound.startTime);
        }
    } else if (data.status === 'ready' && data.currentRound) {
        // 안전장치: 준비 상태에서 연기자가 나가버리면(강퇴/이탈) 다른 사람으로 재구성
        const actorId = data.currentRound.actorId;
        if (!data.players || !data.players[actorId]) {
            const rebuildKey = 'rebuild_' + actorId;
            if (!isStartingRound && autoStartedKey !== rebuildKey) {
                autoStartedKey = rebuildKey;
                transitionToReady(data); // seed 미지정 → 참가자 목록 해시로 결정론 계산
            }
        }
    }
}

// 다음 라운드를 ready 상태로 전환. seed가 없으면 참가자 uid 목록 해시를 사용(결정론).
async function transitionToReady(data, seed) {
    isStartingRound = true;
    try {
        const effectiveSeed = (seed != null)
            ? seed
            : hashString(Object.keys(data.players || {}).sort().join(','));
        const { updates, error } = buildReadyUpdates(data, effectiveSeed);
        if (!error) await updateRoom(currentPin, updates);
    } finally {
        isStartingRound = false;
    }
}

// 1초마다 분산 전이 확인
setInterval(() => {
    if (roomData) runDistributedChecks(roomData);
}, 1000);

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

    Object.keys(players).forEach(uid => {
        const p = players[uid];
        const li = document.createElement('li');
        if (uid === actorId) li.classList.add('is-actor');

        const info = document.createElement('span');
        info.textContent = `${p.nickname} : ${p.score}점 (패널티 ${p.penalties || 0})`;

        const kickBtn = document.createElement('button');
        kickBtn.className = 'btn-delete-word';
        kickBtn.textContent = '강퇴';
        kickBtn.onclick = async () => {
            if (confirm(`'${p.nickname}' 님을 방에서 내보낼까요?`)) {
                await kickPlayer(currentPin, uid);
            }
        };

        li.appendChild(info);
        li.appendChild(kickBtn);
        elHostPlayerList.appendChild(li);
    });

    if (data.settings) {
        settingWatchTime.value = data.settings.watchTime;
        settingGuessTime.value = data.settings.guessTime;
        settingCardCount.value = data.settings.cardCount;
    }

    // 첫 시작만 호스트가 누르고, 이후 라운드는 자동 진행되므로 대기 상태에서만 활성화
    btnHostStart.disabled = data.status !== 'waiting';

    renderHostCards(data.cards);
}

// --- Card Management ---
function renderHostCards(cards) {
    if (!cards) return;
    listEmotions.innerHTML = '';
    (cards.emotions || []).forEach((w, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${escapeHtml(w)}</span> <button class="btn-delete-word" data-idx="${idx}" data-type="emotions">X</button>`;
        listEmotions.appendChild(li);
    });
    listSituations.innerHTML = '';
    (cards.situations || []).forEach((w, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${escapeHtml(w)}</span> <button class="btn-delete-word" data-idx="${idx}" data-type="situations">X</button>`;
        listSituations.appendChild(li);
    });

    document.querySelectorAll('.btn-delete-word[data-type]').forEach(btn => {
        btn.onclick = async (e) => {
            const type = e.currentTarget.dataset.type;
            const idx = parseInt(e.currentTarget.dataset.idx);
            const arr = [...(roomData.cards?.[type] || [])];
            arr.splice(idx, 1);
            await updateRoom(currentPin, { [`cards/${type}`]: arr });
        };
    });
}

btnAddEmotion.addEventListener('click', async () => {
    const w = inputEmotion.value.trim();
    if (w) {
        const arr = [...(roomData.cards?.emotions || []), w];
        await updateRoom(currentPin, { 'cards/emotions': arr });
        inputEmotion.value = '';
    }
});

btnAddSituation.addEventListener('click', async () => {
    const w = inputSituation.value.trim();
    if (w) {
        const arr = [...(roomData.cards?.situations || []), w];
        await updateRoom(currentPin, { 'cards/situations': arr });
        inputSituation.value = '';
    }
});

btnSaveDeck.addEventListener('click', async () => {
    const name = inputDeckName.value.trim();
    if (!name) return alert('덱 이름을 입력하세요.');
    await saveDeck(myHostId, name, roomData.cards);
    inputDeckName.value = '';
    alert('저장되었습니다!');
});

btnLoadDeck.addEventListener('click', async () => {
    const deckId = deckSelector.value;
    if (!deckId) return alert('불러올 덱을 선택하세요.');
    const deck = myDecks[deckId];
    if (deck) {
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
    const { updates, error } = buildReadyUpdates(roomData, Date.now());
    if (error) return alert(error);
    await updateRoom(currentPin, updates);
});

btnHostVoid.addEventListener('click', async () => {
    // 결과 화면이 아니면: 진행중인 게임을 무효화하고 대기실로 (아직 점수 반영 전)
    if (roomData?.status !== 'result') {
        if (confirm('진행중인 게임을 무효화하고 대기실로 돌아갈까요?')) {
            await updateRoom(currentPin, { status: 'waiting', 'currentRound/isVoided': true });
        }
        return;
    }
    // 결과 화면이면: 이미 반영된 이번 라운드 점수/페널티를 되돌림
    if (roomData.currentRound?.isVoided) return alert('이미 무효 처리된 라운드입니다.');
    if (!confirm('이 라운드의 점수를 무효화(되돌리기)하시겠습니까?')) return;

    const players = roomData.players || {};
    const updates = { 'currentRound/isVoided': true };
    Object.keys(players).forEach(uid => {
        const p = players[uid];
        updates[`players/${uid}/score`] = (p.score || 0) - (p.roundScore || 0);
        updates[`players/${uid}/penalties`] = Math.max(0, (p.penalties || 0) - (p.roundPenalty || 0));
        updates[`players/${uid}/roundScore`] = 0;
        updates[`players/${uid}/roundPenalty`] = 0;
    });
    await updateRoom(currentPin, updates);
    alert('무효 처리되었습니다. (점수 원상복구)');
});

async function calculateScores(data) {
    if (!data.currentRound) return;

    if (data.currentRound.isVoided) {
        await updateRoom(currentPin, { status: 'result', 'currentRound/nextRoundTime': Date.now() + 10000 });
        return;
    }

    // 멱등성: nextRoundTime이 이미 있으면 점수 계산 완료된 것
    if (data.currentRound.nextRoundTime) return;

    const { actorId, targetEmotion, targetSituation } = data.currentRound;
    const players = data.players || {};

    const correctGuessers = [];
    const wrongGuessers = [];
    const timeoutGuessers = [];

    Object.keys(players).forEach(uid => {
        if (uid === actorId) return;
        const p = players[uid];
        if (!joinedBeforeRound(p, data.currentRound)) return;

        if (!p.hasGuessed) timeoutGuessers.push(uid);
        else if (p.guess1 === targetEmotion && p.guess2 === targetSituation) correctGuessers.push({ uid, guessTime: p.guessTime });
        else wrongGuessers.push(uid);
    });

    correctGuessers.sort((a, b) => a.guessTime - b.guessTime);
    const updates = {};

    const actorTotal = 10 + (correctGuessers.length * 5);
    updates[`players/${actorId}/score`] = (players[actorId].score || 0) + actorTotal;
    updates[`players/${actorId}/roundScore`] = actorTotal;
    updates[`players/${actorId}/roundPenalty`] = 0;

    correctGuessers.forEach((g, index) => {
        const pts = index === 0 ? 30 : index === 1 ? 20 : 10;
        updates[`players/${g.uid}/score`] = (players[g.uid].score || 0) + pts;
        updates[`players/${g.uid}/roundScore`] = pts;
        updates[`players/${g.uid}/roundPenalty`] = 0;
    });

    wrongGuessers.forEach(uid => {
        updates[`players/${uid}/score`] = (players[uid].score || 0) - 5;
        updates[`players/${uid}/roundScore`] = -5;
        updates[`players/${uid}/penalties`] = (players[uid].penalties || 0) + 1;
        updates[`players/${uid}/roundPenalty`] = 1;
    });
    timeoutGuessers.forEach(uid => {
        updates[`players/${uid}/penalties`] = (players[uid].penalties || 0) + 1;
        updates[`players/${uid}/roundScore`] = 0;
        updates[`players/${uid}/roundPenalty`] = 1;
    });

    updates['status'] = 'result';
    updates['currentRound/nextRoundTime'] = Date.now() + 10000;
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
        wasInRoom = false;
        lastStatus = null;

        elMyNickname.innerText = nickname;
        if (playerRoomUnsub) playerRoomUnsub();
        playerRoomUnsub = listenRoom(currentPin, handlePlayerUpdate);
    } catch (e) {
        alert(e.message);
    } finally {
        btnJoin.disabled = false;
    }
});

let lastStatus = null;

function handlePlayerUpdate(data) {
    if (!data) {
        // 방 자체가 삭제됨
        if (playerRoomUnsub) { playerRoomUnsub(); playerRoomUnsub = null; }
        alert('방이 삭제되었습니다.');
        location.reload();
        return;
    }
    roomData = data;

    const players = data.players || {};
    const me = players[currentUid];
    if (!me) {
        // 내가 방에 있다가 사라짐 → 강퇴됨
        if (wasInRoom) {
            wasInRoom = false;
            if (playerRoomUnsub) { playerRoomUnsub(); playerRoomUnsub = null; }
            alert('선생님에 의해 방에서 나가게 되었습니다.');
            location.reload();
        }
        return;
    }
    wasInRoom = true;

    elMyScore.innerText = me.score || 0;
    const amActor = data.currentRound?.actorId === currentUid;
    const joinedMidRound = !joinedBeforeRound(me, data.currentRound);

    if (data.status === 'finished') {
        showScreen('screen-final-result');
        elFinalResultList.innerHTML = '';
        const sorted = Object.values(players).sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));
        sorted.forEach((p, idx) => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${idx === 0 ? '👑' : ''} ${idx + 1}위. ${escapeHtml(p.nickname)}</span> <span>${p.finalScore ?? p.score ?? 0}점 (패널티 -${(p.penalties || 0) * 20}점 반영)</span>`;
            if (p.nickname === me.nickname) li.style.color = '#FCD34D';
            elFinalResultList.appendChild(li);
        });
    }
    else if (data.status === 'waiting') {
        showScreen('screen-waiting');
        elWaitingMsg.innerText = "선생님이 게임을 시작할 때까지 기다려주세요!";
    }
    else if (data.status === 'ready') {
        showScreen('screen-ready');
        if (amActor) {
            readyActorBlock.style.display = 'flex';
            readyGuesserBlock.style.display = 'none';
            btnReadyStart.classList.remove('disabled');
        } else {
            readyActorBlock.style.display = 'none';
            readyGuesserBlock.style.display = 'flex';
        }
    }
    else if (data.status === 'acting') {
        if (amActor) {
            showScreen('screen-actor');
            elActorEmotion.innerText = data.currentRound.targetEmotion;
            elActorSituation.innerText = data.currentRound.targetSituation;
            updateActorTimer(data.currentRound.startTime, data.settings?.watchTime || 30);
        } else {
            showScreen('screen-blind');
            updateBlindTimer(data.currentRound.startTime, data.settings?.watchTime || 30);
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
            updateGuessTimer(data.currentRound.guessStartTime, data.settings?.guessTime || 15);
        }
    }
    else if (data.status === 'result') {
        showScreen('screen-result');
        elResultEmotion.innerText = data.currentRound.targetEmotion;
        elResultSituation.innerText = data.currentRound.targetSituation;

        elResultList.innerHTML = '';
        const sorted = Object.values(players).sort((a, b) => (b.score || 0) - (a.score || 0));
        sorted.forEach((p, idx) => {
            const li = document.createElement('li');
            const roundPts = p.roundScore !== undefined
                ? (p.roundScore > 0 ? `<span style="color:#34D399; font-size:0.9rem;">(+${p.roundScore})</span>`
                    : p.roundScore < 0 ? `<span style="color:#F87171; font-size:0.9rem;">(${p.roundScore})</span>` : '')
                : '';
            li.innerHTML = `<span>${idx + 1}위. ${escapeHtml(p.nickname)}</span> <span>${p.score}점 ${roundPts}</span>`;
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

// 연기자가 '준비완료'를 누르면 실제 라운드(acting) 시작
btnReadyStart.addEventListener('click', async () => {
    if (!roomData || roomData.status !== 'ready') return;
    if (roomData.currentRound?.actorId !== currentUid) return;
    btnReadyStart.classList.add('disabled');
    await updateRoom(currentPin, { status: 'acting', 'currentRound/startTime': Date.now() });
});

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
        const left = Math.ceil(wt - (Date.now() - st) / 1000);
        elActorTimer.innerText = Math.max(0, left);
    }, 200);
}
function updateBlindTimer(st, wt) {
    clearInterval(localTimerInterval);
    localTimerInterval = setInterval(() => {
        const left = Math.ceil(wt - (Date.now() - st) / 1000);
        elBlindTimer.innerText = Math.max(0, left);
    }, 200);
}
function updateGuessTimer(st, gt) {
    clearInterval(localTimerInterval);
    localTimerInterval = setInterval(() => {
        const left = Math.ceil(gt - (Date.now() - st) / 1000);
        elGuess1Timer.innerText = Math.max(0, left);
        elGuess2Timer.innerText = Math.max(0, left);
    }, 200);
}
function updateResultTimer(nt) {
    clearInterval(localTimerInterval);
    localTimerInterval = setInterval(() => {
        const left = Math.ceil((nt - Date.now()) / 1000);
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
    const others = [...new Set(list.filter(item => item !== target))];
    others.sort(() => 0.5 - Math.random());
    const selected = [target, ...others.slice(0, count - 1)];
    selected.sort(() => 0.5 - Math.random());
    return selected;
}

function renderGuessCards(phase) {
    const r = roomData.currentRound;
    const c = roomData.cards;
    const cardCount = roomData.settings?.cardCount || 6;

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
