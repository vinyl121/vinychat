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
   MIC MANAGER
   ═══════════════════════════════════ */
class MicManager {
    constructor() { this.permitted = false; }
    async request(withVideo = false) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
            throw new Error('Браузер не поддерживает медиа.');
        if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1')
            throw new Error('Нужен HTTPS.');
        try {
            const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo });
            this.permitted = true; return s;
        } catch (e) {
            if (e.name === 'NotAllowedError') throw new Error('Доступ запрещён. Разрешите в настройках браузера.');
            if (e.name === 'NotFoundError') throw new Error('Устройство не найдено.');
            throw new Error('Ошибка: ' + e.message);
        }
    }
    async preAuth() {
        try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); this.permitted = true; s.getTracks().forEach(t => t.stop()); } catch (e) { }
    }
}
const micManager = new MicManager();

/* ═══════════════════════════════════
   GROUP CALL (Mesh WebRTC + Video)
   ═══════════════════════════════════ */
const ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] };

class GroupCall {
    constructor(sounds) {
        this.sounds = sounds;
        this.localStream = null;
        this.peers = {};
        this.audioElements = {};
        this.roomRef = null;
        this.signalUnsub = null;
        this.roomUnsub = null;
        this.timerInterval = null;
        this.seconds = 0;
        this.muted = false;
        this.camOff = false;
        this.withVideo = false;
        this.myUid = null;
    }

    async joinRoom(chatId, uid, withVideo = false) {
        this.withVideo = withVideo;
        try { this.localStream = await micManager.request(withVideo); }
        catch (e) { alert(e.message); return false; }

        this.myUid = uid;
        this.muted = false;
        this.camOff = false;
        this.updateMuteUI();
        this.updateCamUI();

        if (withVideo) {
            const lv = document.getElementById('local-video');
            lv.srcObject = this.localStream;
            lv.classList.remove('hidden');
            document.getElementById('btn-call-cam').classList.remove('hidden');
            document.getElementById('call-overlay').classList.add('video-active');
        }

        // Find or create room
        const snap = await db.collection('chats').doc(chatId).collection('rooms')
            .where('status', '==', 'active').limit(1).get();

        if (snap.empty) {
            // Create new room with me already in participants
            this.roomRef = await db.collection('chats').doc(chatId).collection('rooms').add({
                status: 'active',
                participants: [uid],
                withVideo,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } else {
            // Join existing room
            this.roomRef = snap.docs[0].ref;
            await this.roomRef.update({ participants: firebase.firestore.FieldValue.arrayUnion(uid) });
        }

        // Watch participants
        this.roomUnsub = this.roomRef.onSnapshot(snap => {
            const data = snap.data();
            if (!data || data.status === 'ended') { this.cleanup(); return; }
            const parts = data.participants || [];

            for (const pid of parts) {
                if (pid === this.myUid || this.peers[pid]) continue;
                this.sounds.stopAll();
                // Determine initiator: first participant in array is initiator
                // This ensures room creator always sends offer
                const shouldInitiate = parts.indexOf(this.myUid) < parts.indexOf(pid);
                this._createPeer(pid, shouldInitiate);
                this.updateCount(parts.length);
            }
            for (const pid of Object.keys(this.peers)) {
                if (!parts.includes(pid)) { this._removePeer(pid); this.updateCount(parts.length); }
            }
            if (parts.length <= 1 && this.seconds > 0) this.endCall();
        });

        // Listen for signals to me
        this.signalUnsub = this.roomRef.collection('signals').where('to', '==', uid)
            .onSnapshot(snap => {
                snap.docChanges().forEach(async ch => {
                    if (ch.type !== 'added') return;
                    await this._handleSignal(ch.doc.data());
                    ch.doc.ref.delete().catch(() => { });
                });
            });

        return true;
    }

    async _createPeer(pid, init) {
        const pc = new RTCPeerConnection(ICE);
        this.peers[pid] = pc;
        this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream));

        pc.ontrack = e => {
            if (e.track.kind === 'video') {
                const rv = document.getElementById('remote-video');
                rv.srcObject = e.streams[0]; rv.classList.remove('hidden');
                document.getElementById('call-overlay').classList.add('video-active');
            } else {
                let a = this.audioElements[pid];
                if (!a) { a = document.createElement('audio'); a.autoplay = true; document.body.appendChild(a); this.audioElements[pid] = a; }
                a.srcObject = e.streams[0];
            }
        };

        pc.onicecandidate = e => {
            if (e.candidate) this.roomRef.collection('signals').add({ from: this.myUid, to: pid, type: 'candidate', data: e.candidate.toJSON() });
        };

        const check = () => {
            const s = pc.connectionState || pc.iceConnectionState;
            if ((s === 'connected' || s === 'completed') && !this.timerInterval) {
                this.sounds.stopAll(); this.sounds.playConnected(); this.onConnected();
            }
        };
        pc.onconnectionstatechange = check;
        pc.oniceconnectionstatechange = check;

        if (init) {
            const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
            await this.roomRef.collection('signals').add({ from: this.myUid, to: pid, type: 'offer', data: { sdp: offer.sdp, type: offer.type } });
        }
    }

