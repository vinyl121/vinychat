/**
 * Vinychat 4.0 - REAL VOICE CALLS + STABLE UI
 * WebRTC audio calls via Firebase signaling
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

/* ═══════════════════════════════════════
   VOICE CALL ENGINE (WebRTC)
   ═══════════════════════════════════════ */
class VoiceCall {
    constructor() {
        this.pc = null;
        this.localStream = null;
        this.callDoc = null;
        this.unsubs = [];
        this.timerInterval = null;
        this.seconds = 0;
    }

    async startCall(chatId) {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch (e) {
            alert("Нет доступа к микрофону. Разрешите доступ в настройках браузера.");
            return false;
        }

        this.pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
        this.localStream.getTracks().forEach(t => this.pc.addTrack(t, this.localStream));

        this.pc.ontrack = (e) => {
            const audio = new Audio();
            audio.srcObject = e.streams[0];
            audio.play();
        };

        this.callDoc = db.collection('chats').doc(chatId).collection('calls').doc();
        const offerCandidates = this.callDoc.collection('offerCandidates');
        const answerCandidates = this.callDoc.collection('answerCandidates');

        this.pc.onicecandidate = (e) => { if (e.candidate) offerCandidates.add(e.candidate.toJSON()); };

        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        await this.callDoc.set({ offer: { sdp: offer.sdp, type: offer.type }, status: 'ringing' });

        // Listen for answer
        this.unsubs.push(this.callDoc.onSnapshot(snap => {
            const data = snap.data();
            if (data?.answer && !this.pc.currentRemoteDescription) {
                this.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                this.onConnected();
            }
            if (data?.status === 'ended') this.cleanup();
        }));

        this.unsubs.push(answerCandidates.onSnapshot(snap => {
            snap.docChanges().forEach(c => {
                if (c.type === 'added') this.pc.addIceCandidate(new RTCIceCandidate(c.doc.data()));
            });
        }));

        return true;
    }

    async answerCall(chatId, callId) {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch (e) {
            alert("Нет доступа к микрофону.");
            return;
        }

        this.pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
        this.localStream.getTracks().forEach(t => this.pc.addTrack(t, this.localStream));

        this.pc.ontrack = (e) => {
            const audio = new Audio();
            audio.srcObject = e.streams[0];
            audio.play();
        };

        this.callDoc = db.collection('chats').doc(chatId).collection('calls').doc(callId);
        const answerCandidates = this.callDoc.collection('answerCandidates');
        const offerCandidates = this.callDoc.collection('offerCandidates');

        this.pc.onicecandidate = (e) => { if (e.candidate) answerCandidates.add(e.candidate.toJSON()); };

        const callData = (await this.callDoc.get()).data();
        await this.pc.setRemoteDescription(new RTCSessionDescription(callData.offer));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await this.callDoc.update({ answer: { sdp: answer.sdp, type: answer.type }, status: 'active' });

        this.unsubs.push(offerCandidates.onSnapshot(snap => {
            snap.docChanges().forEach(c => {
                if (c.type === 'added') this.pc.addIceCandidate(new RTCIceCandidate(c.doc.data()));
            });
        }));

        this.onConnected();
    }

    onConnected() {
        document.getElementById('call-status').innerText = 'Подключено';
        document.getElementById('call-timer').classList.remove('hidden');
        this.seconds = 0;
        this.timerInterval = setInterval(() => {
            this.seconds++;
            const m = String(Math.floor(this.seconds / 60)).padStart(2, '0');
            const s = String(this.seconds % 60).padStart(2, '0');
            document.getElementById('call-timer').innerText = `${m}:${s}`;
        }, 1000);
    }

    async endCall() {
        if (this.callDoc) await this.callDoc.update({ status: 'ended' }).catch(() => { });
        this.cleanup();
    }

    cleanup() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
        if (this.pc) this.pc.close();
        this.unsubs.forEach(u => u());
        this.unsubs = [];
        this.pc = null;
        this.localStream = null;
        document.getElementById('call-overlay').classList.add('hidden');
    }
}

/* ═══════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════ */
class Vinychat {
    constructor() {
        this.user = null;
        this.chatId = null;
        this.chats = [];
        this.cache = {};
        this.unsub = null;
        this.voice = new VoiceCall();
        this.callUnsub = null;
        this.bind();
        this.listen();
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
        $('modal-close').onclick = () => $('modal-container').classList.add('hidden');
        $('modal-ok').onclick = () => $('modal-container').classList.add('hidden');
    }

    listen() {
        auth.onAuthStateChanged(u => {
            if (u) { this.user = u; this.show('chat'); this.sync(); this.loadChats(); this.checkInvite(); }
            else { this.user = null; this.show('auth'); }
        });
    }

