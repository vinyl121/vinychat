/**
 * Vinychat Engine 3.5 - THE POLISH UPDATE
 * Fixed Author names, Robust Search, and Image Error Handling
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
        document.getElementById('btn-voice-call').onclick = () => this.startCall();

        this.inputs.msg.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); this.sendMessage(); } };
        this.inputs.search.oninput = (e) => this.handleSearch(e.target.value);

        document.getElementById('btn-settings').onclick = () => this.showProfileSettings();
        document.getElementById('btn-create-group').onclick = () => this.showCreateGroup();

        document.getElementById('modal-cancel').onclick = () => document.getElementById('modal-container').classList.add('hidden');
        document.getElementById('btn-attachment').onclick = () => this.inputs.file.click();
        this.inputs.file.onchange = (e) => this.handleFileUpload(e.target.files[0]);
    }

    listenAuth() {
        auth.getRedirectResult().catch(err => console.error(err));
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
        const id = new URLSearchParams(window.location.search).get('join');
        if (id && this.currentUser) {
            await db.collection('chats').doc(id).update({ participants: firebase.firestore.FieldValue.arrayUnion(this.currentUser.uid) });
            window.history.replaceState({}, '', window.location.pathname);
        }
    }

    async syncUser() {
        const u = this.currentUser;
        const doc = await db.collection('users').doc(u.uid).get();
        let name = doc.exists ? doc.data().username : (u.displayName || u.email.split('@')[0]);
        await db.collection('users').doc(u.uid).set({ uid: u.uid, username: name, avatar: name[0].toUpperCase(), searchKeywords: name.toLowerCase() }, { merge: true });
        document.getElementById('current-username').innerText = name;
        document.getElementById('current-user-avatar').innerText = name[0].toUpperCase();
    }

    async handleGoogleLogin() {
        try { await auth.signInWithRedirect(new firebase.auth.GoogleAuthProvider()); } catch (e) { alert(e.message); }
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
            await db.collection('users').doc(res.user.uid).set({ uid: res.user.uid, username: u, avatar: u[0].toUpperCase(), searchKeywords: u.toLowerCase() });
        } catch (err) { alert(err.message); }
    }

    async handleSearch(term) {
        term = term.toLowerCase().trim();
        if (term.length < 2) return this.renderChatList();

        try {
            const uSnap = await db.collection('users').where('searchKeywords', '>=', term).where('searchKeywords', '<=', term + '\uf8ff').limit(5).get();
            const gSnap = await db.collection('chats').where('type', '==', 'group').where('searchKeywords', '>=', term).where('searchKeywords', '<=', term + '\uf8ff').limit(5).get();
            this.renderChatList(uSnap.docs.map(d => d.data()).filter(u => u.uid !== this.currentUser.uid), gSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        } catch (e) {
            console.warn("Falling back to basic ID search");
            if (term.length > 10) {
                const doc = await db.collection('chats').doc(term).get();
                if (doc.exists) this.renderChatList([], [{ id: doc.id, ...doc.data() }]);
            }
        }
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
            const h = document.createElement('div'); h.className = 'status'; h.style.padding = '10px'; h.innerText = 'Найдено:';
            this.areas.chatList.appendChild(h);
            users.forEach(u => this.appendItem(u.username, u.avatar, 'Люди: Чат', () => this.startChat(u)));
            groups.forEach(g => this.appendItem(g.name, '👥', 'Группы: Зайти', () => this.joinGroup(g)));
            this.areas.chatList.appendChild(document.createElement('hr'));
        }
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
        const exist = this.allChats.find(c => c.type === 'personal' && c.participants.includes(other.uid));
        if (exist) return this.openChat(exist.id, { ...exist, name: other.username, avatar: other.avatar });
        const ref = await db.collection('chats').add({ type: 'personal', participants: [this.currentUser.uid, other.uid], lastMessage: { text: "Чат начат" }, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
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

            // ЛОГИКА ИМЕН В ГРУППАХ
            let authorName = "";
            if (!mine && chatData.type === 'group') {
                const user = await this.getUser(m.senderId);
                authorName = `<span class="msg-author" style="font-size:10px; color:var(--primary); font-weight:700; display:block; margin-bottom:4px; opacity:0.8;">${user ? user.username : '...'}</span>`;
            }

            let content = `<div class="msg-text">${this.escape(m.text || "")}</div>`;
            if (m.fileUrl) {
                if (m.fileType?.startsWith('image/')) content = `<img src="${m.fileUrl}" class="photo-attachment" style="max-width:260px; border-radius:12px; margin-top:5px; border:1px solid rgba(255,255,255,0.1);" onclick="window.open('${m.fileUrl}')">`;
                else content = `<a href="${m.fileUrl}" target="_blank" class="file-attachment">📄 ${m.fileName || 'Файл'}</a>`;
            }

            const div = document.createElement('div');
            div.className = `message ${mine ? 'mine' : 'other'} ${m.type || ''}`;
            const time = m.timestamp ? new Date(m.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...';
            div.innerHTML = `${authorName}${content}<div class="msg-meta" style="font-size:9px; opacity:0.5; text-align:right; margin-top:4px;">${time}</div>`;
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
        } catch (e) { alert("Ошибка загрузки! Выполни команду gsutil в терминале Google для решения проблемы.\n" + e.message); }
    }

    async startCall() {
        if (!this.activeChatId) return;
        await db.collection('chats').doc(this.activeChatId).collection('messages').add({ senderId: "system", text: "📞 Входящий вызов...", type: "system", timestamp: firebase.firestore.FieldValue.serverTimestamp() });
    }

    showChatManagement() {
        const id = this.activeChatId;
        const chat = this.allChats.find(c => c.id === id);
        if (!chat) return;
        const link = `${window.location.origin}${window.location.pathname}?join=${id}`;
        document.getElementById('modal-title').innerText = "Настройки";
        document.getElementById('modal-body').innerHTML = `
            <p style="font-size:12px; margin-bottom:5px;">ID чата:</p>
            <input type="text" value="${id}" readonly style="width:100%; padding:10px; background:rgba(0,0,0,0.2); border:none; color:white; border-radius:8px; margin-bottom:15px;">
            <p style="font-size:12px; margin-bottom:5px;">Ссылка-приглашение:</p>
            <button onclick="navigator.clipboard.writeText('${link}'); alert('Ссылка скопирована!');" class="primary-btn" style="width:100%; margin-bottom:15px;">Копировать ссылку</button>
            ${chat.type === 'group' ? `<button onclick="App.leaveGroup('${id}')" class="secondary-btn" style="background:#ff4757; color:white; width:100%;">Выйти из группы</button>` : ''}
        `;
        document.getElementById('modal-container').classList.remove('hidden');
    }

    async leaveGroup(id) {
        if (confirm("Покинуть группу?")) {
            await db.collection('chats').doc(id).update({ participants: firebase.firestore.FieldValue.arrayRemove(this.currentUser.uid) });
            location.reload();
        }
    }

    showProfileSettings() {
        const n = prompt("Новый ник:");
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