    async _handleSignal(sig) {
        if (sig.type === 'offer') {
            if (!this.peers[sig.from]) await this._createPeer(sig.from, false);
            const pc = this.peers[sig.from]; if (!pc) return;
            await pc.setRemoteDescription(new RTCSessionDescription(sig.data));
            const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
            await this.roomRef.collection('signals').add({ from: this.myUid, to: sig.from, type: 'answer', data: { sdp: answer.sdp, type: answer.type } });
        } else if (sig.type === 'answer') {
            const pc = this.peers[sig.from];
            if (pc && !pc.currentRemoteDescription) await pc.setRemoteDescription(new RTCSessionDescription(sig.data));
        } else if (sig.type === 'candidate') {
            const pc = this.peers[sig.from];
            if (pc) await pc.addIceCandidate(new RTCIceCandidate(sig.data));
        }
    }

    _removePeer(pid) {
        if (this.peers[pid]) { this.peers[pid].close(); delete this.peers[pid]; }
        if (this.audioElements[pid]) { this.audioElements[pid].remove(); delete this.audioElements[pid]; }
    }

    toggleMute() { if (!this.localStream) return; this.muted = !this.muted; this.localStream.getAudioTracks().forEach(t => { t.enabled = !this.muted; }); this.updateMuteUI(); }
    toggleCam() { if (!this.localStream) return; const vt = this.localStream.getVideoTracks(); if (!vt.length) return; this.camOff = !this.camOff; vt.forEach(t => { t.enabled = !this.camOff; }); this.updateCamUI(); }
    updateMuteUI() { const b = document.getElementById('btn-call-mute'); b.innerText = this.muted ? '🔇' : '🎙️'; b.classList.toggle('muted', this.muted); }
    updateCamUI() { const b = document.getElementById('btn-call-cam'); b.innerText = this.camOff ? '🚫' : '📷'; b.classList.toggle('cam-off', this.camOff); }
    updateCount(c) { const el = document.getElementById('call-status'); if (el && this.timerInterval) el.innerText = `Участников: ${c}`; }

