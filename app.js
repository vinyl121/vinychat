/**
 * Vinychat 4.2 — SOUND + MOBILE SUPPORT
 * Ringtones via Web Audio API, full mobile UX
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
   SOUND ENGINE (Web Audio API)
   ═══════════════════════════════════ */
class CallSounds {
    constructor() {
        this.ctx = null;
        this.activeNodes = [];
        this.ringInterval = null;
    }

    _ensure() {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    _beep(freq, duration, vol = 0.15) {
        this._ensure();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.value = vol;
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
        this.activeNodes.push(osc);
        osc.onended = () => { this.activeNodes = this.activeNodes.filter(n => n !== osc); };
    }

    // Outgoing call: repeating double-beep
    startDialing() {
        this.stopAll();
        const ring = () => { this._beep(440, 0.3, 0.12); setTimeout(() => this._beep(440, 0.3, 0.12), 400); };
        ring();
        this.ringInterval = setInterval(ring, 2500);
    }

    // Incoming call: higher pitch repeating triple-beep
    startRinging() {
        this.stopAll();
        const ring = () => {
            this._beep(587, 0.15, 0.18);
            setTimeout(() => this._beep(659, 0.15, 0.18), 200);
            setTimeout(() => this._beep(784, 0.2, 0.18), 400);
        };
        ring();
        this.ringInterval = setInterval(ring, 2000);
    }

    // Connected: short pleasant chord
    playConnected() {
        this.stopAll();
        this._beep(523, 0.15, 0.1);
        setTimeout(() => this._beep(659, 0.15, 0.1), 100);
        setTimeout(() => this._beep(784, 0.2, 0.1), 200);
    }

    // End call: descending tone
    playHangup() {
        this.stopAll();
        this._beep(440, 0.15, 0.1);
        setTimeout(() => this._beep(330, 0.15, 0.1), 150);
        setTimeout(() => this._beep(262, 0.25, 0.1), 300);
    }

    // Message sent: subtle click
    playMsgSent() {
        this._ensure();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 800;
        gain.gain.setValueAtTime(0.06, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(); osc.stop(this.ctx.currentTime + 0.08);
    }

    // Message received: two-tone notification
    playMsgReceived() {
        this._ensure();
        this._beep(660, 0.08, 0.06);
        setTimeout(() => this._beep(880, 0.1, 0.06), 80);
    }

    stopAll() {
        if (this.ringInterval) { clearInterval(this.ringInterval); this.ringInterval = null; }
        this.activeNodes.forEach(n => { try { n.stop(); } catch (e) { } });
        this.activeNodes = [];
    }
}

/* ═══════════════════════════════════
   VOICE CALL ENGINE (WebRTC)
   ═══════════════════════════════════ */
class VoiceCall {
    constructor(sounds) {
        this.pc = null;
        this.localStream = null;
        this.callDoc = null;
        this.unsubs = [];
        this.timerInterval = null;
        this.seconds = 0;
        this.muted = false;
        this.sounds = sounds;
    }

    async startCall(chatId, callerUid) {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch (e) {
            alert("Нет доступа к микрофону. Разрешите в настройках браузера.");
            return false;
        }
        this.muted = false;
        this.updateMuteUI();

        this.pc = new RTCPeerConnection({
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                { urls: "stun:stun1.l.google.com:19302" }
            ]
        });
        this.localStream.getTracks().forEach(t => this.pc.addTrack(t, this.localStream));
        this.pc.ontrack = e => this._playRemote(e.streams[0]);

        this.callDoc = db.collection('chats').doc(chatId).collection('calls').doc();
        const offerC = this.callDoc.collection('offerCandidates');
        const answerC = this.callDoc.collection('answerCandidates');

        this.pc.onicecandidate = e => { if (e.candidate) offerC.add(e.candidate.toJSON()); };

        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        await this.callDoc.set({ offer: { sdp: offer.sdp, type: offer.type }, status: 'ringing', callerUid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });

        this.sounds.startDialing();

        this.unsubs.push(this.callDoc.onSnapshot(snap => {
            const d = snap.data(); if (!d) return;
            if (d.answer && !this.pc.currentRemoteDescription) {
                this.pc.setRemoteDescription(new RTCSessionDescription(d.answer));
                this.sounds.playConnected();
                this.onConnected();
            }
            if (d.status === 'ended') { this.sounds.playHangup(); this.cleanup(); }
        }));
        this.unsubs.push(answerC.onSnapshot(snap => {
            snap.docChanges().forEach(c => { if (c.type === 'added' && this.pc) this.pc.addIceCandidate(new RTCIceCandidate(c.doc.data())); });
        }));
        return true;
    }

    async answerCall(chatId, callId) {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch (e) { alert("Нет доступа к микрофону."); return; }
        this.muted = false;
        this.updateMuteUI();

        this.pc = new RTCPeerConnection({
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                { urls: "stun:stun1.l.google.com:19302" }
            ]
        });
        this.localStream.getTracks().forEach(t => this.pc.addTrack(t, this.localStream));
        this.pc.ontrack = e => this._playRemote(e.streams[0]);

        this.callDoc = db.collection('chats').doc(chatId).collection('calls').doc(callId);
        const answerC = this.callDoc.collection('answerCandidates');
        const offerC = this.callDoc.collection('offerCandidates');
        this.pc.onicecandidate = e => { if (e.candidate) answerC.add(e.candidate.toJSON()); };

        const callData = (await this.callDoc.get()).data();
        await this.pc.setRemoteDescription(new RTCSessionDescription(callData.offer));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await this.callDoc.update({ answer: { sdp: answer.sdp, type: answer.type }, status: 'active' });

        this.unsubs.push(offerC.onSnapshot(snap => {
            snap.docChanges().forEach(c => { if (c.type === 'added' && this.pc) this.pc.addIceCandidate(new RTCIceCandidate(c.doc.data())); });
        }));
        this.unsubs.push(this.callDoc.onSnapshot(snap => { if (snap.data()?.status === 'ended') { this.sounds.playHangup(); this.cleanup(); } }));

        this.sounds.playConnected();
        this.onConnected();
    }

