// ==================== GLOBAL VARIABLES ====================
let currentChat = null;
let currentPeerId = null;
let currentMessagesRef = null;
let currentTypingRef = null;
let usersCache = {};
let currentMediaType = null;
let unreadMessages = {};
const maxProfilePhotoSize = 500 * 1024; // 500KB

// ==================== FIREBASE INITIALIZATION ====================
const chatBox = document.getElementById("chat-box");
const userList = document.getElementById("user-list");
const auth = firebase.auth();
const chatDb = firebase.database();

const fallbackAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' fill='%23dfe7e4'/%3E%3Ccircle cx='48' cy='35' r='18' fill='%23728a84'/%3E%3Cpath d='M18 88c4-18 18-29 30-29s26 11 30 29' fill='%23728a84'/%3E%3C/svg%3E";

// ==================== HELPER FUNCTIONS ====================
function getChatId(user1, user2) {
    return user1 < user2 ? user1 + "_" + user2 : user2 + "_" + user1;
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getDisplayName(user) {
    if (!user) return "Unknown user";
    if (user.username && user.username.trim()) return user.username;
    if (user.displayName && user.displayName.trim()) return user.displayName;
    if (user.email) return user.email.split('@')[0];
    return "User";
}

function formatMessageTime(value) {
    if (!value) return "";
    const date = new Date(value);
    const now = new Date();
    const diffMins = Math.floor((now - date) / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
}

function setImage(element, src) {
    if (!element) return;
    element.src = src || fallbackAvatar;
}

// Compress image for database storage
async function compressImage(dataUrl, maxWidth = 150, maxHeight = 150, quality = 0.6) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let width = img.width;
            let height = img.height;
            
            if (width > height) {
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width = (width * maxHeight) / height;
                    height = maxHeight;
                }
            }
            
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = dataUrl;
    });
}

// ==================== PROFILE FUNCTIONS ====================
function setProfileUploadStatus(message, type) {
    const status = document.getElementById("profileUploadStatus");
    if (status) {
        status.textContent = message || "";
        status.className = "profile-upload-status" + (type ? " " + type : "");
    }
}

function validateProfilePhoto(file) {
    if (!file) return null;
    if (!file.type.startsWith("image/")) return "Please choose an image file.";
    if (file.size > maxProfilePhotoSize) return "Choose an image smaller than 500 KB.";
    return null;
}

window.previewProfilePhoto = function(file) {
    const error = validateProfilePhoto(file);
    if (error) {
        setProfileUploadStatus(error, "error");
        document.getElementById("profilePhoto").value = "";
        return;
    }
    if (!file) {
        setProfileUploadStatus("");
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        setImage(document.getElementById("profilePreview"), e.target.result);
        setProfileUploadStatus("New photo selected. Save profile to upload it.", "info");
    };
    reader.readAsDataURL(file);
};

function displayActiveUserProfile(user) {
    const container = document.getElementById("activeUserProfile");
    if (!container) return;
    const profile = usersCache[user.uid] || {};
    const photoUrl = profile.photo || fallbackAvatar;
    const displayName = getDisplayName(profile) || "User";
    container.innerHTML = `
        <div class="active-user-info">
            <img class="avatar" src="${escapeHtml(photoUrl)}" alt="Profile">
            <div class="active-user-details">
                <strong class="active-user-name">${escapeHtml(displayName)}</strong>
                <small class="active-user-status">${escapeHtml(profile.status || "Online")}</small>
            </div>
            <button class="edit-profile-btn" onclick="toggleProfilePanel()">✏️ Edit</button>
        </div>
    `;
}

window.toggleProfilePanel = function() {
    const panel = document.getElementById("profilePanel");
    if (panel) {
        panel.style.display = panel.style.display === "none" || !panel.style.display ? "block" : "none";
    }
};

window.loadAndDisplayUserProfile = async function(user) {
    if (!user) return;
    const snapshot = await chatDb.ref(`users/${user.uid}`).once("value");
    const profile = snapshot.val() || {};
    usersCache[user.uid] = profile;
    document.getElementById("profileName").value = profile.username || "";
    document.getElementById("profileStatus").value = profile.status || "";
    setImage(document.getElementById("profilePreview"), profile.photo || fallbackAvatar);
    displayActiveUserProfile(user);
    return profile;
};

window.shareProfile = async function() {
    const user = auth.currentUser;
    if (!user) return;
    const profile = usersCache[user.uid];
    const shareText = `Check out ${getDisplayName(profile)} on ChatMate!\nStatus: ${profile.status || "Available"}`;
    if (navigator.share) {
        try {
            await navigator.share({ title: `${getDisplayName(profile)}'s Profile`, text: shareText });
        } catch (e) { console.log("Share cancelled"); }
    } else {
        await navigator.clipboard.writeText(shareText);
        alert("Profile copied to clipboard!");
    }
};

