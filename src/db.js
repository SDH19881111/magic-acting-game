import { db } from './firebase.js';
import { ref, set, get, update, onValue, serverTimestamp, remove, runTransaction } from "firebase/database";

const DEFAULT_CARDS = {
    emotions: ['기쁨', '슬픔', '분노', '놀람', '두려움', '당황', '행복', '짜증'],
    situations: ['복권에 당첨되었을 때', '길을 잃었을 때', '숙제를 안 했을 때', '생일 파티에서', '유령을 보았을 때', '맛있는 걸 먹을 때', '넘어졌을 때', '칭찬 받았을 때']
};
const DEFAULT_SETTINGS = { watchTime: 30, guessTime: 15, cardCount: 6 };

// Firebase 연결 지연(가짜 설정) 감지용 타임아웃 래퍼
const withTimeout = (promise) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase 연결 지연: src/firebase.js 파일에 실제 Firebase 설정값을 입력했는지 확인해주세요!')), 3000))
]);

// --- Host 로그인 (아이디별 비밀번호 해시를 DB에 저장) ---
export const loginOrRegisterHost = async (hostId, passHash) => {
    const authRef = ref(db, `hostAuth/${hostId}`);
    const snapshot = await withTimeout(get(authRef));
    if (!snapshot.exists()) {
        await set(authRef, { passHash, createdAt: serverTimestamp() });
        return 'created';
    }
    return snapshot.val().passHash === passHash ? 'ok' : 'wrong';
};

// --- 방 생성 (extra로 카드/설정 복제 지원) ---
export const createRoom = async (hostId, title, extra = {}) => {
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const roomRef = ref(db, `rooms/${pin}`);

    const snapshot = await withTimeout(get(roomRef));
    if (snapshot.exists()) {
        return createRoom(hostId, title, extra); // PIN 충돌 시 재시도
    }

    await set(roomRef, {
        hostId,
        title: title || '새로운 게임 방',
        status: 'waiting', // waiting, acting, guessing, result, finished
        settings: extra.settings || { ...DEFAULT_SETTINGS },
        currentRound: null,
        players: {},
        cards: extra.cards || { ...DEFAULT_CARDS }
    });

    return pin;
};

// --- 방 복제 (같은 덱/설정으로 새 방) ---
export const duplicateRoom = async (hostId, source) => {
    const cards = source.cards
        ? { emotions: source.cards.emotions || [], situations: source.cards.situations || [] }
        : undefined;
    const settings = source.settings ? { ...DEFAULT_SETTINGS, ...source.settings } : undefined;
    return createRoom(hostId, `${source.title || '게임 방'} (복사)`, { cards, settings });
};

