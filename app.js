/**
 * Vinychat Engine 2.2 - PROD FIX
 * Improved error handling for GitHub Pages & Live Hosting
 */

const firebaseConfig = {
    apiKey: "AIzaSyBVK86LPh7qGO2sllS5G9Gxk7lCxJA-2Go",
    authDomain: "vinychat-c2c4c.firebaseapp.com",
    projectId: "vinychat-c2c4c",
    storageBucket: "vinychat-c2c4c.firebasestorage.app",
    messagingSenderId: "756427796615",
    appId: "1:756427796615:web:002f5a5080b0a3adc88822"
};

// Initialize Firebase
try {
    firebase.initializeApp(firebaseConfig);
} catch (e) {
    console.error("Firebase init error:", e);
}

const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

class Vinychat {
    constructor() {
        this.currentUser = null;
        this.activeChatId = null;
        this.allChats = [];
        this.usersCache = {};
        this.initElements();
        this.initEvents();
        this.listenAuthState();
    }

    initElements() {
        this.screens = {
            auth: document.getElementById('auth-screen'),
            chat: document.getElementById('chat-screen')
        };
        this.inputs = {
            loginEmail: document.getElementById('login-email'),
            loginPass: document.getElementById('login-password'),
            regUser: document.getElementById('reg-username'),
            regEmail: document.getElementById('reg-email'),
            regPass: document.getElementById('reg-password'),
            msg: document.getElementById('message-input'),
            search: document.getElementById('chat-search'),
            file: document.getElementById('file-input')
        };
        this.btn = {
            send: document.getElementById('btn-send'),
            attach: document.getElementById('btn-attachment')
        };
        this.areas = {
            chatList: document.getElementById('chat-list'),
            messages: document.getElementById('messages-area'),
            activeChat: document.getElementById('active-chat'),
            noChat: document.getElementById('no-chat-selected')
        };
        this.activeChatName = document.getElementById('active-chat-name');
        this.activeChatAvatar = document.getElementById('active-chat-avatar');
    }

    initEvents() {
        // Forms Toggle
        document.getElementById('show-register').onclick = (e) => {
            e.preventDefault();
            document.getElementById('login-form').classList.add('hidden');
            document.getElementById('register-form').classList.remove('hidden');
        };
        document.getElementById('show-login').onclick = (e) => {
            e.preventDefault();
            document.getElementById('register-form').classList.add('hidden');
            document.getElementById('login-form').classList.remove('hidden');
        };

        // Actions
        document.getElementById('btn-login').onclick = () => this.handleLogin();
        document.getElementById('btn-register').onclick = () => this.handleRegister();
        document.getElementById('btn-logout').onclick = () => auth.signOut();

        this.btn.send.onclick = () => this.sendMessage();
        this.inputs.msg.onkeypress = (e) => (e.key === 'Enter' && this.sendMessage());
        this.inputs.search.oninput = () => this.searchUsers();

        this.btn.attach.onclick = () => this.inputs.file.click();
        this.inputs.file.onchange = (e) => this.handleFileUpload(e.target.files[0]);

        document.getElementById('btn-create-group').onclick = () => this.showGroupModal();
    }

    listenAuthState() {
        auth.onAuthStateChanged(user => {
            if (user) {
                this.currentUser = user;
                this.switchScreen('chat');
                this.loadUserData();
                this.loadChats();
            } else {
                this.switchScreen('auth');
                this.areas.chatList.innerHTML = '';
            }
        }, err => {
            alert("Ошибка Auth: " + err.message);
        });
    }

    async handleRegister() {
        const username = this.inputs.regUser.value.trim();
        const email = this.inputs.regEmail.value.trim();
        const pass = this.inputs.regPass.value.trim();

        if (!username || !email || !pass) return alert('Заполните все поля');

        try {
            const cred = await auth.createUserWithEmailAndPassword(email, pass);
            await db.collection('users').doc(cred.user.uid).set({
                uid: cred.user.uid,
                username: username,
                email: email,
                avatar: username[0].toUpperCase(),
                status: 'online',
                searchKeywords: username.toLowerCase()
            });
        } catch (err) { alert('Ошибка регистрации: ' + err.message); }
    }