    show(name) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(name + '-screen').classList.add('active');
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
        if (p.get('join')) { await db.collection('chats').doc(p.get('join')).update({ participants: firebase.firestore.FieldValue.arrayUnion(this.user.uid) }); }
        if (p.get('user')) { const d = await db.collection('users').doc(p.get('user')).get(); if (d.exists) this.startDM(d.data()); }
        if (p.get('join') || p.get('user')) history.replaceState({}, '', location.pathname);
    }

    async login() {
        try { await auth.signInWithEmailAndPassword(document.getElementById('login-email').value, document.getElementById('login-password').value); } catch (e) { alert(e.message); }
    }

    async register() {
        const u = document.getElementById('reg-username').value, e = document.getElementById('reg-email').value, p = document.getElementById('reg-password').value;
        try { const r = await auth.createUserWithEmailAndPassword(e, p); await db.collection('users').doc(r.user.uid).set({ uid: r.user.uid, username: u, avatar: u[0].toUpperCase() }); } catch (err) { alert(err.message); }
    }

    loadChats() {
        db.collection('chats').where('participants', 'array-contains', this.user.uid).onSnapshot(snap => {
            this.chats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            this.renderList();
        });
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
        this.unsub = db.collection('chats').doc(id).collection('messages').orderBy('timestamp', 'asc').onSnapshot(s => this.renderMsgs(s.docs, data));
        this.renderList();
        this.listenForCalls(id);
    }

    async renderMsgs(docs, chatData) {
        const area = document.getElementById('messages-area');
        area.innerHTML = '';
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
    }

    async send() {
        const inp = document.getElementById('message-input');
        const t = inp.value.trim();
        if (!t || !this.chatId) return;
        inp.value = '';
        await db.collection('chats').doc(this.chatId).collection('messages').add({ senderId: this.user.uid, text: t, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
        await db.collection('chats').doc(this.chatId).update({ lastMessage: { text: t }, lastActivity: firebase.firestore.FieldValue.serverTimestamp() });
    }

    /* ── VOICE CALLS ─────────────────── */
    async initiateCall() {
        if (!this.chatId) return;
        const overlay = document.getElementById('call-overlay');
        const name = document.getElementById('active-chat-name').innerText;
        document.getElementById('call-name').innerText = name;
        document.getElementById('call-status').innerText = 'Вызов...';
        document.getElementById('call-timer').classList.add('hidden');
        overlay.classList.remove('hidden');

        const ok = await this.voice.startCall(this.chatId);
        if (!ok) { overlay.classList.add('hidden'); return; }

        await db.collection('chats').doc(this.chatId).collection('messages').add({
            senderId: 'system', text: '📞 Начат голосовой вызов', type: 'system', timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
    }

    listenForCalls(chatId) {
        if (this.callUnsub) this.callUnsub();
        this.callUnsub = db.collection('chats').doc(chatId).collection('calls')
            .where('status', '==', 'ringing')
            .onSnapshot(snap => {
                snap.docChanges().forEach(async change => {
                    if (change.type !== 'added') return;
                    const callData = change.doc.data();
                    if (callData.offer && change.doc.id) {
                        // Don't answer our own calls
                        const isOurCall = this.voice.callDoc && this.voice.callDoc.id === change.doc.id;
                        if (isOurCall) return;

                        const accept = confirm('📞 Входящий звонок! Принять?');
                        if (accept) {
                            document.getElementById('call-name').innerText = document.getElementById('active-chat-name').innerText;
                            document.getElementById('call-status').innerText = 'Подключение...';
                            document.getElementById('call-timer').classList.add('hidden');
                            document.getElementById('call-overlay').classList.remove('hidden');
                            await this.voice.answerCall(chatId, change.doc.id);
                        } else {
                            await db.collection('chats').doc(chatId).collection('calls').doc(change.doc.id).update({ status: 'ended' });
                        }
                    }
                });
            });
    }

    /* ── MODALS ───────────────────────── */
    async userAction(uid) {
        if (uid === this.user.uid || uid === 'system') return;
        const u = await this.getUser(uid);
        if (!u) return;
        document.getElementById('modal-title').innerText = u.username;
        document.getElementById('modal-body').innerHTML = `
            <div style="text-align:center">
                <div class="avatar" style="width:64px;height:64px;font-size:28px;margin:0 auto 15px">${u.avatar}</div>
                <button class="primary-btn" style="width:100%" onclick="App.startDM({uid:'${uid}',username:'${u.username}',avatar:'${u.avatar}'}); document.getElementById('modal-container').classList.add('hidden')">Написать в личку</button>
            </div>`;
        document.getElementById('modal-container').classList.remove('hidden');
    }

    async profileModal() {
        const u = await this.getUser(this.user.uid);
        const link = `${location.origin}${location.pathname}?user=${this.user.uid}`;
        document.getElementById('modal-title').innerText = 'Профиль';
        document.getElementById('modal-body').innerHTML = `
            <label style="font-size:12px;color:var(--dim)">Никнейм</label>
            <input id="edit-name" value="${u?.username || ''}">
            <label style="font-size:12px;color:var(--dim)">Ссылка на ваш профиль</label>
            <button class="primary-btn" style="width:100%" onclick="navigator.clipboard.writeText('${link}');alert('Скопировано!')">Скопировать ссылку</button>`;
        document.getElementById('modal-ok').onclick = () => {
            const n = document.getElementById('edit-name').value.trim();
            if (n && n !== u?.username) db.collection('users').doc(this.user.uid).update({ username: n, avatar: n[0].toUpperCase() }).then(() => location.reload());
            else document.getElementById('modal-container').classList.add('hidden');
        };
        document.getElementById('modal-container').classList.remove('hidden');
    }

    chatSettingsModal() {
        const c = this.chats.find(x => x.id === this.chatId);
        if (!c) return;
        const link = `${location.origin}${location.pathname}?join=${this.chatId}`;
        document.getElementById('modal-title').innerText = 'Настройки чата';
        document.getElementById('modal-body').innerHTML = `
            <label style="font-size:12px;color:var(--dim)">Ссылка-приглашение</label>
            <button class="primary-btn" style="width:100%;margin-bottom:12px" onclick="navigator.clipboard.writeText('${link}');alert('Скопировано!')">Скопировать ссылку</button>
            ${c.type === 'group' ? `<button class="primary-btn danger-btn" style="width:100%" onclick="App.leave('${this.chatId}')">Покинуть группу</button>` : ''}`;
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
