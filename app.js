/**
 * Vinychat 5.2 — CALL FIX v2
 * - Fixed: call notifications now work reliably
 * - Fixed: proper initial/subsequent snapshot handling
 * - Personal = 1:1, Group = all members
 * - Delete chats, video calls
 */

const firebaseConfig = {
    apiKey: "AIzaSyBVK86LPh7qGO2sllS5G9Gxk7lCxJA-2Go",
    authDomain: "vinychat-c2c4c.firebaseapp.com",
    projectId: "vinychat-c2c4c",
    storageBucket: "vinychat-c2c4c.firebasestorage.app",
    messagingSenderId: "756427796615",
    appId: "1:756427796615:web:002f5a5080b0a3adc88822"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Инициализация Firebase Cloud Messaging для push-уведомлений
let messaging = null;
try {
    messaging = firebase.messaging();
    console.log('Firebase Messaging initialized');
} catch (e) {
    console.warn('Firebase Messaging not supported:', e);
}

/* ═══════════════════════════════════
   SOUND ENGINE
   ═══════════════════════════════════ */
class CallSounds {
    constructor() { this.ctx = null; this.activeNodes = []; this.ringInterval = null; this.stopped = false; }
    _ensure() {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
    }
    _beep(freq, dur, vol = 0.15) {
        if (this.stopped) return;
        this._ensure();
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = 'sine'; o.frequency.value = freq; g.gain.value = vol;
        o.connect(g); g.connect(this.ctx.destination);
        o.start(); o.stop(this.ctx.currentTime + dur);
        this.activeNodes.push(o);
        o.onended = () => { this.activeNodes = this.activeNodes.filter(n => n !== o); };
    }
    startDialing() { this.stopAll(); this.stopped = false; const r = () => { this._beep(440, 0.3, 0.12); setTimeout(() => this._beep(440, 0.3, 0.12), 400); }; r(); this.ringInterval = setInterval(r, 2500); }
    startRinging() { this.stopAll(); this.stopped = false; const r = () => { this._beep(587, 0.15, 0.18); setTimeout(() => this._beep(659, 0.15, 0.18), 200); setTimeout(() => this._beep(784, 0.2, 0.18), 400); }; r(); this.ringInterval = setInterval(r, 2000); }
    playConnected() { this.stopAll(); this.stopped = false; this._beep(523, 0.15, 0.1); setTimeout(() => this._beep(659, 0.15, 0.1), 100); setTimeout(() => this._beep(784, 0.2, 0.1), 200); }
    playHangup() { this.stopAll(); this.stopped = false; this._beep(440, 0.15, 0.1); setTimeout(() => this._beep(330, 0.15, 0.1), 150); setTimeout(() => this._beep(262, 0.25, 0.1), 300); }
    playMsgSent() { this.stopped = false; this._ensure(); const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = 'sine'; o.frequency.value = 800; g.gain.setValueAtTime(0.06, this.ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.08); o.connect(g); g.connect(this.ctx.destination); o.start(); o.stop(this.ctx.currentTime + 0.08); }
    playMsgReceived() { this.stopped = false; this._beep(660, 0.08, 0.06); setTimeout(() => this._beep(880, 0.1, 0.06), 80); }
    stopAll() { this.stopped = true; if (this.ringInterval) { clearInterval(this.ringInterval); this.ringInterval = null; } this.activeNodes.forEach(n => { try { n.stop(); } catch (e) { } }); this.activeNodes = []; }
}

/* ═══════════════════════════════════
   MODAL & UI HELPERS
   ═══════════════════════════════════ */

/* ═══════════════════════════════════
   WEBRTC AUDIO CALL ENGINE
   ═══════════════════════════════════ */
class GroupCall {
    constructor(sounds) {
        this.sounds = sounds;
        this.roomRef = null;
        this.roomId = null;
        this.myUid = null;
        this._isActive = false;
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = null;
        this.signalUnsub = null;
        this.roomUnsub = null;

        // Google's free STUN servers
        this.iceServers = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
    }

    get isActive() { return this._isActive; }

    async joinRoom(chatId, uid, withVideo = false) {
        console.log('[CALL] Joining room...', { withVideo });
        this.myUid = uid;
        this._isActive = true;
        this.withVideo = withVideo;

        // Проверяем есть ли уже активная комната
        const existingRooms = await db.collection('chats').doc(chatId).collection('rooms')
            .where('status', '==', 'active').limit(1).get();

        let isInitiator = false;

        if (!existingRooms.empty) {
            // Присоединяемся к существующей комнате (мы - получатель)
            this.roomRef = existingRooms.docs[0].ref;
            await this.roomRef.update({
                participants: firebase.firestore.FieldValue.arrayUnion(uid)
            });
            console.log('[CALL] Joined existing room as receiver');

            // Получаем withVideo из существующей комнаты
            const roomData = existingRooms.docs[0].data();
            this.withVideo = roomData.withVideo || false;
        } else {
            // Создаем новую комнату (мы - инициатор)
            this.roomRef = await db.collection('chats').doc(chatId).collection('rooms').add({
                status: 'active',
                participants: [uid],
                withVideo,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            isInitiator = true;
            console.log('[CALL] Created new room as initiator');
        }

        this.roomId = this.roomRef.id;

        // Следим за состоянием комнаты
        this.roomUnsub = this.roomRef.onSnapshot(snap => {
            const data = snap.data();
            if (!data || data.status === 'ended') {
                console.log('[CALL] Room ended');
                this.cleanup();
            }
        });

        // Получаем микрофон (и камеру если видеозвонок)
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: this.withVideo ? { width: 640, height: 480 } : false
            });
            console.log('[CALL] Got local stream');

            // Останавливаем звук звонка, если он еще играет
            this.sounds.stopAll();

            // Показываем видео элементы и кнопку камеры если это видеозвонок
            if (this.withVideo) {
                const localVideo = document.getElementById('local-video');
                const btnVideo = document.getElementById('btn-toggle-video');
                const videoLabel = document.getElementById('video-label');
                const callAvatar = document.getElementById('call-avatar');
                const callPulse = callAvatar?.parentElement;

                if (localVideo) {
                    localVideo.srcObject = this.localStream;
                    localVideo.style.display = 'block';
                }
                if (btnVideo) btnVideo.style.display = 'block';
                if (videoLabel) videoLabel.style.display = 'block';
                if (callPulse) callPulse.style.display = 'none'; // Скрываем аватар
            }
        } catch (err) {
            console.error('[CALL] Error getting media:', err);
            alert('Не удалось получить доступ к микрофону!');
            this.endCall();
            return false;
        }

        // Создаем peer connection
        this.peerConnection = new RTCPeerConnection(this.iceServers);

        // Добавляем локальный stream
        this.localStream.getTracks().forEach(track => {
            this.peerConnection.addTrack(track, this.localStream);
        });

        // Слушаем удаленный stream
        this.remoteStream = new MediaStream();
        const remoteAudio = document.getElementById('remote-audio');
        const remoteVideo = document.getElementById('remote-video');

        if (remoteAudio) {
            remoteAudio.srcObject = this.remoteStream;
        }

        this.peerConnection.ontrack = (event) => {
            console.log('[CALL] Got remote track:', event.track.kind);
            event.streams[0].getTracks().forEach(track => {
                this.remoteStream.addTrack(track);
            });

            // Если это видео трек - показываем видео элемент
            if (event.track.kind === 'video' && remoteVideo) {
                remoteVideo.srcObject = this.remoteStream;
                remoteVideo.style.display = 'block';

                // Скрываем аватар
                const callPulse = document.getElementById('call-avatar')?.parentElement;
                if (callPulse) callPulse.style.display = 'none';
            }
        };

        // Слушаем ICE candidates
        this.peerConnection.onicecandidate = async (event) => {
            if (event.candidate) {
                console.log('[CALL] New ICE candidate');
                await this.roomRef.collection('candidates').add({
                    candidate: event.candidate.toJSON(),
                    from: this.myUid
                });
            }
        };

        // Слушаем сигналы (offer/answer)
        this.signalUnsub = this.roomRef.collection('signals').onSnapshot(async (snapshot) => {
            for (const change of snapshot.docChanges()) {
                if (change.type === 'added') {
                    const data = change.doc.data();

                    if (data.type === 'offer' && data.from !== this.myUid) {
                        console.log('[CALL] Received offer');
                        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                        const answer = await this.peerConnection.createAnswer();
                        await this.peerConnection.setLocalDescription(answer);

                        await this.roomRef.collection('signals').add({
                            type: 'answer',
                            answer: answer,
                            from: this.myUid
                        });
                        console.log('[CALL] Sent answer');

                        const statusEl = document.getElementById('call-status');
                        if (statusEl) statusEl.innerText = 'Подключено';
                    } else if (data.type === 'answer' && data.from !== this.myUid) {
                        console.log('[CALL] Received answer');
                        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));

                        const statusEl = document.getElementById('call-status');
                        if (statusEl) statusEl.innerText = 'Подключено';
                    }
                }
            }
        });

        // Слушаем ICE candidates от собеседника
        this.roomRef.collection('candidates').where('from', '!=', this.myUid)
            .onSnapshot(snapshot => {
                snapshot.docChanges().forEach(async (change) => {
                    if (change.type === 'added') {
                        const candidate = new RTCIceCandidate(change.doc.data().candidate);
                        await this.peerConnection.addIceCandidate(candidate);
                        console.log('[CALL] Added ICE candidate');
                    }
                });
            });

        // Если мы инициатор - создаем offer
        if (isInitiator) {
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);

            await this.roomRef.collection('signals').add({
                type: 'offer',
                offer: offer,
                from: this.myUid
            });
            console.log('[CALL] Sent offer');

            const statusEl = document.getElementById('call-status');
            if (statusEl) statusEl.innerText = 'Ожидание ответа...';
        }

        return true;
    }

    async endCall() {
        this.sounds.playHangup();
        this._isActive = false;
        if (this.roomRef) {
            await this.roomRef.update({
                participants: firebase.firestore.FieldValue.arrayRemove(this.myUid),
                status: 'ended'
            }).catch(() => { });
        }
        this.cleanup();
    }

    cleanup() {
        console.log('[CALL] Cleanup');
        this._isActive = false;
        this.sounds.stopAll();

        // Закрываем peer connection
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        // Останавливаем локальный stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        // Очищаем удаленный stream
        if (this.remoteStream) {
            this.remoteStream.getTracks().forEach(track => track.stop());
            this.remoteStream = null;
        }

        // Отписываемся от listeners
        if (this.signalUnsub) { this.signalUnsub(); this.signalUnsub = null; }
        if (this.roomUnsub) { this.roomUnsub(); this.roomUnsub = null; }

        this.roomRef = null;
        this.roomId = null;
        this.myUid = null;

        // Скрываем и очищаем видео элементы
        const localVideo = document.getElementById('local-video');
        const remoteVideo = document.getElementById('remote-video');
        const btnVideo = document.getElementById('btn-toggle-video');
        const videoLabel = document.getElementById('video-label');
        const callPulse = document.getElementById('call-avatar')?.parentElement;

        if (localVideo) {
            localVideo.style.display = 'none';
            localVideo.srcObject = null;
        }
        if (remoteVideo) {
            remoteVideo.style.display = 'none';
            remoteVideo.srcObject = null;
        }
        if (btnVideo) {
            btnVideo.style.display = 'none';
            btnVideo.style.background = '';
            btnVideo.innerText = '📹';
        }
        if (videoLabel) videoLabel.style.display = 'none';
        if (callPulse) callPulse.style.display = ''; // Показываем обратно аватар

        document.getElementById('call-overlay').classList.add('hidden');
    }

    get isActive() { return !!this.roomRef; }

    toggleMute() {
        if (!this.localStream) return;
        const audioTrack = this.localStream.getAudioTracks()[0];
        if (!audioTrack) return;

        audioTrack.enabled = !audioTrack.enabled;
        const btn = document.getElementById('btn-toggle-mute');
        if (btn) {
            btn.innerText = audioTrack.enabled ? '🎤' : '🔇';
            btn.classList.toggle('muted', !audioTrack.enabled);
            btn.style.background = audioTrack.enabled ? '' : '#e74c3c';
        }
        console.log('[CALL] Mute:', !audioTrack.enabled);
    }

    toggleVideo() {
        if (!this.localStream) return;
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (!videoTrack) return;

        videoTrack.enabled = !videoTrack.enabled;
        const btn = document.getElementById('btn-toggle-video');
        const localVideo = document.getElementById('local-video');

        if (btn) {
            btn.innerText = videoTrack.enabled ? '📹' : '📵';
            btn.style.background = videoTrack.enabled ? '' : '#e74c3c';
        }
        if (localVideo) {
            localVideo.style.display = videoTrack.enabled ? 'block' : 'none';
        }
        console.log('[CALL] Video:', videoTrack.enabled);
    }
}