    async handleLogin() {
        const email = this.inputs.loginEmail.value.trim();
        const pass = this.inputs.loginPass.value.trim();
        try { await auth.signInWithEmailAndPassword(email, pass); }
        catch (err) { alert('Ошибка входа: ' + err.message); }
    }

    loadUserData() {
        db.collection('users').doc(this.currentUser.uid).get().then(doc => {
            if (doc.exists) {
                const data = doc.data();
                document.getElementById('current-username').innerText = data.username;
                document.getElementById('current-user-avatar').innerText = data.avatar;
            }
        }).catch(e => console.error("User data load error:", e));
    }

    loadChats() {
        db.collection('chats')
            .where('participants', 'array-contains', this.currentUser.uid)
            .onSnapshot(snapshot => {
                this.allChats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                this.renderChatList();
            }, err => {
                alert("Ошибка загрузки чатов (проверьте правила Firestore): " + err.message);
            });
    }

    renderChatList(searchResults = []) {
        this.areas.chatList.innerHTML = '';

        if (searchResults.length > 0) {
            const header = document.createElement('div');
            header.className = 'status';
            header.style.padding = '10px 20px';
            header.innerText = 'Найдено:';
            this.areas.chatList.appendChild(header);

            searchResults.forEach(user => {
                const item = this.createChatItemUI({
                    name: user.username,
                    avatar: user.avatar,
                    lastMsg: 'Написать...',
                    onClick: () => this.startPrivateChat(user)
                });
                this.areas.chatList.appendChild(item);
            });
            this.areas.chatList.appendChild(document.createElement('hr'));
        }

        if (this.allChats && this.allChats.length > 0) {
            this.allChats.forEach(async chat => {
                let chatName = chat.name || "Групповой чат";
                let avatar = '👥';

                if (chat.type === 'personal') {
                    const otherUid = chat.participants.find(id => id !== this.currentUser.uid);
                    const otherUser = await this.getUserInfo(otherUid);
                    chatName = otherUser ? otherUser.username : 'Загрузка...';
                    avatar = otherUser ? otherUser.avatar : '?';
                }

                const item = this.createChatItemUI({
                    id: chat.id,
                    name: chatName,
                    avatar: avatar,
                    active: this.activeChatId === chat.id,
                    lastMsg: chat.lastMessage?.text || 'Нет сообщений',
                    onClick: () => this.openChat(chat.id, { ...chat, name: chatName, avatar: avatar })
                });
                this.areas.chatList.appendChild(item);
            });
        }
    }

    createChatItemUI({ id, name, avatar, lastMsg, active, onClick }) {
        const div = document.createElement('div');
        div.className = `chat-item ${active ? 'active' : ''}`;
        div.onclick = onClick;
        div.innerHTML = `
            <div class="avatar">${avatar}</div>
            <div class="details">
                <div class="top"><span class="name">${name}</span></div>
                <div class="msg">${lastMsg}</div>
            </div>
        `;
        return div;
    }

    async getUserInfo(uid) {
        if (this.usersCache[uid]) return this.usersCache[uid];
        try {
            const doc = await db.collection('users').doc(uid).get();
            if (doc.exists) {
                this.usersCache[uid] = doc.data();
                return doc.data();
            }
        } catch (e) { return null; }
        return null;
    }

    async searchUsers() {
        const term = this.inputs.search.value.toLowerCase().trim();
        if (term.length < 2) {
            this.renderChatList();
            return;
        }

        try {
            const snapshot = await db.collection('users')
                .where('searchKeywords', '>=', term)
                .where('searchKeywords', '<=', term + '\uf8ff')
                .limit(10)
                .get();

            const results = snapshot.docs
                .map(doc => doc.data())
                .filter(u => u.uid !== this.currentUser.uid);

            this.renderChatList(results);
        } catch (e) {
            console.error("Search error:", e);
        }
    }