// ==================== SAVE PROFILE (Visible to all users) ====================
window.saveProfile = async function() {
    const user = auth.currentUser;
    if (!user) return;

    const name = document.getElementById("profileName").value.trim();
    const status = document.getElementById("profileStatus").value.trim();
    const photoFile = document.getElementById("profilePhoto").files[0];
    const saveBtn = document.querySelector(".profile-panel .primary-btn");

    if (!name) {
        setProfileUploadStatus("Please enter your name", "error");
        return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
    setProfileUploadStatus("Saving profile...", "info");

    try {
        let photoDataUrl = null;
        if (photoFile) {
            const error = validateProfilePhoto(photoFile);
            if (error) throw new Error(error);
            
            setProfileUploadStatus("Processing photo...", "info");
            const originalData = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.readAsDataURL(photoFile);
            });
            photoDataUrl = await compressImage(originalData, 150, 150, 0.5);
            setImage(document.getElementById("profilePreview"), photoDataUrl);
        }

        const updates = {
            username: name,
            displayName: name,
            status: status || "Available",
            email: user.email,
            online: true,
            lastSeen: Date.now(),
            updatedAt: Date.now()
        };
        if (photoDataUrl) updates.photo = photoDataUrl;

        await chatDb.ref(`users/${user.uid}`).update(updates);
        
        if (user.updateProfile) {
            await user.updateProfile({ displayName: name });
        }

        document.getElementById("profilePhoto").value = "";
        const snapshot = await chatDb.ref(`users/${user.uid}`).once("value");
        usersCache[user.uid] = snapshot.val();
        displayActiveUserProfile(user);
        renderUsers();

        setProfileUploadStatus("Profile saved! Everyone can see it.", "success");
        setTimeout(() => {
            setProfileUploadStatus("", "");
            document.getElementById("profilePanel").style.display = "none";
        }, 2000);
    } catch (error) {
        setProfileUploadStatus("Error: " + error.message, "error");
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save profile";
    }
};

// ==================== MESSAGE FUNCTIONS ====================
async function markMessagesAsRead(chatId, userId) {
    const user = auth.currentUser;
    if (!user) return;
    const messagesRef = chatDb.ref(`messages/${chatId}`);
    const snapshot = await messagesRef.orderByChild("seen").equalTo(false).once("value");
    const updates = {};
    snapshot.forEach((child) => {
        const msg = child.val();
        if (msg.receiverId === user.uid) updates[`${child.key}/seen`] = true;
    });
    if (Object.keys(updates).length) await messagesRef.update(updates);
    unreadMessages[userId] = 0;
    renderUsers();
}

function renderMessage(snapshot) {
    const data = snapshot.val();
    if (!data) return;
    const isMine = auth.currentUser && data.senderId === auth.currentUser.uid;
    const sender = escapeHtml(getDisplayName({ username: data.senderName, email: data.senderEmail }));
    const message = document.createElement("div");
    message.className = isMine ? "message mine" : "message theirs";
    message.innerHTML = `
        <div class="message-meta"><strong>${sender}</strong></div>
        ${data.image ? `<img class="message-photo" src="${data.image}" alt="Photo" onclick="window.open('${data.image}', '_blank')">` : `<div>${escapeHtml(data.text || "")}</div>`}
        <span class="message-time">${formatMessageTime(data.time)}</span>
        ${data.seen && isMine ? '<span class="seen">✓ Seen</span>' : ''}
    `;
    chatBox.appendChild(message);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function listenToChat(chatId, peerId) {
    if (currentMessagesRef) currentMessagesRef.off();
    chatBox.innerHTML = "";
    currentChat = chatId;
    currentPeerId = peerId;
    currentMessagesRef = chatDb.ref("messages/" + chatId);
    currentMessagesRef.orderByChild("time").on("child_added", (snapshot) => {
        renderMessage(snapshot);
        if (snapshot.val().senderId !== auth.currentUser?.uid) markMessagesAsRead(chatId, peerId);
    });
    
    if (currentTypingRef) currentTypingRef.off();
    const indicator = document.getElementById("typingIndicator");
    currentTypingRef = chatDb.ref("typing/" + chatId + "/" + peerId);
    currentTypingRef.on("value", (s) => indicator.textContent = s.exists() ? "✏️ Typing..." : "");
    markMessagesAsRead(chatId, peerId);
}

function openChat(userId) {
    const user = auth.currentUser;
    if (!user || user.uid === userId) return;
    const peer = usersCache[userId];
    document.getElementById("activeChatName").textContent = getDisplayName(peer);
    document.getElementById("activeChatStatus").textContent = peer.online ? "🟢 Online" : `📅 Last seen ${formatMessageTime(peer.lastSeen)}`;
    setImage(document.getElementById("activeChatPhoto"), peer.photo);
    listenToChat(getChatId(user.uid, userId), userId);
    renderUsers();
}

function filterUsers() {
    const search = document.getElementById("userSearch").value.toLowerCase();
    document.querySelectorAll("#user-list .user").forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(search) ? "" : "none";
    });
}

