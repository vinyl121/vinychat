/**
 * Vinychat Engine 2.9 - THE ULTIMATE FIX
 * Robust Search, Fixed Input Z-levels, and Error Alerts
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
            loginEmail: document.getElementById('login-email'), loginPass: document.getElementById('login-password'),
            regUser: document.getElementById('reg-username'), regEmail: document.getElementById('reg-email'), regPass: document.getElementById('reg-password'),
            msg: document.getElementById('message-input'), search: document.getElementById('chat-search'), file: document.getElementById('file-input')
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

        // Надежная отправка по Enter
        this.inputs.msg.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.sendMessage();
            }
        };

        this.inputs.search.oninput = (e) => this.handleSearch(e.target.value);
        document.getElementById('btn-settings').onclick = () => this.showProfileSettings();
        document.getElementById('btn-create-group').onclick = () => this.showCreateGroup();
        document.getElementById('modal-cancel').onclick = () => document.getElementById('modal-container').classList.add('hidden');
        document.getElementById('btn-attachment').onclick = () => this.inputs.file.click();
        this.inputs.file.onchange = (e) => this.handleFileUpload(e.target.files[0]);
    }

    listenAuth() {
        auth.onAuthStateChanged(user => {
            if (user) {
                this.currentUser = user;
                this.switchScreen('chat');
                this.repairUserRecord(user);
                this.loadChats();
            } else {
                this.switchScreen('auth');
            }
        });
    }

    async repairUserRecord(user) {
        try {
            const username = user.displayName || "User";
            await db.collection('users').doc(user.uid).set({
                uid: user.uid,
                username: username,
                avatar: username[0].toUpperCase(),
                searchKeywords: username.toLowerCase()
            }, { merge: true });

            document.getElementById('current-username').innerText = username;
            document.getElementById('current-user-avatar').innerText = username[0].toUpperCase();
        } catch (e) { console.error("Repair failed:", e); }
    }

    async handleGoogleLogin() {
        const provider = new firebase.auth.GoogleAuthProvider();
        try { await auth.signInWithPopup(provider); } catch (e) { alert("Ошибка Google: " + e.message); }
    }

    async handleRegister() {
        const name = this.inputs.regUser.value.trim();
        const email = this.inputs.regEmail.value.trim();
        const pass = this.inputs.regPass.value.trim();
        if (!name || !email || !pass) return alert("Заполните все поля");
        try {
            const res = await auth.createUserWithEmailAndPassword(email, pass);
            await db.collection('users').doc(res.user.uid).set({
                uid: res.user.uid, username: name, avatar: name[0].toUpperCase(), searchKeywords: name.toLowerCase()
            });
        } catch (e) { alert(e.message); }
    }

    async handleLogin() {
        try { await auth.signInWithEmailAndPassword(this.inputs.loginEmail.value, this.inputs.loginPass.value); } catch (e) { alert(e.message); }
    }

    async handleSearch(term) {
        term = term.toLowerCase().trim();
        if (term.length < 2) return this.renderChatList();

        try {
            // 1. Поиск в пользователях
            const uSnap = await db.collection('users').where('searchKeywords', '>=', term).where('searchKeywords', '<=', term + '\uf8ff').get();
            let users = uSnap.docs.map(d => d.data()).filter(u => u.uid !== this.currentUser.uid);

            // 2. Поиск в группах
            const gSnap = await db.collection('chats').where('type', '==', 'group').where('searchKeywords', '>=', term).where('searchKeywords', '<=', term + '\uf8ff').get();
            let groups = gSnap.docs.map(d => ({ id: d.id, ...d.data() }));

            // 3. Если Firebase ничего не выдал (например, нет индекса), попробуем найти по полному ID базы
            if (groups.length === 0 && term.length > 5) {
                const doc = await db.collection('chats').doc(term).get();
                if (doc.exists && doc.data().type === 'group') groups.push({ id: doc.id, ...doc.data() });
            }

            this.renderChatList(users, groups);
        } catch (e) {
            console.warn("Search indexed query failed, trying local fallback", e);
            // Если индекс еще не создался, Firebase вернет ошибку. 
            // Мы просто не будем ничего отображать в глобальном поиске, пока индекс не готов.
            this.renderChatList([], []);
        }
    }

    loadChats() {
        db.collection('chats').where('participants', 'array-contains', this.currentUser.uid).onSnapshot(snap => {
            this.allChats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            this.renderChatList();
        }, err => alert("Ошибка базы (Firestore): " + err.message));
    }

    async renderChatList(users = [], groups = []) {
        this.areas.chatList.innerHTML = '';

        if (users.length > 0 || groups.length > 0) {
            const h = document.createElement('div'); h.className = 'status'; h.style.padding = '10px'; h.innerText = 'Найдено:';
            this.areas.chatList.appendChild(h);
            users.forEach(u => this.appendItem(u.username, u.avatar, 'Люди: Начать чат', () => this.startChat(u)));
            groups.forEach(g => this.appendItem(g.name, '👥', 'Группа: Вступить', () => this.joinGroup(g)));
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
        const ref = await db.collection('chats').add({
            type: 'personal', participants: [this.currentUser.uid, other.uid],
            lastMessage: { text: 'Чат создан' }, createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        this.openChat(ref.id, { name: other.username, avatar: other.avatar, type: 'personal' });
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
        this.unsub = db.collection('chats').doc(id).collection('messages').orderBy('timestamp', 'asc').onSnapshot(snap => this.renderMessages(snap.docs));
        this.renderChatList();
    }

    renderMessages(docs) {
        this.areas.messages.innerHTML = '';
        docs.forEach(d => {
            const m = d.data();
            const mine = m.senderId === this.currentUser.uid;
            const div = document.createElement('div');
            div.className = `message ${mine ? 'mine' : 'other'}`;
            div.innerHTML = `<div class="msg-text">${this.escape(m.text || "")}</div>`;
            this.areas.messages.appendChild(div);
        });
        this.areas.messages.scrollTop = this.areas.messages.scrollHeight;
    }

    async sendMessage() {
        const text = this.inputs.msg.value.trim();
        if (!text || !this.activeChatId) return;
        const cid = this.activeChatId;
        this.inputs.msg.value = '';
        try {
            await db.collection('chats').doc(cid).collection('messages').add({
                senderId: this.currentUser.uid, text: text, timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
            await db.collection('chats').doc(cid).update({
                lastMessage: { text: text, senderId: this.currentUser.uid },
                lastActivity: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) { alert("Ошибка отправки! " + e.message); }
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
                lastMessage: { text: 'Группа создана' }
            });
        }
    }

    escape(s) { return s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
    switchScreen(n) { Object.values(this.screens).forEach(s => s.classList.remove('active')); this.screens[n].classList.add('active'); }
}

window.onload = () => { window.App = new Vinychat(); };