    _playRemote(stream) {
        let audio = document.getElementById('remote-audio');
        if (!audio) { audio = document.createElement('audio'); audio.id = 'remote-audio'; document.body.appendChild(audio); }
        audio.autoplay = true;
        audio.srcObject = stream;
    }

    toggleMute() {
        if (!this.localStream) return;
        this.muted = !this.muted;
        this.localStream.getAudioTracks().forEach(t => { t.enabled = !this.muted; });
        this.updateMuteUI();
    }

    updateMuteUI() {
        const btn = document.getElementById('btn-call-mute');
        if (!btn) return;
        btn.innerText = this.muted ? '🔇' : '🎙️';
        btn.classList.toggle('muted', this.muted);
    }

    onConnected() {
        document.getElementById('call-status').innerText = 'Подключено';
        document.getElementById('call-timer').classList.remove('hidden');
        this.seconds = 0;
        this.timerInterval = setInterval(() => {
            this.seconds++;
            document.getElementById('call-timer').innerText =
                String(Math.floor(this.seconds / 60)).padStart(2, '0') + ':' + String(this.seconds % 60).padStart(2, '0');
        }, 1000);
    }

    async endCall() {
        this.sounds.playHangup();
        if (this.callDoc) await this.callDoc.update({ status: 'ended' }).catch(() => { });
        this.cleanup();
    }

