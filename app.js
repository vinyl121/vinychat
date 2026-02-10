/**
 * Vinychat Engine 2.5 - PRO FEATURES
 * Google Auth, Group Links, Search & Settings
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
        // Forms
        document.getElementById('show-register').onclick = () => { document.getElementById('login-form').classList.add('hidden'); document.getElementById('register-form').classList.remove('hidden'); };
        document.getElementById('show-login').onclick = () => { document.getElementById('register-form').classList.add('hidden'); document.getElementById('login-form').classList.remove('hidden'); };

        // Auth
        document.getElementById('btn-login').onclick = () => this.handleLogin();
        document.getElementById('btn-register').onclick = () => this.handleRegister();
        document.getElementById('btn-google').onclick = () => this.handleGoogleLogin();
        document.getElementById('btn-logout').onclick = () => auth.signOut();

        // Chat
        document.getElementById('btn-send').onclick = () => this.sendMessage();
        this.inputs.msg.addEventListener('keypress', (e) => (e.key === 'Enter' && this.sendMessage()));
        this.inputs.search.oninput = () => this.handleSearch();

        // Settings & Groups
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
                this.syncUserRecord(user);
                this.loadChats();
            } else {
                this.switchScreen('auth');
            }
        });
    }

    // --- Authentication ---
    async handleGoogleLogin() {
        const provider = new firebase.auth.GoogleAuthProvider();
        try { await auth.signInWithPopup(provider); } catch (e) { alert(e.message); }
    }

    async syncUserRecord(user) {
        const doc = await db.collection('users').doc(user.uid).get();
        if (!doc.exists) {
            await db.collection('users').doc(user.uid).set({
                uid: user.uid,
                username: user.displayName || "User_" + user.uid.slice(0, 4),
                avatar: (user.displayName ? user.displayName[0] : "V").toUpperCase(),
                searchKeywords: (user.displayName || "").toLowerCase()
            });
        }
        const data = (await db.collection('users').doc(user.uid).get()).data();
        document.getElementById('current-username').innerText = data.username;
        document.getElementById('current-user-avatar').innerText = data.avatar;
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
        try { await auth.signInWithEmailAndPassword(this.inputs.loginEmail.value, this.inputs.loginPass.value); } catch (e) { alert(e.message); }
    }

    // --- Search Logic (People & Groups) ---
    async handleSearch() {
        const term = this.inputs.search.value.toLowerCase().trim();
        if (term.length < 2) return this.renderChatList();

        // Search Users
        const userSnap = await db.collection('users').where('searchKeywords', '>=', term).where('searchKeywords', '<=', term + '\uf8ff').limit(5).get();
        const users = userSnap.docs.map(d => d.data()).filter(u => u.uid !== this.currentUser.uid);

        // Search Public Groups
        const groupSnap = await db.collection('chats').where('type', '==', 'group').where('searchKeywords', '>=', term).where('searchKeywords', '<=', term + '\uf8ff').limit(5).get();
        const groups = groupSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        this.renderChatList(users, groups);
    }

    // --- Chat Management ---
    loadChats() {
        db.collection('chats').where('participants', 'array-contains', this.currentUser.uid).onSnapshot(snap => {
            this.allChats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            this.renderChatList();
        });
    }

    async renderChatList(userResults = [], groupResults = []) {
        this.areas.chatList.innerHTML = '';

        // Results Section
        if (userResults.length > 0 || groupResults.length > 0) {
            const h = document.createElement('div'); h.className = 'status'; h.style.padding = '10px'; h.innerText = 'Глобальный поиск:';
            this.areas.chatList.appendChild(h);

            userResults.forEach(u => this.appendChatItem(u.username, u.avatar, 'Начать диалог', () => this.startPrivateChat(u)));
            groupResults.forEach(g => this.appendChatItem(g.name, '👥', 'Группа', () => this.joinGroup(g)));
            this.areas.chatList.appendChild(document.createElement('hr'));
        }

        // Active Chats Section
        for (const chat of this.allChats) {
            let name = chat.name || 'Группа';
            let av = '👥';
            if (chat.type === 'personal') {
                const other = await this.getUserInfo(chat.participants.find(id => id !== this.currentUser.uid));
                name = other ? other.username : '...';
                av = other ? other.avatar : '?';
            }
            this.appendChatItem(name, av, chat.lastMessage?.text || 'Нет сообщений', () => this.openChat(chat.id, { ...chat, name, avatar: av }), this.activeChatId === chat.id);
        }
    }

    appendChatItem(name, avatar, msg, onClick, active = false) {
        const div = document.createElement('div');
        div.className = `chat-item ${active ? 'active' : ''}`;
        div.onclick = onClick;
        div.innerHTML = `<div class="avatar">${avatar}</div><div class="details"><div class="top"><span class="name">${name}</span></div><div class="msg">${msg}</div></div>`;
        this.areas.chatList.appendChild(div);
    }

    async getUserInfo(uid) {
        if (this.usersCache[uid]) return this.usersCache[uid];
        const d = await db.collection('users').doc(uid).get();
        if (d.exists) { this.usersCache[uid] = d.data(); return d.data(); }
        return null;
    }

    // --- Actions ---
    async startPrivateChat(other) {
        const exist = this.allChats.find(c => c.type === 'personal' && c.participants.includes(other.uid));
        if (exist) return this.openChat(exist.id, { ...exist, name: other.username, avatar: other.avatar });
        const ref = await db.collection('chats').add({ type: 'personal', participants: [this.currentUser.uid, other.uid], lastMessage: { text: 'Чат создан' }, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        this.inputs.search.value = '';
    }

    async joinGroup(group) {
        if (group.participants.includes(this.currentUser.uid)) return this.openChat(group.id, group);
        await db.collection('chats').doc(group.id).update({ participants: firebase.firestore.FieldValue.arrayUnion(this.currentUser.uid) });
        this.inputs.search.value = '';
    }

    openChat(id, data) {
        this.activeChatId = id;
        this.areas.noChat.classList.add('hidden');
        this.areas.activeChat.classList.remove('hidden');
        document.getElementById('active-chat-name').innerText = data.name;
        document.getElementById('active-chat-avatar').innerText = data.avatar || '👥';

        // Show Group Link Button if Group
        const linkBtn = document.getElementById('btn-group-link');
        if (data.type === 'group') {
            linkBtn.style.display = 'block';
            linkBtn.onclick = () => {
                const link = `vinychat.link/${id}`; // Simplified link representation
                prompt("Ссылка на эту группу (ID):", id);
            };
        } else { linkBtn.style.display = 'none'; }

        if (this.unsub) this.unsub();
        this.unsub = db.collection('chats').doc(id).collection('messages').orderBy('timestamp', 'asc').onSnapshot(snap => this.renderMessages(snap.docs, data));
        this.renderChatList();
    }

    async renderMessages(docs, chatData) {
        this.areas.messages.innerHTML = '';
        for (const d of docs) {
            const m = d.data();
            const mine = m.senderId === this.currentUser.uid;
            const div = document.createElement('div');
            div.className = `message ${mine ? 'mine' : 'other'}`;
            let author = '';
            if (!mine && chatData.type === 'group') {
                const info = await this.getUserInfo(m.senderId);
                author = `<span class="msg-author" style="font-size:10px; color:var(--primary); font-weight:700;">${info ? info.username : '...'}</span>`;
            }
            let body = `<div class="msg-text">${this.escape(m.text || "")}</div>`;
            if (m.fileUrl) body = (m.fileType?.startsWith('image/') ? `<img src="${m.fileUrl}" style="max-width:100%; border-radius:10px; margin-bottom:5px;">` : `<a href="${m.fileUrl}" target="_blank" style="color:white; display:block; padding:10px; background:rgba(0,0,0,0.2); border-radius:8px;">📄 ${m.fileName}</a>`) + body;
            const time = m.timestamp ? new Date(m.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...';
            div.innerHTML = `${author}${body}<div class="msg-meta" style="font-size:9px; opacity:0.6; text-align:right;">${time}</div>`;
            this.areas.messages.appendChild(div);
        }
        this.areas.messages.scrollTop = this.areas.messages.scrollHeight;
    }

    async sendMessage() {
        const text = this.inputs.msg.value.trim();
        if (!text || !this.activeChatId) return;
        const id = this.activeChatId;
        this.inputs.msg.value = '';
        await db.collection('chats').doc(id).collection('messages').add({ senderId: this.currentUser.uid, text, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
        await db.collection('chats').doc(id).update({ lastMessage: { text, senderId: this.currentUser.uid }, lastActivity: firebase.firestore.FieldValue.serverTimestamp() });
    }

    async handleFileUpload(file) {
        if (!file || !this.activeChatId) return;
        const ref = storage.ref(`chats/${this.activeChatId}/${Date.now()}_${file.name}`);
        const snap = await ref.put(file);
        const url = await snap.ref.getDownloadURL();
        await db.collection('chats').doc(this.activeChatId).collection('messages').add({ senderId: this.currentUser.uid, text: "Файл", fileUrl: url, fileName: file.name, fileType: file.type, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
    }

    // --- Modals ---
    showProfileSettings() {
        const mod = document.getElementById('modal-container');
        document.getElementById('modal-title').innerText = 'Настройки профиля';
        document.getElementById('modal-body').innerHTML = `<div class="input-group"><input type="text" id="set-username" placeholder="Новый никнейм"></div>`;
        mod.classList.remove('hidden');
        document.getElementById('modal-confirm').onclick = async () => {
            const newName = document.getElementById('set-username').value.trim();
            if (newName) {
                await db.collection('users').doc(this.currentUser.uid).update({ username: newName, avatar: newName[0].toUpperCase(), searchKeywords: newName.toLowerCase() });
                location.reload();
            }
        };
    }

    showCreateGroup() {
        const mod = document.getElementById('modal-container');
        document.getElementById('modal-title').innerText = 'Создать группу';
        document.getElementById('modal-body').innerHTML = `<div class="input-group"><input type="text" id="set-group-name" placeholder="Название группы"></div>`;
        mod.classList.remove('hidden');
        document.getElementById('modal-confirm').onclick = async () => {
            const name = document.getElementById('set-group-name').value.trim();
            if (name) {
                const ref = await db.collection('chats').add({
                    name, type: 'group', participants: [this.currentUser.uid],
                    searchKeywords: name.toLowerCase(),
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    lastMessage: { text: "Группа создана" }
                });
                mod.classList.add('hidden');
                this.openChat(ref.id, { id: ref.id, name, avatar: '👥', type: 'group' });
            }
        };
    }

    escape(s) { return s ? s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])) : ""; }
    switchScreen(n) { Object.values(this.screens).forEach(s => s.classList.remove('active')); this.screens[n].classList.add('active'); }
}

window.onload = () => new Vinychat();