function renderUsers() {
    if (!userList) return;
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    userList.innerHTML = "";
    const usersToDisplay = [];
    
    Object.keys(usersCache).forEach(uid => {
        if (uid === currentUser.uid) return;
        const profile = usersCache[uid];
        usersToDisplay.push({
            uid, profile,
            lastMessageTime: profile.lastMessageTime || 0,
            unreadCount: unreadMessages[uid] || 0,
            online: profile.online || false
        });
    });
    
    usersToDisplay.sort((a, b) => {
        if (a.online && a.unreadCount > 0 && !(b.online && b.unreadCount > 0)) return -1;
        if (!(a.online && a.unreadCount > 0) && b.online && b.unreadCount > 0) return 1;
        if (a.online && !b.online) return -1;
        if (!a.online && b.online) return 1;
        if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
        if (a.unreadCount === 0 && b.unreadCount > 0) return 1;
        return b.lastMessageTime - a.lastMessageTime;
    });
    
    usersToDisplay.forEach(({ uid, profile, unreadCount }) => {
        const row = document.createElement("button");
        row.className = `user ${uid === currentPeerId ? "active" : ""}`;
        row.onclick = () => openChat(uid);
        row.innerHTML = `
            <div class="user-avatar-wrapper">
                <img class="avatar" src="${escapeHtml(profile.photo || fallbackAvatar)}" alt="">
                ${profile.online ? '<span class="online-indicator"></span>' : ''}
            </div>
            <div class="user-info">
                <div class="user-name-row">
                    <strong class="user-name">${escapeHtml(getDisplayName(profile))}</strong>
                    <span class="user-time">${profile.lastMessageTime ? formatMessageTime(profile.lastMessageTime) : ''}</span>
                </div>
                <div class="user-message-row">
                    <span class="user-last-message">${escapeHtml((profile.lastMessage || "").substring(0, 30)) || '💬 Click to chat'}</span>
                    ${unreadCount > 0 ? `<span class="unread-badge">${unreadCount}</span>` : ''}
                </div>
            </div>
        `;
        userList.appendChild(row);
    });
    
    if (!userList.children.length) {
        userList.innerHTML = '<p class="empty-state">👋 No other users yet.</p>';
    }
}

function trackUnreadMessages() {
    const user = auth.currentUser;
    if (!user) return;
    chatDb.ref("messages").on("child_added", (s) => {
        const msgs = s.val();
        if (msgs) Object.keys(msgs).forEach(key => {
            const msg = msgs[key];
            if (msg && msg.receiverId === user.uid && !msg.seen) {
                unreadMessages[msg.senderId] = (unreadMessages[msg.senderId] || 0) + 1;
                renderUsers();
            }
        });
    });
}

function trackLastMessages() {
    const user = auth.currentUser;
    if (!user) return;
    chatDb.ref("messages").on("child_added", (s) => {
        const msgs = s.val();
        if (!msgs) return;
        let latest = null, latestTime = 0;
        Object.keys(msgs).forEach(key => {
            const msg = msgs[key];
            if (msg && msg.time > latestTime) { latestTime = msg.time; latest = msg; }
        });
        if (latest) {
            const parts = s.key.split("_");
            const otherId = parts[0] === user.uid ? parts[1] : parts[0];
            if (usersCache[otherId]) {
                usersCache[otherId].lastMessage = latest.text || (latest.image ? "📷 Photo" : "Media");
                usersCache[otherId].lastMessageTime = latestTime;
                renderUsers();
            }
        }
    });
}

window.sendMessage = function() {
    const input = document.getElementById("message");
    const user = auth.currentUser;
    if (!user || !currentChat) { alert("Select a user to message first."); return; }
    if (!input.value.trim()) return;
    const me = usersCache[user.uid] || {};
    const timestamp = Date.now();
    chatDb.ref("messages/" + currentChat).push({
        text: input.value.trim(),
        senderId: user.uid,
        senderName: getDisplayName(me),
        receiverId: currentPeerId,
        seen: false,
        time: timestamp
    });
    if (usersCache[currentPeerId]) {
        usersCache[currentPeerId].lastMessage = input.value.trim();
        usersCache[currentPeerId].lastMessageTime = timestamp;
        renderUsers();
    }
    input.value = "";
    chatDb.ref("typing/" + currentChat + "/" + user.uid).remove();
};