    cleanup() {
        this.sounds.stopAll();
        if (this.timerInterval) clearInterval(this.timerInterval);
        if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
        if (this.pc) this.pc.close();
        this.unsubs.forEach(u => u());
        this.unsubs = [];
        this.pc = null; this.localStream = null;
        const ra = document.getElementById('remote-audio'); if (ra) ra.remove();
        document.getElementById('call-overlay').classList.add('hidden');
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
        this.voice = new VoiceCall(this.sounds);
        this.globalCallUnsubs = [];
        this.pendingCall = null;
        this.isMobile = window.innerWidth <= 768;
        this.msgCount = 0;
        this.bind();
        this.listen();
        window.addEventListener('resize', () => { this.isMobile = window.innerWidth <= 768; });
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
        $('btn-voice-call').onclick = () => this.initiateCall();
        $('btn-call-end').onclick = () => this.voice.endCall();
        $('btn-call-mute').onclick = () => this.voice.toggleMute();
        $('modal-close').onclick = () => $('modal-container').classList.add('hidden');
        $('modal-ok').onclick = () => $('modal-container').classList.add('hidden');
        $('btn-back').onclick = () => this.showSidebar();
        $('btn-accept-call').onclick = () => this.acceptIncoming();
        $('btn-decline-call').onclick = () => this.declineIncoming();
    }

    listen() {
        auth.onAuthStateChanged(u => {
            if (u) { this.user = u; this.show('chat'); this.sync(); this.loadChats(); this.checkInvite(); }
            else { this.user = null; this.globalCallUnsubs.forEach(fn => fn()); this.globalCallUnsubs = []; this.show('auth'); }
        });
    }

