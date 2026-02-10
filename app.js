/**
 * Vinychat Engine 2.0
 * Firebase Integration: Auth, Firestore, Storage
 */

// --- FIX ME: ПАСТИТЬ ТУТ СВОЙ CONFIG ИЗ FIREBASE CONSOLE ---
const firebaseConfig = {
    apiKey: "AIzaSyBVK86LPh7qGO2sllS5G9Gxk7lCxJA-2Go",
    authDomain: "vinychat-c2c4c.firebaseapp.com",
    projectId: "vinychat-c2c4c",
    storageBucket: "vinychat-c2c4c.firebasestorage.app",
    messagingSenderId: "756427796615",
    appId: "1:756427796615:web:002f5a5080b0a3adc88822"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

class Vinychat {
    constructor() {
        this.currentUser = null;
        this.activeChatId = null;
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
            attach: document.getElementById('btn-attachment'),
            voiceMsg: document.getElementById('btn-voice-msg'),
            voiceCall: document.getElementById('btn-voice-call')
        };
        this.areas = {
            chatList: document.getElementById('chat-list'),
            messages: document.getElementById('messages-area'),
            activeChat: document.getElementById('active-chat'),
            noChat: document.getElementById('no-chat-selected')
        };
        this.activeChatName = document.getElementById('active-chat-name');
    }

    initEvents() {
        // Forms Toggle
        document.getElementById('show-register').onclick = () => {
            document.getElementById('login-form').classList.add('hidden');
            document.getElementById('register-form').classList.remove('hidden');
        };
        document.getElementById('show-login').onclick = () => {
            document.getElementById('register-form').classList.add('hidden');
            document.getElementById('login-form').classList.remove('hidden');
        };

        // Auth
        document.getElementById('btn-login').onclick = () => this.handleLogin();
        document.getElementById('btn-register').onclick = () => this.handleRegister();
        document.getElementById('btn-logout').onclick = () => auth.signOut();

        // Chat
        this.btn.send.onclick = () => this.sendMessage();
        this.inputs.msg.onkeypress = (e) => (e.key === 'Enter' && this.sendMessage());
        this.inputs.search.oninput = () => this.searchUsers();

        // Files
        this.btn.attach.onclick = () => this.inputs.file.click();
        this.inputs.file.onchange = (e) => this.handleFileUpload(e.target.files[0]);

        // Voice
        this.btn.voiceMsg.onclick = () => this.toggleVoiceRecording();
        this.btn.voiceCall.onclick = () => this.startVoiceCall();
        document.getElementById('btn-end-call').onclick = () => this.endVoiceCall();

        // Modal
        document.getElementById('btn-create-group').onclick = () => this.showGroupModal();
        document.getElementById('modal-cancel').onclick = () => document.getElementById('modal-container').classList.add('hidden');
    }

    // --- Authentication ---
    listenAuthState() {
        auth.onAuthStateChanged(user => {
            if (user) {
                this.currentUser = user;
                this.switchScreen('chat');
                this.loadUserData();
                this.loadChats();
            } else {
                this.switchScreen('auth');
            }
        });
    }

    async handleRegister() {
        const username = this.inputs.regUser.value;
        const email = this.inputs.regEmail.value;
        const pass = this.inputs.regPass.value;

        try {
            const cred = await auth.createUserWithEmailAndPassword(email, pass);
            await db.collection('users').doc(cred.user.uid).set({
                uid: cred.user.uid,
                username: username,
                email: email,
                avatar: username[0].toUpperCase(),
                status: 'online'
            });
        } catch (err) { alert(err.message); }
    }

    async handleLogin() {
        const email = this.inputs.loginEmail.value;
        const pass = this.inputs.loginPass.value;
        try {
            await auth.signInWithEmailAndPassword(email, pass);
        } catch (err) { alert(err.message); }
    }

    loadUserData() {
        db.collection('users').doc(this.currentUser.uid).get().then(doc => {
            const data = doc.data();
            document.getElementById('current-username').innerText = data.username;
            document.getElementById('current-user-avatar').innerText = data.avatar;
        });
    }

    // --- Database Handling ---
    loadChats() {
        // real-time listener for chats where user is participant
        db.collection('chats')
            .where('participants', 'array-contains', this.currentUser.uid)
            .onSnapshot(snapshot => {
                this.renderChatList(snapshot.docs);
            });
    }

    renderChatList(docs) {
        this.areas.chatList.innerHTML = '';
        docs.forEach(doc => {
            const chat = doc.data();
            const isGroup = chat.type === 'group';
            let chatName = chat.name;
            let avatar = isGroup ? '👥' : '?';

            const item = document.createElement('div');
            item.className = `chat-item ${this.activeChatId === doc.id ? 'active' : ''}`;
            item.onclick = () => this.openChat(doc.id, chat);

            // For personal chats, get other user info
            if (!isGroup) {
                const otherUid = chat.participants.find(id => id !== this.currentUser.uid);
                // We could fetch other user details here for better UX
            }

            item.innerHTML = `
                <div class="avatar">${avatar}</div>
                <div class="details">
                    <div class="top"><span class="name">${chatName || 'Чат'}</span></div>
                    <div class="msg">Сообщения загружаются...</div>
                </div>
            `;
            this.areas.chatList.appendChild(item);
        });
    }

    async searchUsers() {
        const term = this.inputs.search.value.toLowerCase();
        if (term.length < 3) return;

        const snapshot = await db.collection('users')
            .where('username', '>=', term)
            .where('username', '<=', term + '\uf8ff')
            .get();

        if (!snapshot.empty) {
            // Logic to show search results and start new chats
            // Similar to previous version but with Firestore queries
        }
    }

    openChat(chatId, chatData) {
        this.activeChatId = chatId;
        this.areas.noChat.classList.add('hidden');
        this.areas.activeChat.classList.remove('hidden');
        this.activeChatName.innerText = chatData.name || 'Диалог';

        // Listen for messages
        if (this.unsubMessages) this.unsubMessages();
        this.unsubMessages = db.collection('chats').doc(chatId)
            .collection('messages')
            .orderBy('timestamp', 'asc')
            .onSnapshot(snapshot => this.renderMessages(snapshot.docs));
    }

    renderMessages(docs) {
        this.areas.messages.innerHTML = '';
        docs.forEach(doc => {
            const msg = doc.data();
            const isMine = msg.senderId === this.currentUser.uid;

            const msgEl = document.createElement('div');
            msgEl.className = `message ${isMine ? 'mine' : 'other'}`;

            let content = `<div class="msg-text">${msg.text}</div>`;
            if (msg.fileUrl) {
                if (msg.fileType.startsWith('image/')) {
                    content = `<img src="${msg.fileUrl}" class="photo-attachment">` + content;
                } else {
                    content = `<a href="${msg.fileUrl}" target="_blank" class="file-attachment">📄 ${msg.fileName}</a>` + content;
                }
            }

            msgEl.innerHTML = `
                ${content}
                <div class="msg-meta">${new Date(msg.timestamp?.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            `;
            this.areas.messages.appendChild(msgEl);
        });
        this.areas.messages.scrollTop = this.areas.messages.scrollHeight;
    }

    async sendMessage(extra = {}) {
        const text = this.inputs.msg.value.trim();
        if (!text && !extra.fileUrl) return;

        await db.collection('chats').doc(this.activeChatId).collection('messages').add({
            senderId: this.currentUser.uid,
            text: text,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            ...extra
        });

        this.inputs.msg.value = '';
    }

    // --- File Support ---
    async handleFileUpload(file) {
        if (!file || !this.activeChatId) return;

        const path = `chats/${this.activeChatId}/${Date.now()}_${file.name}`;
        const ref = storage.ref().child(path);

        try {
            const snapshot = await ref.put(file);
            const url = await snapshot.ref.getDownloadURL();

            this.sendMessage({
                fileUrl: url,
                fileName: file.name,
                fileType: file.type
            });
        } catch (err) { alert('Ошибка загрузки: ' + err.message); }
    }

    // --- Voice Logic (Conceptual) ---
    toggleVoiceRecording() {
        if (!this.isRecording) {
            this.startRecording();
        } else {
            this.stopRecording();
        }
    }

    startRecording() {
        this.isRecording = true;
        this.btn.voiceMsg.classList.add('recording');
        // Web Audio API logic for recording...
    }

    stopRecording() {
        this.isRecording = false;
        this.btn.voiceMsg.classList.remove('recording');
        // Logic to upload blob to storage and send message...
    }

    startVoiceCall() {
        document.getElementById('voice-overlay').classList.remove('hidden');
        // Integration with WebRTC (Simple foundation)
        this.callTimerInterval = setInterval(() => {
            // Update UI timer
        }, 1000);
    }

    endVoiceCall() {
        document.getElementById('voice-overlay').classList.add('hidden');
        clearInterval(this.callTimerInterval);
    }

    switchScreen(name) {
        Object.values(this.screens).forEach(s => s.classList.remove('active'));
        this.screens[name].classList.add('active');
    }

    showGroupModal() {
        const modal = document.getElementById('modal-container');
        document.getElementById('modal-body').innerHTML = `<input type="text" id="group-name-in" placeholder="Имя группы">`;
        modal.classList.remove('hidden');

        document.getElementById('modal-confirm').onclick = async () => {
            const name = document.getElementById('group-name-in').value;
            if (name) {
                await db.collection('chats').add({
                    name: name,
                    type: 'group',
                    participants: [this.currentUser.uid],
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                modal.classList.add('hidden');
            }
        };
    }
}

window.onload = () => new Vinychat();