/* ═══════════════════════════════════
   MAIN APP
   ═══════════════════════════════════ */
class Vinychat {
    constructor() {
        this.user = null;
        this.chatId = null;
        this.chats = [];
        this.cache = {};
        this.unsub = null;
        this.sounds = new CallSounds();
        this.voice = new GroupCall(this.sounds);
        this.globalCallUnsubs = [];
        this.pendingCall = null;
        this.pendingCallUnsub = null;
        this.isMobile = window.innerWidth <= 768;
        this.msgCount = 0;
        this._listeningChatIds = new Set();  // chats we already have listeners for
        this._notifiedRoomIds = new Set();   // rooms we already showed notification for
        this.bind();
        this.listen();
        this._setupMobile();
        window.addEventListener('resize', () => { this.isMobile = window.innerWidth <= 768; });
        console.log('--- Vinychat Ready ---');
    }

    async requestNotify() {
        if (!("Notification" in window)) return;
        if (Notification.permission === "default") {
            const result = await Notification.requestPermission();
            console.log('Notification permission:', result);

            // После получения разрешения регистрируем FCM
            if (result === "granted") {
                await this.setupFCM();
            }
        } else if (Notification.permission === "granted") {
            // Если разрешение уже есть, просто регистрируем FCM
            await this.setupFCM();
        }
    }