    async startPrivateChat(otherUser) {
        const existing = this.allChats.find(c =>
            c.type === 'personal' && c.participants.includes(otherUser.uid)
        );

        if (existing) {
            this.openChat(existing.id, { ...existing, name: otherUser.username, avatar: otherUser.avatar });
        } else {
            try {
                const docRef = await db.collection('chats').add({
                    type: 'personal',
                    participants: [this.currentUser.uid, otherUser.uid],
                    lastMessage: { text: "Чат создан" },
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                this.openChat(docRef.id, { id: docRef.id, name: otherUser.username, avatar: otherUser.avatar });
            } catch (e) { alert("Ошибка при создании чата: " + e.message); }
        }
        this.inputs.search.value = '';
    }

    openChat(chatId, chatData) {
        this.activeChatId = chatId;
        this.areas.noChat.classList.add('hidden');
        this.areas.activeChat.classList.remove('hidden');

        this.activeChatName.innerText = chatData.name;
        this.activeChatAvatar.innerText = chatData.avatar || '👥';

        if (this.unsubMessages) this.unsubMessages();
        this.unsubMessages = db.collection('chats').doc(chatId)
            .collection('messages')
            .orderBy('timestamp', 'asc')
            .onSnapshot(snapshot => {
                this.renderMessages(snapshot.docs);
            }, err => {
                alert("Ошибка сообщений: " + err.message);
            });
    }

    renderMessages(docs) {
        this.areas.messages.innerHTML = '';
        docs.forEach(doc => {
            const msg = doc.data();
            const isMine = msg.senderId === this.currentUser.uid;
            const div = document.createElement('div');
            div.className = `message ${isMine ? 'mine' : 'other'}`;

            let content = `<div class="msg-text">${this.escapeHTML(msg.text || "")}</div>`;
            if (msg.fileUrl) {
                if (msg.fileType?.startsWith('image/')) {
                    content = `<img src="${msg.fileUrl}" class="photo-attachment" onclick="window.open('${msg.fileUrl}')">` + content;
                } else {
                    content = `<a href="${msg.fileUrl}" target="_blank" class="file-attachment">📄 ${msg.fileName}</a>` + content;
                }
            }

            div.innerHTML = `
                ${content}
                <div class="msg-meta">${msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...'}</div>
            `;
            this.areas.messages.appendChild(div);
        });
        this.areas.messages.scrollTop = this.areas.messages.scrollHeight;
    }

    async sendMessage() {
        const text = this.inputs.msg.value.trim();
        if (!text || !this.activeChatId) return;

        const chatId = this.activeChatId;
        const messageData = {
            senderId: this.currentUser.uid,
            text: text,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };

        this.inputs.msg.value = '';

        try {
            await db.collection('chats').doc(chatId).collection('messages').add(messageData);
            await db.collection('chats').doc(chatId).update({
                lastMessage: { text: text, senderId: this.currentUser.uid },
                lastActivity: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (err) { alert("Ошибка отправки: " + err.message); }
    }

    async handleFileUpload(file) {
        if (!file || !this.activeChatId) return;
        const btn = this.btn.attach;
        btn.innerText = '⏳';

        try {
            const ref = storage.ref(`chats/${this.activeChatId}/${Date.now()}_${file.name}`);
            const snap = await ref.put(file);
            const url = await snap.ref.getDownloadURL();

            await db.collection('chats').doc(this.activeChatId).collection('messages').add({
                senderId: this.currentUser.uid,
                text: "Отправлен файл",
                fileUrl: url,
                fileName: file.name,
                fileType: file.type,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (err) { alert('Ошибка загрузки: ' + err.message); }
        finally { btn.innerText = '📎'; }
    }

    showGroupModal() {
        const name = prompt('Название группы:');
        if (name) {
            db.collection('chats').add({
                name: name,
                type: 'group',
                participants: [this.currentUser.uid],
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastMessage: { text: 'Группа создана' }
            }).then(doc => this.openChat(doc.id, { id: doc.id, name: name, avatar: '👥' }))
                .catch(e => alert("Ошибка создания группы: " + e.message));
        }
    }

    escapeHTML(str) {
        if (!str) return "";
        return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }

    switchScreen(name) {
        Object.values(this.screens).forEach(s => s.classList.remove('active'));
        this.screens[name].classList.add('active');
    }
}

window.onload = () => { window.App = new Vinychat(); };
