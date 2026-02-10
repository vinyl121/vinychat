/**
 * Vinychat Engine 3.1 - STABILITY MASTER
 * Google Auth (Redirect Mode), Search Repair, Input Fix
 */

const firebaseConfig = {
    apiKey: "AIzaSyBVK86LPh7qGO2sllS5G9Gxk7lCxJA-2Go",
    authDomain: "vinychat-c2c4c.firebaseapp.com",
    projectId: "vinychat-c2c4c",
    storageBucket: "vinychat-c2c4c.firebasestorage.app",
    messagingSenderId: "756427796615",
    appId: "1:756427796615:web:002f5a5080b0a3adc88822"
};

// Start Firebase
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
        this.isAuthProcessing = false;

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
            loginEmail: document.getElementById('login-email'), loginPass: document.getElementById('login-password'),
            regUser: document.getElementById('reg-username'), regEmail: document.getElementById('reg-email'), regPass: document.getElementById('reg-password'),
            msg: document.getElementById('message-input'), search: document.getElementById('chat-search'), file: document.getElementById('file-input')
        };
        this.areas = { chatList: document.getElementById('chat-list'), messages: document.getElementById('messages-area'), activeChat: document.getElementById('active-chat'), noChat: document.getElementById('no-chat-selected') };
    }

    initEvents() {
        // Auth navigation
        document.getElementById('show-register').onclick = (e) => { e.preventDefault(); document.getElementById('login-form').classList.add('hidden'); document.getElementById('register-form').classList.remove('hidden'); };
        document.getElementById('show-login').onclick = (e) => { e.preventDefault(); document.getElementById('register-form').classList.add('hidden'); document.getElementById('login-form').classList.remove('hidden'); };

        // Auth actions
        document.getElementById('btn-login').onclick = () => this.handleLogin();
        document.getElementById('btn-register').onclick = () => this.handleRegister();
        document.getElementById('btn-google').onclick = () => this.handleGoogleLogin();
        document.getElementById('btn-logout').onclick = () => auth.signOut();

        // Message Input - ABSOLUTE RELIABILITY
        document.getElementById('btn-send').onclick = () => this.sendMessage();
        this.inputs.msg.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.sendMessage();
            }
            // Никаких других e.preventDefault() для обычных клавиш!
        };

        // Search
        this.inputs.search.oninput = (e) => this.handleSearch(e.target.value);

        // Groups & Profile
        document.getElementById('btn-settings').onclick = () => this.showProfileSettings();
        document.getElementById('btn-create-group').onclick = () => this.showCreateGroup();
        document.getElementById('modal-cancel').onclick = () => document.getElementById('modal-container').classList.add('hidden');
        document.getElementById('btn-attachment').onclick = () => this.inputs.file.click();
        this.inputs.file.onchange = (e) => this.handleFileUpload(e.target.files[0]);
    }

    listenAuth() {
        // Проверяем результат редиректа Google (если страница перезагрузилась после входа)
        auth.getRedirectResult().catch(e => {
            if (e.code !== 'auth/cancelled-popup-request') {
                alert("Ошибка входа Google: " + e.message);
                this.isAuthProcessing = false;
            }
        });

        auth.onAuthStateChanged(user => {
            if (user) {
                this.currentUser = user;
                this.switchScreen('chat');
                this.syncUser(user);
                this.loadChats();
            } else {
                this.switchScreen('auth');
            }
        });
    }

    // --- Authentication ---
    async handleGoogleLogin() {
        if (this.isAuthProcessing) return;
        this.isAuthProcessing = true;

        const btn = document.getElementById('btn-google');
        btn.innerText = "Подключение...";
        btn.disabled = true;

        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            await auth.signInWithRedirect(provider);
        } catch (e) {
            alert(e.message);
            this.isAuthProcessing = false;
            btn.innerText = "Войти через Google";
            btn.disabled = false;
        }
    }

    async syncUser(user) {
        try {
            const doc = await db.collection('users').doc(user.uid).get();
            let username = "User";

            if (doc.exists && doc.data().username) {
                username = doc.data().username;
            } else if (user.displayName) {
                username = user.displayName;
            } else if (user.email) {
                username = user.email.split('@')[0];
            }

            // Обновляем данные для поиска в фоне
            await db.collection('users').doc(user.uid).set({
                uid: user.uid,
                username: username,
                avatar: username[0].toUpperCase(),
                searchKeywords: username.toLowerCase()
            }, { merge: true });

            document.getElementById('current-username').innerText = username;
            document.getElementById('current-user-avatar').innerText = username[0].toUpperCase();
        } catch (e) { console.error("Sync error:", e); }
    }

    async handleRegister() {
        const name = this.inputs.regUser.value.trim();
        const email = this.inputs.regEmail.value.trim();
        const pass = this.inputs.regPass.value.trim();
        if (!name || !email || !pass) return alert("Заполните поля");
        try {
            const res = await auth.createUserWithEmailAndPassword(email, pass);
            await db.collection('users').doc(res.user.uid).set({
                uid: res.user.uid, username: name, avatar: name[0].toUpperCase(), searchKeywords: name.toLowerCase()
            });
        } catch (e) { alert(e.message); }
    }

    async handleLogin() {
        try {
            await auth.signInWithEmailAndPassword(this.inputs.loginEmail.value, this.inputs.loginPass.value);
        } catch (e) { alert(e.message); }
    }

    // --- Search Logic ---
    async handleSearch(term) {
        term = term.toLowerCase().trim();
        if (term.length < 2) return this.renderChatList();

        try {
            const uSnap = await db.collection('users').where('searchKeywords', '>=', term).where('searchKeywords', '<=', term + '\uf8ff').get();
            const gSnap = await db.collection('chats').where('type', '==', 'group').where('searchKeywords', '>=', term).where('searchKeywords', '<=', term + '\uf8ff').get();

            this.renderChatList(
                uSnap.docs.map(d => d.data()).filter(u => u.uid !== this.currentUser.uid),
                gSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            );
        } catch (e) { console.warn("Search logic waiting for indexes..."); }
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
            users.forEach(u => this.appendItem(u.username, u.avatar, 'Люди: Начать чат', () => this.startChat(u)));
            groups.forEach(g => this.appendItem(g.name, '👥', 'Группы: Вступить', () => this.joinGroup(g)));
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

    // --- Actions ---
    async startChat(other) {
        const exist = this.allChats.find(c => c.type === 'personal' && c.participants.includes(other.uid));
        if (exist) return this.openChat(exist.id, { ...exist, name: other.username, avatar: other.avatar });
        const ref = await db.collection('chats').add({
            type: 'personal', participants: [this.currentUser.uid, other.uid],
            lastMessage: { text: "Чат создан" }, createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
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
        this.unsub = db.collection('chats').doc(id).collection('messages').orderBy('timestamp', 'asc').onSnapshot(snap => {
            this.renderMessages(snap.docs, data);
        });
        this.renderChatList();
    }

    async renderMessages(docs, chatData) {
        this.areas.messages.innerHTML = '';
        for (const d of docs) {
            const m = d.data();
            const mine = m.senderId === this.currentUser.uid;

            let author = "";
            if (!mine && chatData.type === 'group') {
                const info = await this.getUser(m.senderId);
                author = `<span class="msg-author" style="font-size:10px; color:var(--primary); font-weight:700; display:block; margin-bottom:4px;">${info ? info.username : '...'}</span>`;
            }

            const div = document.createElement('div');
            div.className = `message ${mine ? 'mine' : 'other'}`;
            const time = m.timestamp ? new Date(m.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...';
            div.innerHTML = `${author}<div class="msg-text">${this.escape(m.text || "")}</div><div class="msg-meta" style="font-size:9px; opacity:0.6; text-align:right;">${time}</div>`;
            this.areas.messages.appendChild(div);
        }
        this.areas.messages.scrollTop = this.areas.messages.scrollHeight;
    }

    async sendMessage() {
        const text = this.inputs.msg.value.trim();
        if (!text || !this.activeChatId) return;
        this.inputs.msg.value = '';
        try {
            await db.collection('chats').doc(this.activeChatId).collection('messages').add({
                senderId: this.currentUser.uid, text: text, timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
            await db.collection('chats').doc(this.activeChatId).update({
                lastMessage: { text, senderId: this.currentUser.uid },
                lastActivity: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) { alert("Ошибка базы данных: " + e.message); }
    }

    async handleFileUpload(file) {
        if (!file || !this.activeChatId) return;
        const ref = storage.ref(`chats/${this.activeChatId}/${Date.now()}_${file.name}`);
        const snap = await ref.put(file);
        const url = await snap.ref.getDownloadURL();
        await db.collection('chats').doc(this.activeChatId).collection('messages').add({
            senderId: this.currentUser.uid, text: "Файл", fileUrl: url, fileName: file.name, fileType: file.type, timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
    }

    showProfileSettings() {
        const n = prompt("Новый ник:");
        if (n) db.collection('users').doc(this.currentUser.uid).update({ username: n, avatar: n[0].toUpperCase(), searchKeywords: n.toLowerCase() }).then(() => location.reload());
    }

    showCreateGroup() {
        const n = prompt("Название группы:");
        if (n) {
            db.collection('chats').add({
                name: n, type: 'group', participants: [this.currentUser.uid],
                searchKeywords: n.toLowerCase(),
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastMessage: { text: "Группа создана" }
            });
        }
    }

    escape(s) { return s ? s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])) : ""; }
    switchScreen(n) { Object.values(this.screens).forEach(s => s.classList.remove('active')); this.screens[n].classList.add('active'); }
}

window.onload = () => { window.App = new Vinychat(); };