    async setupFCM() {
        if (!messaging) return;

        try {
            // Регистрация Service Worker
            const registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
            console.log('Service Worker registered:', registration);

            // Получение FCM токена
            const currentToken = await messaging.getToken({
                vapidKey: 'BN_UkWdeZJ8QKRGzRAM1tgWOowmutQhnsdTmJ1ZmEf11RXVxI2z5CcBZF4lCrmGWnCJk13uJlst2LdMoTUirbjw',
                serviceWorkerRegistration: registration
            });

            if (currentToken && this.user) {
                console.log('FCM Token:', currentToken);
                // Сохраняем токен в Firestore
                await db.collection('users').doc(this.user.uid).update({
                    fcmToken: currentToken,
                    tokenUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                console.log('FCM token saved to Firestore');

                // Слушаем сообщения когда приложение открыто
                messaging.onMessage((payload) => {
                    console.log('Message received in foreground:', payload);
                    const title = payload.notification?.title || 'Vinychat';
                    const body = payload.notification?.body || 'Новое сообщение';
                    this.notify(title, body, payload.data?.chatId);
                    this.sounds.playMsgReceived();
                });
            } else {
                console.warn('No FCM token available');
            }
        } catch (err) {
            console.error('Error setting up FCM:', err);
        }
    }

    notify(title, body, chatId = null) {
        console.log('[NOTIFY] Called:', { title, body, chatId });

        if (!("Notification" in window)) {
            console.warn('[NOTIFY] Not supported');
            return;
        }

        if (Notification.permission !== "granted") {
            console.warn('[NOTIFY] Permission:', Notification.permission);
            return;
        }

        // Показываем уведомление ВСЕГДА
        try {
            const notification = new Notification(title, {
                body,
                icon: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png',
                badge: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png',
                tag: chatId || 'vinychat',
                requireInteraction: false,
                silent: false
            });
            console.log('[NOTIFY] Created successfully');
        } catch (e) {
            console.error('[NOTIFY] Error:', e);
        }
    }

    _setupMobile() {
        const h = async () => {
            if (this.sounds.ctx && this.sounds.ctx.state === 'suspended') this.sounds.ctx.resume();
            this.requestNotify();
            document.removeEventListener('touchstart', h);
            document.removeEventListener('click', h);
        };
        document.addEventListener('touchstart', h, { once: true });
        document.addEventListener('click', h, { once: true });
    }

    bind() {
        const $ = id => document.getElementById(id);
        const safeBind = (id, fn) => { const el = $(id); if (el) el.onclick = fn; else console.warn('Element not found:', id); };

        safeBind('show-register', e => { e.preventDefault(); $('login-form').classList.add('hidden'); $('register-form').classList.remove('hidden'); });
        safeBind('show-login', e => { e.preventDefault(); $('register-form').classList.add('hidden'); $('login-form').classList.remove('hidden'); });
        safeBind('btn-login', () => this.login());
        safeBind('btn-register', () => this.register());
        safeBind('btn-logout', () => { console.log('Logout clicked'); auth.signOut().then(() => location.reload()); });
        safeBind('btn-send', () => this.send());

        const msgInp = $('message-input');
        if (msgInp) msgInp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); this.send(); } };