export const joinRoom = async (pin, nickname) => {
    const roomRef = ref(db, `rooms/${pin}`);
    const snapshot = await withTimeout(get(roomRef));

    if (!snapshot.exists()) {
        throw new Error('방을 찾을 수 없습니다.');
    }

    let uid = localStorage.getItem(`uid_${pin}`);
    if (!uid) {
        uid = `user_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        localStorage.setItem(`uid_${pin}`, uid);
    }
    localStorage.setItem('lastNickname', nickname);

    const playerRef = ref(db, `rooms/${pin}/players/${uid}`);
    const playerSnapshot = await get(playerRef);

    if (!playerSnapshot.exists()) {
        await set(playerRef, {
            nickname,
            score: 100, // 기본 점수 100
            penalties: 0,
            acted: false,
            hasGuessed: false,
            guess1: null,
            guess2: null,
            guessTime: null,
            guessServerTime: null,
            roundScore: 0,
            roundPenalty: 0,
            joinTime: serverTimestamp()
        });
    } else {
        await update(playerRef, { nickname });
    }

    return { uid, roomData: snapshot.val() };
};

// 채점을 여러 클라이언트가 동시에 하지 않도록 '채점 권한'을 트랜잭션으로 한 명만 획득.
// 획득한 클라이언트가 도중에 끊겨도 5초 뒤 다른 클라이언트가 재획득해 진행이 멈추지 않도록 함.
export const claimScoring = async (pin) => {
    const claimRef = ref(db, `rooms/${pin}/currentRound/scoreClaim`);
    const res = await runTransaction(claimRef, (cur) => {
        const now = Date.now();
        if (cur && cur.at && now - cur.at < 5000) return; // 유효한 잠금이 있으면 중단(=획득 실패)
        return { at: now };
    });
    return res.committed; // true면 이 클라이언트가 채점 권한을 얻음
};

// 다음 라운드 구성(연기자/문제 선정)을 여러 클라이언트가 동시에 하지 않도록,
// 특정 전환(key)에 대해 한 명만 권한을 얻게 함. 승자가 끊겨도 5초 뒤 재획득 가능(복구).
export const claimTransition = async (pin, key) => {
    const claimRef = ref(db, `rooms/${pin}/transitionClaim`);
    const res = await runTransaction(claimRef, (cur) => {
        const now = Date.now();
        // 같은 전환에 유효한 잠금이 살아있으면 중단(=획득 실패)
        if (cur && cur.key === key && cur.at && now - cur.at < 5000) return;
        return { key, at: now };
    });
    return res.committed;
};

export const listenRoom = (pin, callback) => {
    const roomRef = ref(db, `rooms/${pin}`);
    return onValue(roomRef, (snapshot) => {
        callback(snapshot.val());
    });
};

export const updateRoom = async (pin, updates) => {
    const roomRef = ref(db, `rooms/${pin}`);
    await update(roomRef, updates);
};

export const updatePlayer = async (pin, uid, updates) => {
    const playerRef = ref(db, `rooms/${pin}/players/${uid}`);
    await update(playerRef, updates);
};

export const kickPlayer = async (pin, uid) => {
    await remove(ref(db, `rooms/${pin}/players/${uid}`));
};

export const submitGuess = async (pin, uid, guess1, guess2, guessTime) => {
    const playerRef = ref(db, `rooms/${pin}/players/${uid}`);
    await update(playerRef, {
        hasGuessed: true,
        guess1,
        guess2,
        guessTime,
        guessServerTime: serverTimestamp() // 순위 판정용 서버시각(기기 시계 오차 무관)
    });
};

export const saveDeck = async (hostId, deckName, cards) => {
    const deckId = `deck_${Date.now()}`;
    const deckRef = ref(db, `decks/${hostId}/${deckId}`);
    await set(deckRef, {
        name: deckName,
        emotions: cards.emotions || [],
        situations: cards.situations || [],
        createdAt: serverTimestamp()
    });
};

export const listenDecks = (hostId, callback) => {
    const decksRef = ref(db, `decks/${hostId}`);
    return onValue(decksRef, (snapshot) => {
        callback(snapshot.val() || {});
    });
};

export const listenHostRooms = (hostId, callback) => {
    const roomsRef = ref(db, `rooms`);
    // 규모가 작아 전체를 받아 로컬에서 hostId로 필터링합니다.
    return onValue(roomsRef, (snapshot) => {
        const allRooms = snapshot.val() || {};
        const myRooms = {};
        Object.keys(allRooms).forEach(pin => {
            if (allRooms[pin].hostId === hostId) {
                myRooms[pin] = allRooms[pin];
            }
        });
        callback(myRooms);
    });
};

export const removeRoom = async (pin) => {
    const roomRef = ref(db, `rooms/${pin}`);
    await remove(roomRef);
};

export const finishRoom = async (pin, players) => {
    // 최종 페널티 정산 후 종료 상태로 전환 (절대값 기록 → 여러 번 호출해도 안전)
    const updates = {};
    updates['status'] = 'finished';
    Object.keys(players || {}).forEach(uid => {
        const p = players[uid];
        const penalties = p.penalties || 0;
        const finalScore = (p.score || 0) - (penalties * 20);
        updates[`players/${uid}/finalScore`] = finalScore;
    });

    const roomRef = ref(db, `rooms/${pin}`);
    await update(roomRef, updates);
};