    onConnected() {
        document.getElementById('call-status').innerText = 'Подключено';
        document.getElementById('call-timer').classList.remove('hidden');
        this.seconds = 0;
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => {
            this.seconds++;
            document.getElementById('call-timer').innerText = String(Math.floor(this.seconds / 60)).padStart(2, '0') + ':' + String(this.seconds % 60).padStart(2, '0');
        }, 1000);
    }

    async endCall() {
        this.sounds.playHangup();
        if (this.roomRef) {
            // ALWAYS mark room as ended so other participants see it
            await this.roomRef.update({
                participants: firebase.firestore.FieldValue.arrayRemove(this.myUid),
                status: 'ended'
            }).catch(() => { });
        }
        this.cleanup();
    }

    cleanup() {
        this.sounds.stopAll();
        if (this.timerInterval) clearInterval(this.timerInterval); this.timerInterval = null;
        if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
        this.localStream = null;
        Object.keys(this.peers).forEach(id => this._removePeer(id));
        if (this.signalUnsub) this.signalUnsub();
        if (this.roomUnsub) this.roomUnsub();
        this.signalUnsub = null; this.roomUnsub = null; this.roomRef = null; this.myUid = null;
        const rv = document.getElementById('remote-video'), lv = document.getElementById('local-video');
        if (rv) { rv.srcObject = null; rv.classList.add('hidden'); }
        if (lv) { lv.srcObject = null; lv.classList.add('hidden'); }
        document.getElementById('btn-call-cam').classList.add('hidden');
        document.getElementById('call-overlay').classList.remove('video-active');
        document.getElementById('call-overlay').classList.add('hidden');
    }

    get isActive() { return !!this.roomRef; }
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
    }

    _setupMobile() {
        const h = async () => {
            if (this.sounds.ctx && this.sounds.ctx.state === 'suspended') this.sounds.ctx.resume();
            await micManager.preAuth();
            document.removeEventListener('touchstart', h);
            document.removeEventListener('click', h);
        };
        document.addEventListener('touchstart', h, { once: true });
        document.addEventListener('click', h, { once: true });
    }

    bind() {
        const $ = id => document.getElementById(id);
        $('show-register').onclick = e => { e.preventDefault(); $('login-form').classList.add('hidden'); $('register-form').classList.remove('hidden'); };
        $('show-login').onclick = e => { e.preventDefault(); $('register-form').classList.add('hidden'); $('login-form').classList.remove('hidden'); };
        $('btn-login').onclick = () => this.login();
        $('btn-register').onclick = () => this.register();
        $('btn-logout').onclick = () => auth.signOut();
        $('btn-send').onclick = () => this.send();
        $('message-input').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); this.send(); } };
        $('btn-settings').onclick = () => this.profileModal();
        $('btn-create-group').onclick = () => this.createGroup();
        $('btn-chat-settings').onclick = () => this.chatSettingsModal();
        $('btn-voice-call').onclick = () => this.initiateCall(false);
        $('btn-video-call').onclick = () => this.initiateCall(true);
        $('btn-call-end').onclick = () => this.voice.endCall();
        $('btn-call-mute').onclick = () => this.voice.toggleMute();
        $('btn-call-cam').onclick = () => this.voice.toggleCam();
        $('modal-close').onclick = () => $('modal-container').classList.add('hidden');
        $('modal-ok').onclick = () => $('modal-container').classList.add('hidden');
        $('btn-back').onclick = () => this.showSidebar();
        $('btn-accept-call').onclick = () => this.acceptIncoming();
        $('btn-decline-call').onclick = () => this.declineIncoming();
    }

    listen() {
        auth.onAuthStateChanged(u => {
            if (u) {
                this.user = u;
                this._listeningChatIds.clear();
                this._notifiedRoomIds.clear();
                this.show('chat'); this.sync(); this.loadChats(); this.checkInvite();
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
        const doc = await db.collection('users').doc(this.user.uid).get();
        const name = doc.exists ? doc.data().username : this.user.email.split('@')[0];
        await db.collection('users').doc(this.user.uid).set({ uid: this.user.uid, username: name, avatar: name[0].toUpperCase() }, { merge: true });
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
        document.getElementById('incoming-label').innerText = isVideo ? '📹 Входящий видеозвонок' : '📞 Входящий вызов';
        document.getElementById('incoming-call').classList.remove('hidden');
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

        let name = chat.name || 'Группа', av = '👥';
        if (chat.type === 'personal') { const o = await this.getUser(chat.participants.find(id => id !== this.user.uid)); name = o?.username || '?'; av = o?.avatar || '?'; }
        this.openChat(chatId, { ...chat, name, avatar: av });

        document.getElementById('call-name').innerText = name;
        document.getElementById('call-status').innerText = 'Подключение...';
        document.getElementById('call-timer').classList.add('hidden');
        document.getElementById('call-overlay').classList.remove('hidden');
        const ok = await this.voice.joinRoom(chatId, this.user.uid, isVideo);
        if (!ok) document.getElementById('call-overlay').classList.add('hidden');
    }

    async declineIncoming() {
        document.getElementById('incoming-call').classList.add('hidden');
        this.sounds.stopAll();
        if (this.pendingCallUnsub) { this.pendingCallUnsub(); this.pendingCallUnsub = null; }
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
            if (last.senderId !== this.user.uid && last.senderId !== 'system') this.sounds.playMsgReceived();
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
        if (!this.chatId) return;
        if (this.voice.isActive) { alert('Вы уже в звонке'); return; }
        const name = document.getElementById('active-chat-name').innerText;
        document.getElementById('call-name').innerText = name;
        document.getElementById('call-status').innerText = 'Ожидание...';
        document.getElementById('call-timer').classList.add('hidden');
        document.getElementById('call-overlay').classList.remove('hidden');
        this.sounds.startDialing();
        const ok = await this.voice.joinRoom(this.chatId, this.user.uid, withVideo);
        if (!ok) { document.getElementById('call-overlay').classList.add('hidden'); this.sounds.stopAll(); return; }
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
