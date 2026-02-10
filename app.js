/**
 * Vinychat Engine 3.8.2 - PRO POLISH
 * Fixed message colors, removed attachment, beautiful buttons, simulated calls
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

class Vinychat {
    constructor() {
        this.currentUser = null;
        this.activeChatId = null;
        this.allChats = [];
        this.usersCache = {};
        this.unsub = null;
        this.init();
    }

    init() {
        this.initElements();
        this.initEvents();
        this.listenAuth();
    }

    initElements() {
        this.screens = { auth: document.getElementById('auth-screen'), chat: document.getElementById('chat-screen') };
        this.inputs = {
            msg: document.getElementById('message-input'),
            file: document.getElementById('file-input')
        };
        this.areas = { chatList: document.getElementById('chat-list'), messages: document.getElementById('messages-area'), activeChat: document.getElementById('active-chat'), noChat: document.getElementById('no-chat-selected') };
    }

    initEvents() {
        document.getElementById('show-register').onclick = (e) => { e.preventDefault(); document.getElementById('login-form').classList.add('hidden'); document.getElementById('register-form').classList.remove('hidden'); };
        document.getElementById('show-login').onclick = (e) => { e.preventDefault(); document.getElementById('register-form').classList.add('hidden'); document.getElementById('login-form').classList.remove('hidden'); };

        document.getElementById('btn-login').onclick = () => this.handleLogin();
        document.getElementById('btn-register').onclick = () => this.handleRegister();
        document.getElementById('btn-logout').onclick = () => auth.signOut();
        document.getElementById('btn-send').onclick = () => this.sendMessage();

        document.getElementById('btn-chat-settings').onclick = () => this.showChatManagement();
        document.getElementById('btn-voice-call').onclick = () => this.startVoiceCall();

        this.inputs.msg.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); this.sendMessage(); } };

        document.getElementById('btn-settings').onclick = () => this.showProfileSettings();
        document.getElementById('btn-create-group').onclick = () => this.showCreateGroup();

        const closeMod = () => document.getElementById('modal-container').classList.add('hidden');
        document.getElementById('modal-cancel').onclick = closeMod;
        document.getElementById('modal-cancel-icon').onclick = closeMod;
    }

    listenAuth() {
        auth.onAuthStateChanged(user => {
            if (user) {
                this.currentUser = user;
                this.switchScreen('chat');
                this.syncUser();
                this.loadChats();
                this.checkInviteLink();
            } else {
                this.switchScreen('auth');
            }
        });
    }

    async checkInviteLink() {
        const urlParams = new URLSearchParams(window.location.search);
        const joinId = urlParams.get('join');
        const userId = urlParams.get('user');
        if (!this.currentUser) return;

        if (joinId) {
            await db.collection('chats').doc(joinId).update({ participants: firebase.firestore.FieldValue.arrayUnion(this.currentUser.uid) });
            window.history.replaceState({}, '', window.location.pathname);
        } else if (userId) {
            const doc = await db.collection('users').doc(userId).get();
            if (doc.exists) this.startChat({ uid: userId, ...doc.data() });
            window.history.replaceState({}, '', window.location.pathname);
        }
    }

    async syncUser() {
        const doc = await db.collection('users').doc(this.currentUser.uid).get();
        let name = doc.exists ? doc.data().username : this.currentUser.email.split('@')[0];
        await db.collection('users').doc(this.currentUser.uid).set({ uid: this.currentUser.uid, username: name, avatar: name[0].toUpperCase() }, { merge: true });
        document.getElementById('current-username').innerText = name;
        document.getElementById('current-user-avatar').innerText = name[0].toUpperCase();
    }

    async handleLogin() {
        try { await auth.signInWithEmailAndPassword(document.getElementById('login-email').value, document.getElementById('login-password').value); } catch (e) { alert(e.message); }
    }

    async handleRegister() {
        const u = document.getElementById('reg-username').value;
        const e = document.getElementById('reg-email').value;
        const p = document.getElementById('reg-password').value;
        try {
            const res = await auth.createUserWithEmailAndPassword(e, p);
            await db.collection('users').doc(res.user.uid).set({ uid: res.user.uid, username: u, avatar: u[0].toUpperCase() });
        } catch (err) { alert(err.message); }
    }

    loadChats() {
        db.collection('chats').where('participants', 'array-contains', this.currentUser.uid).onSnapshot(snap => {
            this.allChats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            this.renderChatList();
        });
    }

    async renderChatList() {
        this.areas.chatList.innerHTML = '';
        for (const chat of this.allChats) {
            let name = chat.name || "Группа";
            let av = "👥";
            if (chat.type === "personal") {
                const other = await this.getUser(chat.participants.find(id => id !== this.currentUser.uid));
                name = other ? other.username : "Юзер";
                av = other ? other.avatar : "?";
            }
            this.appendItem(name, av, chat.lastMessage?.text || "...", () => this.openChat(chat.id, { ...chat, name, avatar: av }), this.activeChatId === chat.id);
        }
    }

    appendItem(name, avatar, msg, onClick, active = false) {
        const div = document.createElement('div');
        div.className = `chat-item ${active ? 'active' : ''}`;
        div.onclick = onClick;
        div.innerHTML = `<div class="avatar">${avatar}</div><div class="details"><div class="top"><span class="name">${name}</span></div><div class="msg">${msg}</div></div>`;
        this.areas.chatList.appendChild(div);
    }

    async getUser(uid) {
        if (this.usersCache[uid]) return this.usersCache[uid];
        const doc = await db.collection('users').doc(uid).get();
        if (doc.exists) { this.usersCache[uid] = doc.data(); return doc.data(); }
        return null;
    }

    async startChat(other) {
        if (other.uid === this.currentUser.uid) return;
        const exist = this.allChats.find(c => c.type === 'personal' && c.participants.includes(other.uid));
        if (exist) return this.openChat(exist.id, { ...exist, name: other.username, avatar: other.avatar });
        const ref = await db.collection('chats').add({ type: 'personal', participants: [this.currentUser.uid, other.uid], lastMessage: { text: "Чат активен" }, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        this.openChat(ref.id, { name: other.username, avatar: other.avatar });
    }

    openChat(id, data) {
        this.activeChatId = id;
        this.areas.noChat.classList.add('hidden');
        this.areas.activeChat.classList.remove('hidden');
        document.getElementById('active-chat-name').innerText = data.name;
        document.getElementById('active-chat-avatar').innerText = data.avatar || '👥';
        if (this.unsub) this.unsub();
        this.unsub = db.collection('chats').doc(id).collection('messages').orderBy('timestamp', 'asc').onSnapshot(snap => this.renderMessages(snap.docs, data));
        this.renderChatList();
    }

    async renderMessages(docs, chatData) {
        this.areas.messages.innerHTML = '';
        for (const d of docs) {
            const m = d.data();
            const mine = m.senderId === this.currentUser.uid;
            let author = "";
            if (!mine && chatData.type === 'group') {
                const user = await this.getUser(m.senderId);
                author = `<span class="msg-author" onclick="App.showUserAction('${m.senderId}')">${user ? user.username : '...'}</span>`;
            }
            const div = document.createElement('div');
            div.className = `message ${mine ? 'mine' : 'other'} ${m.type || ''}`;
            const time = m.timestamp ? new Date(m.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            div.innerHTML = `${author}<div class="msg-text" onclick="!${mine} && App.showUserAction('${m.senderId}')">${this.escape(m.text || "")}</div><div style="font-size:9px; opacity:0.5; text-align:right; margin-top:4px;">${time}</div>`;
            this.areas.messages.appendChild(div);
        }
        this.areas.messages.scrollTop = this.areas.messages.scrollHeight;
    }

    async sendMessage() {
        const t = this.inputs.msg.value.trim();
        if (!t || !this.activeChatId) return;
        this.inputs.msg.value = '';
        await db.collection('chats').doc(this.activeChatId).collection('messages').add({ senderId: this.currentUser.uid, text: t, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
        await db.collection('chats').doc(this.activeChatId).update({ lastMessage: { text: t, senderId: this.currentUser.uid }, lastActivity: firebase.firestore.FieldValue.serverTimestamp() });
    }

    async startVoiceCall() {
        if (!this.activeChatId) return;
        const chat = this.allChats.find(c => c.id === this.activeChatId);
        const name = chat.name || document.getElementById('active-chat-name').innerText;

        document.getElementById('modal-title').innerText = "Голосовой вызов";
        document.getElementById('modal-body').innerHTML = `
            <div style="text-align:center;">
                <div class="avatar" style="width:80px; height:80px; margin:0 auto 20px; font-size:32px;">📞</div>
                <h2 style="color:white; margin-bottom:5px;">${name}</h2>
                <p style="color:var(--text-dim); margin-bottom:20px;">Идет соединение...</p>
                <div style="display:flex; gap:10px;">
                    <button onclick="document.getElementById('modal-container').classList.add('hidden')" style="background:#ff4757 !important;">Сбросить</button>
                    <button onclick="alert('Микрофон подключен')" style="background:#10b981 !important;">Ответить</button>
                </div>
            </div>
        `;
        document.getElementById('modal-container').classList.remove('hidden');
        await db.collection('chats').doc(this.activeChatId).collection('messages').add({
            senderId: "system", text: "📞 Начался голосовой вызов...", type: "system", timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
    }

    async showUserAction(uid) {
        if (uid === this.currentUser.uid || uid === "system") return;
        const user = await this.getUser(uid);
        document.getElementById('modal-title').innerText = "Профиль";
        document.getElementById('modal-body').innerHTML = `
            <div style="text-align:center;">
                <div class="avatar" style="width:60px; height:60px; margin:0 auto 15px;">${user.avatar}</div>
                <h3 style="color:white;">${user.username}</h3>
                <br>
                <button onclick="App.startChat({uid:'${uid}', username:'${user.username}', avatar:'${user.avatar}'}); document.getElementById('modal-container').classList.add('hidden');">Написать в личку</button>
            </div>
        `;
        document.getElementById('modal-container').classList.remove('hidden');
    }

    async showProfileSettings() {
        const u = await this.getUser(this.currentUser.uid);
        const inviteLink = `${window.location.origin}${window.location.pathname}?user=${this.currentUser.uid}`;
        document.getElementById('modal-title').innerText = "Профиль";
        document.getElementById('modal-body').innerHTML = `
            <p style="font-size:12px; margin-bottom:5px;">Никнейм:</p>
            <input type="text" id="new-username" value="${u.username}" style="margin-bottom:20px;">
            <p style="font-size:12px; margin-bottom:5px;">Ваша ссылка:</p>
            <button onclick="navigator.clipboard.writeText('${inviteLink}'); alert('Скопировано!')">Скопировать ссылку профиля</button>
        `;
        document.getElementById('modal-cancel').onclick = () => {
            const n = document.getElementById('new-username').value;
            if (n && n !== u.username) {
                db.collection('users').doc(this.currentUser.uid).update({ username: n, avatar: n[0].toUpperCase() }).then(() => location.reload());
            } else document.getElementById('modal-container').classList.add('hidden');
        };
        document.getElementById('modal-container').classList.remove('hidden');
    }

    showChatManagement() {
        const id = this.activeChatId;
        const chat = this.allChats.find(c => c.id === id);
        const link = `${window.location.origin}${window.location.pathname}?join=${id}`;
        document.getElementById('modal-title').innerText = "Настройки чата";
        document.getElementById('modal-body').innerHTML = `
            <p style="font-size:12px; margin-bottom:5px;">Пригласить в чат:</p>
            <button onclick="navigator.clipboard.writeText('${link}'); alert('Скопировано!')">Копировать ссылку</button>
            ${chat.type === 'group' ? `<button onclick="App.leaveGroup('${id}')" class="secondary-btn">Выйти из группы</button>` : ''}
        `;
        document.getElementById('modal-container').classList.remove('hidden');
    }

    async leaveGroup(id) { if (confirm("Покинуть группу?")) { await db.collection('chats').doc(id).update({ participants: firebase.firestore.FieldValue.arrayRemove(this.currentUser.uid) }); location.reload(); } }

    showCreateGroup() {
        const n = prompt("Имя группы:");
        if (n) db.collection('chats').add({ name: n, type: 'group', participants: [this.currentUser.uid], createdAt: firebase.firestore.FieldValue.serverTimestamp(), lastMessage: { text: "Создана группа" } });
    }

    escape(s) { return s ? s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])) : ""; }
    switchScreen(n) { Object.values(this.screens).forEach(s => s.classList.remove('active')); this.screens[n].classList.add('active'); }
}

window.onload = () => { window.App = new Vinychat(); };