window.handleMessageKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
window.typing = () => {
    const user = auth.currentUser;
    if (!user || !currentChat) return;
    const ref = chatDb.ref("typing/" + currentChat + "/" + user.uid);
    ref.set(true);
    setTimeout(() => ref.remove(), 2000);
};

// ==================== MEDIA FUNCTIONS ====================
window.toggleMediaPicker = () => {
    const picker = document.getElementById("mediaPicker");
    if (picker) picker.hidden = !picker.hidden;
};

window.pickMediaType = (type) => {
    if (type === 'image') {
        document.getElementById("mediaFile").click();
        closePicker();
    }
};

async function uploadImageMessage(file) {
    if (!file || !currentChat || !currentPeerId) return;
    const user = auth.currentUser;
    if (!user) return;
    const me = usersCache[user.uid] || {};
    setProfileUploadStatus("Processing image...", "info");
    const originalData = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
    });
    const compressed = await compressImage(originalData, 300, 300, 0.5);
    await chatDb.ref("messages/" + currentChat).push({
        senderId: user.uid,
        senderName: getDisplayName(me),
        receiverId: currentPeerId,
        seen: false,
        time: Date.now(),
        image: compressed
    });
    setProfileUploadStatus("", "");
    closePicker();
    document.getElementById("mediaFile").value = "";
}

function closePicker() {
    document.getElementById("mediaPicker").hidden = true;
}

// ==================== CALL FUNCTIONS ====================
window.startCall = (mode) => {
    if (!currentPeerId) { alert("Select a user to call first"); return; }
    const peerName = getDisplayName(usersCache[currentPeerId]);
    alert(`📞 Starting ${mode} call with ${peerName}\n\nCall feature coming soon!`);
};
window.answerCall = () => {};
window.endCall = () => {};

// ==================== LOGOUT ====================
window.logout = async () => {
    const user = auth.currentUser;
    if (user) await chatDb.ref("users/" + user.uid).update({ online: false, lastSeen: Date.now() });
    auth.signOut().then(() => window.location = "login.html");
};

// ==================== REFRESH CACHE ====================
window.refreshUserCache = async () => {
    const snapshot = await chatDb.ref("users").once("value");
    usersCache = snapshot.val() || {};
    renderUsers();
    if (currentPeerId && usersCache[currentPeerId]) {
        document.getElementById("activeChatName").textContent = getDisplayName(usersCache[currentPeerId]);
        document.getElementById("activeChatStatus").textContent = usersCache[currentPeerId].online ? "🟢 Online" : `📅 Last seen ${formatMessageTime(usersCache[currentPeerId].lastSeen)}`;
        setImage(document.getElementById("activeChatPhoto"), usersCache[currentPeerId].photo);
    }
    return usersCache;
};

// ==================== INITIALIZATION ====================
document.getElementById("mediaFile").addEventListener("change", (e) => {
    if (e.target.files[0]) uploadImageMessage(e.target.files[0]);
});

auth.onAuthStateChanged(async (user) => {
    if (!user) { window.location = "login.html"; return; }
    chatBox.innerHTML = '<div class="empty-chat"><img src="mate.png"><strong>Your messages</strong><span>Select a user to start chatting</span></div>';
    const userStatus = chatDb.ref("users/" + user.uid);
    const defaultName = user.email.split('@')[0];
    userStatus.update({ email: user.email, online: true, lastSeen: Date.now(), username: defaultName });
    userStatus.onDisconnect().update({ online: false, lastSeen: Date.now() });
    await window.loadAndDisplayUserProfile(user);
    trackUnreadMessages();
    trackLastMessages();
    setInterval(() => window.refreshUserCache(), 30000);
});

chatDb.ref("users").on("value", (s) => {
    usersCache = s.val() || {};
    renderUsers();
    if (currentPeerId && usersCache[currentPeerId]) {
        document.getElementById("activeChatName").textContent = getDisplayName(usersCache[currentPeerId]);
        document.getElementById("activeChatStatus").textContent = usersCache[currentPeerId]?.online ? "🟢 Online" : `📅 Last seen ${formatMessageTime(usersCache[currentPeerId]?.lastSeen)}`;
        setImage(document.getElementById("activeChatPhoto"), usersCache[currentPeerId]?.photo);
    }
});