        safeBind('btn-settings', () => this.profileModal());
        safeBind('btn-create-group', () => this.createGroup());
        safeBind('btn-chat-settings', () => this.chatSettingsModal());
        safeBind('btn-voice-call', () => { console.log('Voice call btn clicked'); this.initiateCall(false); });
        safeBind('btn-video-call', () => { console.log('Video call btn clicked'); this.initiateCall(true); });
        safeBind('btn-call-end', () => this.voice.endCall());
        safeBind('btn-toggle-mute', () => this.voice.toggleMute());
        safeBind('btn-toggle-video', () => this.voice.toggleVideo());
        safeBind('modal-close', () => $('modal-container').classList.add('hidden'));
        safeBind('modal-ok', () => $('modal-container').classList.add('hidden'));
        safeBind('btn-back', () => this.showSidebar());
        safeBind('btn-accept-call', () => this.acceptIncoming());
        safeBind('btn-decline-call', () => this.declineIncoming());

        const searchInp = $('user-search-input');
        if (searchInp) {
            searchInp.oninput = () => this.searchUsers(searchInp.value);
            searchInp.onfocus = () => { if (searchInp.value) $('search-results').classList.remove('hidden'); };
        }
        document.addEventListener('click', e => {
            if (!e.target.closest('.search-box')) $('search-results').classList.add('hidden');
        });
    }

    listen() {
        auth.onAuthStateChanged(u => {
            if (u) {
                this.user = u;
                this._listeningChatIds.clear();
                this._notifiedRoomIds.clear();
                this.show('chat'); this.sync(); this.loadChats(); this.checkInvite();
                // Запрашиваем разрешение на уведомления сразу после входа
                this.requestNotify();
            } else {
                this.user = null;
                this.globalCallUnsubs.forEach(fn => fn()); this.globalCallUnsubs = [];
                this._listeningChatIds.clear();
                this.show('auth');
            }
        });
    }

    show(name) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); document.getElementById(name + '-screen').classList.add('active'); }
    showSidebar() { document.getElementById('sidebar').classList.remove('sidebar-hidden'); document.getElementById('active-chat').classList.add('hidden'); }
    hideSidebar() { if (this.isMobile) document.getElementById('sidebar').classList.add('sidebar-hidden'); }

    async sync() {
        if (!this.user) return;
        const doc = await db.collection('users').doc(this.user.uid).get();
        const defName = this.user.email ? this.user.email.split('@')[0] : 'User';
        const name = doc.exists ? doc.data().username : defName;
        await db.collection('users').doc(this.user.uid).set({
            uid: this.user.uid,
            username: name,
            avatar: name[0].toUpperCase(),
            email: this.user.email || ''
        }, { merge: true });
        document.getElementById('current-username').innerText = name;
        document.getElementById('current-user-avatar').innerText = name[0].toUpperCase();
    }

    async checkInvite() {
        const p = new URLSearchParams(location.search);
        if (p.get('join')) await db.collection('chats').doc(p.get('join')).update({ participants: firebase.firestore.FieldValue.arrayUnion(this.user.uid) });
        if (p.get('user')) { const d = await db.collection('users').doc(p.get('user')).get(); if (d.exists) this.startDM(d.data()); }
        if (p.get('join') || p.get('user')) history.replaceState({}, '', location.pathname);
    }

    async login() { try { await auth.signInWithEmailAndPassword(document.getElementById('login-email').value, document.getElementById('login-password').value); } catch (e) { alert(e.message); } }
    async register() {
        const u = document.getElementById('reg-username').value, e = document.getElementById('reg-email').value, p = document.getElementById('reg-password').value;
        try { const r = await auth.createUserWithEmailAndPassword(e, p); await db.collection('users').doc(r.user.uid).set({ uid: r.user.uid, username: u, avatar: u[0].toUpperCase() }); } catch (err) { alert(err.message); }
    }

    loadChats() {
        db.collection('chats').where('participants', 'array-contains', this.user.uid).onSnapshot(snap => {
            this.chats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            this.renderList();
            // Don't tear down all listeners — only add new ones
            this.updateCallListeners();
        });
    }

    /* ── CALL LISTENERS (INCREMENTAL) ── */
    updateCallListeners() {
        const currentChatIds = new Set(this.chats.map(c => c.id));

        // Remove listeners for chats we're no longer in
        this.globalCallUnsubs = this.globalCallUnsubs.filter(item => {
            if (!currentChatIds.has(item.chatId)) {
                item.unsub();
                this._listeningChatIds.delete(item.chatId);
                return false;
            }
            return true;
        });

        // Add listeners for new chats only
        for (const chat of this.chats) {
            if (this._listeningChatIds.has(chat.id)) continue;
            this._listeningChatIds.add(chat.id);

            let isFirstSnapshot = true;

            const unsub = db.collection('chats').doc(chat.id).collection('rooms')
                .where('status', '==', 'active')
                .onSnapshot(snap => {
                    const firstLoad = isFirstSnapshot;
                    isFirstSnapshot = false;

                    snap.docChanges().forEach(async change => {
                        if (change.type !== 'added') return;

                        const roomId = change.doc.id;
                        const data = change.doc.data();
                        const parts = data.participants || [];

                        // Already notified for this room
                        if (this._notifiedRoomIds.has(roomId)) return;

                        // I'm already in this room
                        if (parts.includes(this.user.uid)) {
                            this._notifiedRoomIds.add(roomId);
                            return;
                        }

                        // Already in another call
                        if (this.voice.isActive) return;

                        // No participants (stale)
                        if (parts.length === 0) return;

                        // On first snapshot (app just loaded), only show if room is recent
                        if (firstLoad) {
                            const created = data.createdAt?.toDate?.();
                            // If createdAt is null (server timestamp pending), it's definitely from another client = show it
                            // If createdAt exists and is older than 60 seconds, ignore and clean up
                            if (created && (Date.now() - created.getTime() > 60000)) {
                                change.doc.ref.update({ status: 'ended' }).catch(() => { });
                                this._notifiedRoomIds.add(roomId);
                                return;
                            }
                        }

                        this._notifiedRoomIds.add(roomId);

                        // Get caller info
                        let callerName = 'Звонок';
                        const u = await this.getUser(parts[0]);
                        if (u) callerName = u.username;

                        const isVideo = data.withVideo || false;
                        this.pendingCall = { chatId: chat.id, chat, roomRef: change.doc.ref, isVideo };

                        // Watch for cancellation (caller hangs up before we answer)
                        if (this.pendingCallUnsub) this.pendingCallUnsub();
                        this.pendingCallUnsub = change.doc.ref.onSnapshot(rs => {
                            const rd = rs.data();
                            if (!rd || rd.status === 'ended' || (rd.participants || []).length === 0) {
                                this.dismissIncoming();
                            }
                        });

                        this.showIncomingBanner(callerName, isVideo);
                    });
                });

            this.globalCallUnsubs.push({ chatId: chat.id, unsub });
        }
    }

    showIncomingBanner(name, isVideo) {
        this.sounds.startRinging();
        document.getElementById('incoming-name').innerText = name;
        document.getElementById('incoming-call').classList.remove('hidden');
        this.notify('Входящий вызов', `Звонит ${name}`);
    }

    dismissIncoming() {
        document.getElementById('incoming-call').classList.add('hidden');
        this.sounds.stopAll();
        if (this.pendingCallUnsub) { this.pendingCallUnsub(); this.pendingCallUnsub = null; }
        this.pendingCall = null;
    }

    async acceptIncoming() {
        document.getElementById('incoming-call').classList.add('hidden');
        this.sounds.stopAll();
        if (this.pendingCallUnsub) { this.pendingCallUnsub(); this.pendingCallUnsub = null; }
        if (!this.pendingCall) return;
        const { chatId, chat, isVideo } = this.pendingCall;
        this.pendingCall = null;

        // Получаем имя только если чат еще не открыт
        let name = chat.name || 'Группа';
        if (chat.type === 'personal') {
            const o = await this.getUser(chat.participants.find(id => id !== this.user.uid));
            name = o?.username || '?';
        }

        // Открываем чат ТОЛЬКО если он еще не открыт
        if (this.chatId !== chatId) {
            let av = '👥';
            if (chat.type === 'personal') {
                const o = await this.getUser(chat.participants.find(id => id !== this.user.uid));
                av = o?.avatar || '?';
            }
            this.openChat(chatId, { ...chat, name, avatar: av });
        }

        document.getElementById('call-name').innerText = name;
        document.getElementById('call-status').innerText = 'Подключение...';
        document.getElementById('call-overlay').classList.remove('hidden');
        const ok = await this.voice.joinRoom(chatId, this.user.uid, isVideo);
        if (!ok) document.getElementById('call-overlay').classList.add('hidden');
    }

    async declineIncoming() {
        document.getElementById('incoming-call').classList.add('hidden');
        this.sounds.stopAll();
        if (this.pendingCallUnsub) { this.pendingCallUnsub(); this.pendingCallUnsub = null; }

        // Помечаем комнату как ended чтобы звонящий узнал об отклонении
        if (this.pendingCall?.roomRef) {
            await this.pendingCall.roomRef.update({ status: 'ended' }).catch(() => { });
        }

        this.pendingCall = null;
    }

    async renderList() {
        const el = document.getElementById('chat-list');
        el.innerHTML = '';
        for (const c of this.chats) {
            let name = c.name || 'Группа', av = '👥';
            if (c.type === 'personal') { const o = await this.getUser(c.participants.find(id => id !== this.user.uid)); name = o?.username || '?'; av = o?.avatar || '?'; }
            const div = document.createElement('div');
            div.className = 'chat-item' + (this.chatId === c.id ? ' active' : '');
            div.innerHTML = `
                <div class="avatar">${av}</div>
                <div class="ci-text"><div class="ci-name">${name}</div><div class="ci-msg">${c.lastMessage?.text || '...'}</div></div>
                <button class="ci-delete" onclick="event.stopPropagation();App.deleteChat('${c.id}','${c.type}')" title="Удалить">✕</button>`;
            div.onclick = () => this.openChat(c.id, { ...c, name, avatar: av });
            el.appendChild(div);
        }
    }

    async getUser(uid) {
        if (!uid) return null;
        if (this.cache[uid]) return this.cache[uid];
        const d = await db.collection('users').doc(uid).get();
        if (d.exists) { this.cache[uid] = d.data(); return d.data(); }
        return null;
    }

    async searchUsers(q) {
        const query = q.trim();
        const resultsEl = document.getElementById('search-results');
        if (!query) { resultsEl.classList.add('hidden'); return; }

        try {
            // Firestore limitation: we need to fetch all users and filter client-side for proper search
            // Increased limit to show more users
            const snap = await db.collection('users').limit(200).get();

            const queryLower = query.toLowerCase();
            const users = snap.docs
                .map(d => d.data())
                .filter(u => {
                    if (u.uid === this.user.uid) return false; // exclude self
                    const usernameLower = (u.username || '').toLowerCase();
                    const emailLower = (u.email || '').toLowerCase();
                    // Search in both username and email
                    return usernameLower.includes(queryLower) || emailLower.includes(queryLower);
                })
                .slice(0, 10); // show top 10 results

            this.renderSearchResults(users);
        } catch (e) {
            console.error('Search error:', e);
        }
    }

    renderSearchResults(users) {
        const el = document.getElementById('search-results');
        el.innerHTML = '';
        if (users.length === 0) {
            el.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--dim);text-align:center">Никто не найден</div>';
        } else {
            users.forEach(u => {
                const item = document.createElement('div');
                item.className = 'search-res-item';
                const email = u.email ? `<div style="font-size:11px;color:var(--dim)">${u.email}</div>` : '';
                item.innerHTML = `<div class="avatar">${u.avatar}</div><div><div class="search-res-name">${u.username}</div>${email}</div>`;
                item.onclick = () => {
                    this.startDM(u);
                    el.classList.add('hidden');
                    document.getElementById('user-search-input').value = '';
                };
                el.appendChild(item);
            });
        }
        el.classList.remove('hidden');
    }

    async startDM(other) {
        if (other.uid === this.user.uid) return;
        const exist = this.chats.find(c => c.type === 'personal' && c.participants.includes(other.uid));
        if (exist) return this.openChat(exist.id, { ...exist, name: other.username, avatar: other.avatar });
        const ref = await db.collection('chats').add({ type: 'personal', participants: [this.user.uid, other.uid], lastMessage: { text: 'Чат начат' }, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        this.openChat(ref.id, { name: other.username, avatar: other.avatar, type: 'personal' });
    }

    openChat(id, data) {
        this.chatId = id;
        document.getElementById('no-chat-selected').classList.add('hidden');
        document.getElementById('active-chat').classList.remove('hidden');
        document.getElementById('active-chat-name').innerText = data.name;
        document.getElementById('active-chat-avatar').innerText = data.avatar || '👥';
        if (this.unsub) this.unsub();
        this.msgCount = 0;
        this.unsub = db.collection('chats').doc(id).collection('messages').orderBy('timestamp', 'asc').onSnapshot(s => this.renderMsgs(s.docs, data));
        this.renderList();
        this.hideSidebar();
    }

    async renderMsgs(docs, chatData) {
        const area = document.getElementById('messages-area');
        area.innerHTML = '';
        const prev = this.msgCount;
        this.msgCount = docs.length;
        for (const d of docs) {
            const m = d.data(), mine = m.senderId === this.user.uid;
            let author = '';
            if (!mine && (chatData.type === 'group') && m.senderId !== 'system') {
                const u = await this.getUser(m.senderId);
                author = `<span class="msg-author" onclick="App.userAction('${m.senderId}')">${u?.username || '...'}</span>`;
            }
            const div = document.createElement('div');
            div.className = `message ${mine ? 'mine' : m.senderId === 'system' ? 'system' : 'other'}`;
            if (!mine && m.senderId !== 'system') div.onclick = () => this.userAction(m.senderId);
            const t = m.timestamp ? new Date(m.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            div.innerHTML = `${author}<div>${this.esc(m.text || '')}</div><div class="msg-time">${t}</div>`;
            area.appendChild(div);
        }
        area.scrollTop = area.scrollHeight;
        if (prev > 0 && docs.length > prev) {
            const last = docs[docs.length - 1].data();
            if (last.senderId !== this.user.uid && last.senderId !== 'system') {
                this.sounds.playMsgReceived();
                this.notify(chatData.name || 'Vinychat', last.text, chatData.id);
            }
        }
    }

    async send() {
        const inp = document.getElementById('message-input');
        const t = inp.value.trim();
        if (!t || !this.chatId) return;
        inp.value = '';
        this.sounds.playMsgSent();
        await db.collection('chats').doc(this.chatId).collection('messages').add({ senderId: this.user.uid, text: t, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
        await db.collection('chats').doc(this.chatId).update({ lastMessage: { text: t }, lastActivity: firebase.firestore.FieldValue.serverTimestamp() });
    }

    /* ── CALLS ───────────────────── */
    async initiateCall(withVideo) {
        console.log('initiateCall called, withVideo:', withVideo);
        if (!this.chatId) { console.warn('No chatId'); return; }
        if (this.voice.isActive) { alert('Вы уже в звонке'); return; }

        const nameEl = document.getElementById('active-chat-name');
        const callNameEl = document.getElementById('call-name');
        const callStatusEl = document.getElementById('call-status');
        const callOverlayEl = document.getElementById('call-overlay');

        if (!nameEl || !callNameEl || !callStatusEl || !callOverlayEl) {
            console.error('Missing call UI elements:', { nameEl, callNameEl, callStatusEl, callOverlayEl });
            alert('Ошибка интерфейса звонка. Перезагрузите страницу.');
            return;
        }

        const name = nameEl.innerText;
        callNameEl.innerText = name;
        callStatusEl.innerText = 'Ожидание...';
        callOverlayEl.classList.remove('hidden');
        this.sounds.startDialing();
        const ok = await this.voice.joinRoom(this.chatId, this.user.uid, withVideo);
        if (!ok) { callOverlayEl.classList.add('hidden'); this.sounds.stopAll(); return; }
        const emoji = withVideo ? '📹' : '📞';
        await db.collection('chats').doc(this.chatId).collection('messages').add({ senderId: 'system', text: `${emoji} ${withVideo ? 'Видеозвонок' : 'Голосовой вызов'}`, type: 'system', timestamp: firebase.firestore.FieldValue.serverTimestamp() });
    }

    /* ── DELETE CHAT ─────────────── */
    async deleteChat(chatId, type) {
        const label = type === 'group' ? 'Покинуть группу?' : 'Удалить чат?';
        if (!confirm(label)) return;
        if (this.chatId === chatId) {
            if (this.unsub) this.unsub();
            this.chatId = null;
            document.getElementById('active-chat').classList.add('hidden');
            document.getElementById('no-chat-selected').classList.remove('hidden');
        }
        await db.collection('chats').doc(chatId).update({ participants: firebase.firestore.FieldValue.arrayRemove(this.user.uid) });
    }

    /* ── MODALS ─────────────────── */
    async userAction(uid) {
        if (uid === this.user.uid || uid === 'system') return;
        const u = await this.getUser(uid); if (!u) return;
        document.getElementById('modal-title').innerText = u.username;
        document.getElementById('modal-body').innerHTML = `<div style="text-align:center"><div class="avatar" style="width:64px;height:64px;font-size:28px;margin:0 auto 15px">${u.avatar}</div><button class="primary-btn" style="width:100%" onclick="App.startDM({uid:'${uid}',username:'${u.username}',avatar:'${u.avatar}'});document.getElementById('modal-container').classList.add('hidden')">Написать в личку</button></div>`;
        document.getElementById('modal-container').classList.remove('hidden');
    }

    async profileModal() {
        const u = await this.getUser(this.user.uid);
        const link = `${location.origin}${location.pathname}?user=${this.user.uid}`;
        document.getElementById('modal-title').innerText = 'Профиль';
        document.getElementById('modal-body').innerHTML = `<label style="font-size:12px;color:var(--dim)">Никнейм</label><input id="edit-name" value="${u?.username || ''}"><label style="font-size:12px;color:var(--dim)">Ссылка на профиль</label><button class="primary-btn" style="width:100%" onclick="navigator.clipboard.writeText('${link}');alert('Скопировано!')">Скопировать ссылку</button>`;
        document.getElementById('modal-ok').onclick = () => {
            const n = document.getElementById('edit-name').value.trim();
            if (n && n !== u?.username) db.collection('users').doc(this.user.uid).update({ username: n, avatar: n[0].toUpperCase() }).then(() => location.reload());
            else document.getElementById('modal-container').classList.add('hidden');
        };
        document.getElementById('modal-container').classList.remove('hidden');
    }

    chatSettingsModal() {
        const c = this.chats.find(x => x.id === this.chatId); if (!c) return;
        const link = `${location.origin}${location.pathname}?join=${this.chatId}`;
        document.getElementById('modal-title').innerText = 'Настройки чата';
        document.getElementById('modal-body').innerHTML = `
            <label style="font-size:12px;color:var(--dim)">Ссылка-приглашение</label>
            <button class="primary-btn" style="width:100%;margin-bottom:12px" onclick="navigator.clipboard.writeText('${link}');alert('Скопировано!')">Скопировать ссылку</button>
            <button class="primary-btn danger-btn" style="width:100%" onclick="App.deleteChat('${this.chatId}','${c.type}');document.getElementById('modal-container').classList.add('hidden')">${c.type === 'group' ? 'Покинуть группу' : 'Удалить чат'}</button>`;
        document.getElementById('modal-ok').onclick = () => document.getElementById('modal-container').classList.add('hidden');
        document.getElementById('modal-container').classList.remove('hidden');
    }

    createGroup() { const n = prompt('Имя группы:'); if (n) db.collection('chats').add({ name: n, type: 'group', participants: [this.user.uid], createdAt: firebase.firestore.FieldValue.serverTimestamp(), lastMessage: { text: 'Группа создана' } }); }
    esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
}

window.App = new Vinychat();
