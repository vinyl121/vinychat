/**
 * Vinychat Engine 3.4 - GROUP INVITE UPDATE
 * Added invite links, explicit settings button, and UI polish
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
const storage = firebase.storage();

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
        this.checkInviteLink();
    }

    initElements() {
        this.screens = { auth: document.getElementById('auth-screen'), chat: document.getElementById('chat-screen') };
        this.inputs = {
            msg: document.getElementById('message-input'),
            search: document.getElementById('chat-search'),
            file: document.getElementById('file-input')
        };
        this.areas = { chatList: document.getElementById('chat-list'), messages: document.getElementById('messages-area'), activeChat: document.getElementById('active-chat'), noChat: document.getElementById('no-chat-selected') };
    }

    initEvents() {
        document.getElementById('show-register').onclick = (e) => { e.preventDefault(); document.getElementById('login-form').classList.add('hidden'); document.getElementById('register-form').classList.remove('hidden'); };
        document.getElementById('show-login').onclick = (e) => { e.preventDefault(); document.getElementById('register-form').classList.add('hidden'); document.getElementById('login-form').classList.remove('hidden'); };

        document.getElementById('btn-login').onclick = () => this.handleLogin();
        document.getElementById('btn-register').onclick = () => this.handleRegister();
        document.getElementById('btn-google').onclick = () => this.handleGoogleLogin();
        document.getElementById('btn-logout').onclick = () => auth.signOut();
        document.getElementById('btn-send').onclick = () => this.sendMessage();

        document.getElementById('btn-chat-settings').onclick = () => this.showChatManagement();
        document.getElementById('btn-voice-call').onclick = () => alert("Вызываю... Функция звонков в разработке.");

        this.inputs.msg.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); this.sendMessage(); } };
        this.inputs.search.oninput = (e) => this.handleSearch(e.target.value);

        document.getElementById('btn-settings').onclick = () => this.showProfileSettings();
        document.getElementById('btn-create-group').onclick = () => this.showCreateGroup();

        document.getElementById('modal-cancel').onclick = () => document.getElementById('modal-container').classList.add('hidden');
        document.getElementById('btn-attachment').onclick = () => this.inputs.file.click();
        this.inputs.file.onchange = (e) => this.handleFileUpload(e.target.files[0]);
    }

    listenAuth() {
        auth.getRedirectResult().catch(err => {
            if (err.code !== 'auth/cancelled-popup-request') alert("Google Error: " + err.message);
        });

        auth.onAuthStateChanged(user => {
            if (user) {
                this.currentUser = user;
                this.switchScreen('chat');
                this.syncUser(user);
                this.loadChats();
                this.checkInviteLink(); // Проверяем приглашение после входа
            } else {
                this.switchScreen('auth');
            }
        });
    }

    async checkInviteLink() {
        const urlParams = new URLSearchParams(window.location.search);
        const inviteId = urlParams.get('join');
        if (inviteId && this.currentUser) {
            const doc = await db.collection('chats').doc(inviteId).get();
            if (doc.exists) {
                await this.joinGroup({ id: inviteId, ...doc.data() });
                window.history.replaceState({}, document.title, window.location.pathname); // Чистим URL
            }
        }
    }

    async syncUser(user) {
        try {
            const doc = await db.collection('users').doc(user.uid).get();
            let name = doc.exists ? (doc.data().username || "User") : (user.displayName || user.email.split('@')[0]);
            await db.collection('users').doc(user.uid).set({
                uid: user.uid, username: name, avatar: name[0].toUpperCase(), searchKeywords: name.toLowerCase()
            }, { merge: true });
            document.getElementById('current-username').innerText = name;
            document.getElementById('current-user-avatar').innerText = name[0].toUpperCase();
        } catch (e) { console.error(e); }
    }

    async handleGoogleLogin() {
        try { await auth.signInWithRedirect(new firebase.auth.GoogleAuthProvider()); } catch (e) { alert(e.message); }
    }

    async handleLogin() {
        try { await auth.signInWithEmailAndPassword(document.getElementById('login-email').value, document.getElementById('login-password').value); } catch (err) { alert(err.message); }
    }

    async handleRegister() {
        const u = document.getElementById('reg-username').value;
        const e = document.getElementById('reg-email').value;
        const p = document.getElementById('reg-password').value;
        try {
            const res = await auth.createUserWithEmailAndPassword(e, p);
            await db.collection('users').doc(res.user.uid).set({ uid: res.user.uid, username: u, avatar: u[0].toUpperCase(), searchKeywords: u.toLowerCase() });
        } catch (err) { alert(err.message); }
    }

    async handleSearch(term) {
        term = term.toLowerCase().trim();
        if (term.length < 2) return this.renderChatList();
        const uSnap = await db.collection('users').where('searchKeywords', '>=', term).where('searchKeywords', '<=', term + '\uf8ff').limit(10).get();
        const gSnap = await db.collection('chats').where('type', '==', 'group').where('searchKeywords', '>=', term).where('searchKeywords', '<=', term + '\uf8ff').limit(10).get();
        this.renderChatList(uSnap.docs.map(d => d.data()).filter(u => u.uid !== this.currentUser.uid), gSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    }

    loadChats() {
        db.collection('chats').where('participants', 'array-contains', this.currentUser.uid).onSnapshot(snap => {
            this.allChats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            this.renderChatList();
        });
    }

    async renderChatList(users = [], groups = []) {
        this.areas.chatList.innerHTML = '';
        if (users.length > 0 || groups.length > 0) {
            const h = document.createElement('div'); h.className = 'status'; h.style.padding = '10px'; h.innerText = 'Поиск...';
            this.areas.chatList.appendChild(h);
            users.forEach(u => this.appendItem(u.username, u.avatar, 'Написать', () => this.startChat(u)));
            groups.forEach(g => this.appendItem(g.name, '👥', 'Вступить', () => this.joinGroup(g)));
            this.areas.chatList.appendChild(document.createElement('hr'));
        }
        for (const chat of this.allChats) {
            let name = chat.name || "Группа";
            let av = "👥";
            if (chat.type === "personal") {
                const other = await this.getUser(chat.participants.find(id => id !== this.currentUser.uid));
                name = other ? other.username : "Загрузка...";
                av = other ? other.avatar : "?";
            }
            this.appendItem(name, av, chat.lastMessage?.text || "Нет сообщений", () => this.openChat(chat.id, { ...chat, name, avatar: av }), this.activeChatId === chat.id);
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
        const exist = this.allChats.find(c => c.type === 'personal' && c.participants.includes(other.uid));
        if (exist) return this.openChat(exist.id, { ...exist, name: other.username, avatar: other.avatar });
        const ref = await db.collection('chats').add({ type: 'personal', participants: [this.currentUser.uid, other.uid], lastMessage: { text: "Чат создан" }, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        this.openChat(ref.id, { name: other.username, avatar: other.avatar });
    }

    async joinGroup(group) {
        if (!group.participants.includes(this.currentUser.uid)) {
            await db.collection('chats').doc(group.id).update({ participants: firebase.firestore.FieldValue.arrayUnion(this.currentUser.uid) });
        }
        this.openChat(group.id, group);
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
            let content = `<div class="msg-text">${this.escape(m.text || "")}</div>`;
            if (m.fileUrl) {
                if (m.fileType?.startsWith('image/')) content = `<img src="${m.fileUrl}" class="photo-attachment" style="max-width:250px; border-radius:10px; cursor:pointer;" onclick="window.open('${m.fileUrl}')">`;
                else content = `<a href="${m.fileUrl}" target="_blank" class="file-attachment">📄 ${m.fileName || 'Файл'}</a>`;
            }
            const div = document.createElement('div');
            div.className = `message ${mine ? 'mine' : 'other'}`;
            const time = m.timestamp ? new Date(m.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...';
            div.innerHTML = `${content}<div class="msg-meta" style="font-size:9px; opacity:0.6; text-align:right;">${time}</div>`;
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

    async handleFileUpload(file) {
        if (!file || !this.activeChatId) return;
        try {
            const ref = storage.ref(`chats/${this.activeChatId}/${Date.now()}_${file.name}`);
            const snap = await ref.put(file);
            const url = await snap.ref.getDownloadURL();
            await db.collection('chats').doc(this.activeChatId).collection('messages').add({ senderId: this.currentUser.uid, fileUrl: url, fileName: file.name, fileType: file.type, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
        } catch (e) { alert("CORS Error: Скорее всего, облачное хранилище не разрешает загрузку. Настройте правила CORS.\n" + e.message); }
    }

    showChatManagement() {
        const id = this.activeChatId;
        const chat = this.allChats.find(c => c.id === id);
        if (!chat) return;

        document.getElementById('modal-title').innerText = "Настройки";
        const inviteLink = `${window.location.protocol}//${window.location.host}${window.location.pathname}?join=${id}`;

        let html = `
            <div style="text-align:left;">
                <p style="margin-bottom:5px;">ID чата:</p>
                <input type="text" value="${id}" readonly style="width:100%; padding:10px; background:rgba(255,255,255,0.05); border:1px solid var(--glass-border); color:white; border-radius:8px; margin-bottom:15px;">
                
                <p style="margin-bottom:5px;">Ссылка-приглашение:</p>
                <button onclick="navigator.clipboard.writeText('${inviteLink}'); alert('Ссылка скопирована!');" class="primary-btn" style="width:100%; margin-bottom:15px; font-size:13px;">Скопировать ссылку</button>
        `;

        if (chat.type === 'group') {
            html += `<button onclick="App.leaveGroup('${id}')" class="secondary-btn" style="background:#ff4757; color:white; width:100%;">Покинуть группу</button>`;
        }

        html += `</div>`;
        document.getElementById('modal-body').innerHTML = html;
        document.getElementById('modal-container').classList.remove('hidden');
    }

    async leaveGroup(id) {
        if (confirm("Выйти из группы?")) {
            await db.collection('chats').doc(id).update({ participants: firebase.firestore.FieldValue.arrayRemove(this.currentUser.uid) });
            document.getElementById('modal-container').classList.add('hidden');
        }
    }

    showProfileSettings() {
        const n = prompt("Ваш ник:");
        if (n) db.collection('users').doc(this.currentUser.uid).update({ username: n, avatar: n[0].toUpperCase(), searchKeywords: n.toLowerCase() }).then(() => location.reload());
    }

    showCreateGroup() {
        const n = prompt("Имя группы:");
        if (n) db.collection('chats').add({ name: n, type: 'group', participants: [this.currentUser.uid], searchKeywords: n.toLowerCase(), createdAt: firebase.firestore.FieldValue.serverTimestamp(), lastMessage: { text: "Группа создана" } });
    }

    escape(s) { return s ? s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])) : ""; }
    switchScreen(n) { Object.values(this.screens).forEach(s => s.classList.remove('active')); this.screens[n].classList.add('active'); }
}

window.onload = () => { window.App = new Vinychat(); };