    show(name) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(name + '-screen').classList.add('active');
    }

    // Mobile: toggle sidebar / chat
    showSidebar() {
        document.getElementById('sidebar').classList.remove('sidebar-hidden');
        document.getElementById('active-chat').classList.add('hidden');
        document.getElementById('no-chat-selected').style.display = 'none';
    }
    hideSidebar() {
        if (this.isMobile) document.getElementById('sidebar').classList.add('sidebar-hidden');
    }

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
            this.setupGlobalCallListeners();
        });
    }

    /* ── GLOBAL CALL LISTENER ──────── */
    setupGlobalCallListeners() {
        this.globalCallUnsubs.forEach(fn => fn());
        this.globalCallUnsubs = [];
        for (const chat of this.chats) {
            const unsub = db.collection('chats').doc(chat.id).collection('calls')
                .where('status', '==', 'ringing')
                .onSnapshot(snap => {
                    snap.docChanges().forEach(async change => {
                        if (change.type !== 'added') return;
                        const data = change.doc.data();
                        if (data.callerUid === this.user.uid) return;
                        if (this.voice.pc) return;

                        let callerName = 'Неизвестно';
                        if (data.callerUid) { const u = await this.getUser(data.callerUid); if (u) callerName = u.username; }

                        this.pendingCall = { chatId: chat.id, callId: change.doc.id, chat };
                        this.showIncomingBanner(callerName);
                    });
                });
            this.globalCallUnsubs.push(unsub);
        }
    }

    showIncomingBanner(name) {
        this.sounds.startRinging();
        document.getElementById('incoming-name').innerText = name;
        document.getElementById('incoming-call').classList.remove('hidden');
    }

    async acceptIncoming() {
        document.getElementById('incoming-call').classList.add('hidden');
        this.sounds.stopAll();
        if (!this.pendingCall) return;
        const { chatId, callId, chat } = this.pendingCall;
        this.pendingCall = null;

        let name = chat.name || 'Группа', av = '👥';
        if (chat.type === 'personal') { const o = await this.getUser(chat.participants.find(id => id !== this.user.uid)); name = o?.username || '?'; av = o?.avatar || '?'; }
        this.openChat(chatId, { ...chat, name, avatar: av });

        document.getElementById('call-name').innerText = name;
        document.getElementById('call-status').innerText = 'Подключение...';
        document.getElementById('call-timer').classList.add('hidden');
        document.getElementById('call-overlay').classList.remove('hidden');
        await this.voice.answerCall(chatId, callId);
    }

    async declineIncoming() {
        document.getElementById('incoming-call').classList.add('hidden');
        this.sounds.stopAll();
        if (!this.pendingCall) return;
        await db.collection('chats').doc(this.pendingCall.chatId).collection('calls').doc(this.pendingCall.callId).update({ status: 'ended' });
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
            div.innerHTML = `<div class="avatar">${av}</div><div><div class="ci-name">${name}</div><div class="ci-msg">${c.lastMessage?.text || '...'}</div></div>`;
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
        this._chatData = data;
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
        const prevCount = this.msgCount;
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

        // Play notification sound for new incoming messages
        if (prevCount > 0 && docs.length > prevCount) {
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

    /* ── VOICE CALLS ─────────────── */
    async initiateCall() {
        if (!this.chatId) return;
        if (this.voice.pc) { alert('Вы уже в звонке'); return; }
        const name = document.getElementById('active-chat-name').innerText;
        document.getElementById('call-name').innerText = name;
        document.getElementById('call-status').innerText = 'Вызов...';
        document.getElementById('call-timer').classList.add('hidden');
        document.getElementById('call-overlay').classList.remove('hidden');
        const ok = await this.voice.startCall(this.chatId, this.user.uid);
        if (!ok) { document.getElementById('call-overlay').classList.add('hidden'); return; }
        await db.collection('chats').doc(this.chatId).collection('messages').add({ senderId: 'system', text: '📞 Начат голосовой вызов', type: 'system', timestamp: firebase.firestore.FieldValue.serverTimestamp() });
    }

    /* ── MODALS ───────────────────── */
    async userAction(uid) {
        if (uid === this.user.uid || uid === 'system') return;
        const u = await this.getUser(uid);
        if (!u) return;
        document.getElementById('modal-title').innerText = u.username;
        document.getElementById('modal-body').innerHTML = `<div style="text-align:center"><div class="avatar" style="width:64px;height:64px;font-size:28px;margin:0 auto 15px">${u.avatar}</div><button class="primary-btn" style="width:100%" onclick="App.startDM({uid:'${uid}',username:'${u.username}',avatar:'${u.avatar}'});document.getElementById('modal-container').classList.add('hidden')">Написать в личку</button></div>`;
        document.getElementById('modal-container').classList.remove('hidden');
    }

    async profileModal() {
        const u = await this.getUser(this.user.uid);
        const link = `${location.origin}${location.pathname}?user=${this.user.uid}`;
        document.getElementById('modal-title').innerText = 'Профиль';
        document.getElementById('modal-body').innerHTML = `<label style="font-size:12px;color:var(--dim)">Никнейм</label><input id="edit-name" value="${u?.username || ''}"><label style="font-size:12px;color:var(--dim)">Ссылка на ваш профиль</label><button class="primary-btn" style="width:100%" onclick="navigator.clipboard.writeText('${link}');alert('Скопировано!')">Скопировать ссылку</button>`;
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
        document.getElementById('modal-body').innerHTML = `<label style="font-size:12px;color:var(--dim)">Ссылка-приглашение</label><button class="primary-btn" style="width:100%;margin-bottom:12px" onclick="navigator.clipboard.writeText('${link}');alert('Скопировано!')">Скопировать ссылку</button>${c.type === 'group' ? `<button class="primary-btn danger-btn" style="width:100%" onclick="App.leave('${this.chatId}')">Покинуть группу</button>` : ''}`;
        document.getElementById('modal-ok').onclick = () => document.getElementById('modal-container').classList.add('hidden');
        document.getElementById('modal-container').classList.remove('hidden');
    }

    async leave(id) { if (confirm('Покинуть группу?')) { await db.collection('chats').doc(id).update({ participants: firebase.firestore.FieldValue.arrayRemove(this.user.uid) }); location.reload(); } }

    createGroup() {
        const n = prompt('Имя группы:');
        if (n) db.collection('chats').add({ name: n, type: 'group', participants: [this.user.uid], createdAt: firebase.firestore.FieldValue.serverTimestamp(), lastMessage: { text: 'Группа создана' } });
    }

    esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
}

window.App = new Vinychat();
