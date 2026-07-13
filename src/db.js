import { db } from './firebase.js';
import { ref, set, get, update, onValue, serverTimestamp, remove } from "firebase/database";

export const createRoom = async (hostId, title) => {
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const roomRef = ref(db, `rooms/${pin}`);
    
    // Add timeout to prevent hanging on fake config
    const snapshot = await Promise.race([
        get(roomRef),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase 연결 지연: src/firebase.js 파일에 실제 Firebase 설정값을 입력했는지 확인해주세요!')), 3000))
    ]);

    if (snapshot.exists()) {
        return createRoom(hostId, title); // Retry if PIN collision
    }

    await set(roomRef, {
        hostId,
        title: title || '새로운 게임 방',
        status: 'waiting', // waiting, acting, guessing, result
        settings: {
            watchTime: 30,
            guessTime: 15,
            cardCount: 6,
        },
        currentRound: null,
        players: {},
        cards: {
            emotions: ['기쁨', '슬픔', '분노', '놀람', '두려움', '당황', '행복', '짜증'],
            situations: ['복권에 당첨되었을 때', '길을 잃었을 때', '숙제를 안 했을 때', '생일 파티에서', '유령을 보았을 때', '맛있는 걸 먹을 때', '넘어졌을 때', '칭찬 받았을 때']
        }
    });

    return pin;
};

export const joinRoom = async (pin, nickname) => {
    const roomRef = ref(db, `rooms/${pin}`);
    
    // Add timeout to prevent hanging on fake config
    let snapshot;
    try {
        snapshot = await Promise.race([
            get(roomRef),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase 연결 지연: src/firebase.js 파일에 실제 Firebase 설정값을 입력했는지 확인해주세요!')), 3000))
        ]);
    } catch(e) {
        throw e;
    }

    if (!snapshot.exists()) {
        throw new Error('방을 찾을 수 없습니다.');
    }

    let uid = localStorage.getItem(`uid_${pin}`);
    if (!uid) {
        uid = `user_${Date.now()}_${Math.floor(Math.random()*1000)}`;
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
            joinTime: serverTimestamp()
        });
    } else {
        await update(playerRef, { nickname });
    }

    return { uid, roomData: snapshot.val() };
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

export const submitGuess = async (pin, uid, guess1, guess2, guessTime) => {
    const playerRef = ref(db, `rooms/${pin}/players/${uid}`);
    await update(playerRef, {
        hasGuessed: true,
        guess1,
        guess2,
        guessTime
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
    // Ideally we should use query and orderByChild('hostId'), but for simplicity and lack of index, 
    // we can listen to all rooms and filter locally, or use proper Firebase queries.
    // Let's use basic filtering for now since the app scale is small.
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
