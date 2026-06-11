// ==================== GLOBAL VARIABLES ====================
let currentChat = null;
let currentPeerId = null;
let currentMessagesRef = null;
let currentTypingRef = null;
let usersCache = {};
let currentMediaType = null;
let unreadMessages = {};
const maxProfilePhotoSize = 500 * 1024;

const chatBox = document.getElementById("chat-box");
const userList = document.getElementById("user-list");
const auth = window.auth;
const chatDb = window.db;

const fallbackAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' fill='%23dfe7e4'/%3E%3Ccircle cx='48' cy='35' r='18' fill='%23728a84'/%3E%3Cpath d='M18 88c4-18 18-29 30-29s26 11 30 29' fill='%23728a84'/%3E%3C/svg%3E";

// ==================== HELPER FUNCTIONS ====================
function getChatId(user1, user2) { return user1 < user2 ? user1 + "_" + user2 : user2 + "_" + user1; }
function escapeHtml(value) { return String(value || "").replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] || m)); }
function getDisplayName(user) { return user?.username || user?.displayName || (user?.email?.split('@')[0]) || "User"; }
function formatMessageTime(value) { if (!value) return ""; const diff = Math.floor((Date.now() - value) / 60000); if (diff < 1) return "Just now"; if (diff < 60) return `${diff}m ago`; if (diff < 1440) return `${Math.floor(diff / 60)}h ago`; return new Date(value).toLocaleDateString(); }
function setImage(element, src) { if (element) element.src = src || fallbackAvatar; }
function showToast(message, type = 'success') { const toast = document.createElement('div'); toast.className = `toast ${type}`; toast.textContent = message; document.body.appendChild(toast); setTimeout(() => toast.remove(), 3000); }

// ==================== FRIEND FUNCTIONS ====================
window.areFriends = async function(targetUserId) {
    const currentUser = auth.currentUser;
    if (!currentUser || targetUserId === currentUser.uid) return currentUser?.uid === targetUserId;
    const friendCheck = await chatDb.ref(`users/${currentUser.uid}/friends/${targetUserId}`).once("value");
    return friendCheck.exists();
};

// ==================== PROFILE FUNCTIONS ====================
function displayActiveUserProfile(user) {
    const container = document.getElementById("activeUserProfile");
    if (!container) return;
    const profile = usersCache[user.uid] || {};
    container.innerHTML = `<div class="active-user-info"><img class="avatar" src="${escapeHtml(profile.photo || fallbackAvatar)}"><div><strong class="active-user-name">${escapeHtml(getDisplayName(profile))}</strong><small>${escapeHtml(profile.status || "Online")}</small></div><button class="edit-profile-btn" onclick="toggleProfilePanel()">✏️</button></div>`;
}

window.toggleProfilePanel = function() { const p = document.getElementById("profilePanel"); if (p) p.style.display = p.style.display === "none" || !p.style.display ? "block" : "none"; };
window.loadAndDisplayUserProfile = async function(user) { const s = await chatDb.ref(`users/${user.uid}`).once("value"); const p = s.val() || {}; usersCache[user.uid] = p; document.getElementById("profileName").value = p.username || ""; document.getElementById("profileStatus").value = p.status || ""; setImage(document.getElementById("profilePreview"), p.photo); displayActiveUserProfile(user); return p; };

// ==================== RENDER USERS ====================
async function renderUsers() {
    if (!userList) return;
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    userList.innerHTML = "";
    const f = await chatDb.ref(`users/${currentUser.uid}/friends`).once("value");
    const friends = f.val() || {};
    const friendIds = Object.keys(friends);
    if (friendIds.length === 0) { userList.innerHTML = `<div class="empty-state"><p>😊 No friends yet</p><a href="discover.html" class="discover-link">🌍 Discover People</a></div>`; return; }
    const toDisplay = [];
    for (const fid of friendIds) {
        let profile = usersCache[fid] || {};
        if (!profile.username) { const ps = await chatDb.ref(`users/${fid}`).once("value"); profile = ps.val() || {}; usersCache[fid] = profile; }
        toDisplay.push({ uid: fid, profile, lastMessageTime: profile.lastMessageTime || 0, unreadCount: unreadMessages[fid] || 0, online: profile.online || false });
    }
    toDisplay.sort((a, b) => (b.online - a.online) || (b.unreadCount - a.unreadCount) || (b.lastMessageTime - a.lastMessageTime));
    toDisplay.forEach(({ uid, profile, unreadCount }) => {
        const row = document.createElement("button");
        row.className = `user ${uid === currentPeerId ? "active" : ""}`;
        row.onclick = () => openChat(uid);
        row.innerHTML = `<div><img class="avatar" src="${profile.photo || fallbackAvatar}">${profile.online ? '<span class="online-indicator"></span>' : ''}</div><div><strong>${escapeHtml(getDisplayName(profile))}</strong><small>${profile.lastMessageTime ? formatMessageTime(profile.lastMessageTime) : ''}</small><div>${escapeHtml((profile.lastMessage || "").substring(0, 30)) || 'Click to chat'}${unreadCount > 0 ? `<span class="unread-badge">${unreadCount}</span>` : ''}</div></div>`;
        userList.appendChild(row);
    });
    const btn = document.createElement("div"); btn.className = "discover-friends-btn"; btn.innerHTML = `<button onclick="window.location.href='discover.html'" class="discover-btn">🌍 Discover New Friends</button>`; userList.appendChild(btn);
}

// ==================== CHAT FUNCTIONS ====================
function updateChatHeader(peer) { const name = document.getElementById("activeChatName"); const status = document.getElementById("activeChatStatus"); const photo = document.getElementById("activeChatPhoto"); const badge = document.getElementById("friendStatusBadge"); if (!peer) { if (name) name.textContent = "Choose someone to chat"; if (status) status.textContent = "Select a person from Messages."; setImage(photo, ""); if (badge) badge.style.display = "none"; return; } if (name) name.textContent = getDisplayName(peer); if (status) status.textContent = peer.online ? "🟢 Online" : `📅 Last seen ${formatMessageTime(peer.lastSeen)}`; setImage(photo, peer.photo); if (badge) badge.style.display = "inline-block"; }

function renderMessage(s) { const d = s.val(); if (!d) return; const isMine = auth.currentUser && d.senderId === auth.currentUser.uid; const msg = document.createElement("div"); msg.className = isMine ? "message mine" : "message theirs"; msg.innerHTML = `<div><strong>${escapeHtml(getDisplayName({ username: d.senderName, email: d.senderEmail }))}</strong></div>${d.image ? `<img class="message-photo" src="${d.image}" onclick="window.open('${d.image}','_blank')">` : `<div>${escapeHtml(d.text || "")}</div>`}<span>${formatMessageTime(d.time)}</span>${d.seen && isMine ? '<span>✓ Seen</span>' : ''}`; chatBox.appendChild(msg); chatBox.scrollTop = chatBox.scrollHeight; }

function listenToChat(chatId, peerId) { if (currentMessagesRef) currentMessagesRef.off(); chatBox.innerHTML = ""; currentChat = chatId; currentPeerId = peerId; currentMessagesRef = chatDb.ref("messages/" + chatId); currentMessagesRef.orderByChild("time").on("child_added", m => { renderMessage(m); if (m.val().senderId !== auth.currentUser?.uid) chatDb.ref(`messages/${chatId}/${m.key}/seen`).set(true); }); if (currentTypingRef) currentTypingRef.off(); const ind = document.getElementById("typingIndicator"); currentTypingRef = chatDb.ref("typing/" + chatId + "/" + peerId); currentTypingRef.on("value", s => ind.textContent = s.exists() ? "✏️ Typing..." : ""); }

async function openChat(userId) { const user = auth.currentUser; if (!user || user.uid === userId) return; const f = await chatDb.ref(`users/${user.uid}/friends/${userId}`).once("value"); if (!f.exists()) { alert("❌ You can only chat with accepted friends."); return; } const peer = usersCache[userId]; updateChatHeader(peer); listenToChat(getChatId(user.uid, userId), userId); renderUsers(); }

// ==================== SEND MESSAGE ====================
window.sendMessage = async function() {
    const input = document.getElementById("message");
    const user = auth.currentUser;
    if (!user || !currentChat) { alert("Select a user to message first."); return; }
    if (!input.value.trim()) return;
    const areFriends = await window.areFriends(currentPeerId);
    if (!areFriends && currentPeerId !== user.uid) { alert("❌ You can only message friends."); return; }
    const me = usersCache[user.uid] || {};
    const ts = Date.now();
    await chatDb.ref("messages/" + currentChat).push({ text: input.value.trim(), senderId: user.uid, senderName: getDisplayName(me), receiverId: currentPeerId, seen: false, time: ts });
    if (usersCache[currentPeerId]) { usersCache[currentPeerId].lastMessage = input.value.trim(); usersCache[currentPeerId].lastMessageTime = ts; renderUsers(); }
    input.value = "";
    chatDb.ref("typing/" + currentChat + "/" + user.uid).remove();
};
window.handleMessageKey = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
window.typing = () => { if (auth.currentUser && currentChat) chatDb.ref("typing/" + currentChat + "/" + auth.currentUser.uid).set(true).then(() => setTimeout(() => chatDb.ref("typing/" + currentChat + "/" + auth.currentUser.uid).remove(), 2000)); };

// ==================== MEDIA ====================
window.toggleMediaPicker = () => { const p = document.getElementById("mediaPicker"); if (p) p.hidden = !p.hidden; };
window.pickMediaType = (type) => { if (type === 'image') { document.getElementById("mediaFile").click(); closePicker(); } };
function closePicker() { document.getElementById("mediaPicker").hidden = true; }
document.getElementById("mediaFile").addEventListener("change", async (e) => { if (e.target.files[0] && currentChat && currentPeerId) { const file = e.target.files[0]; const reader = new FileReader(); reader.onload = async (ev) => { const compressed = await new Promise(resolve => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = 300; c.height = 300; c.getContext('2d').drawImage(img, 0, 0, 300, 300); resolve(c.toDataURL('image/jpeg', 0.5)); }; img.src = ev.target.result; }); await chatDb.ref("messages/" + currentChat).push({ senderId: auth.currentUser.uid, senderName: getDisplayName(usersCache[auth.currentUser.uid] || {}), receiverId: currentPeerId, seen: false, time: Date.now(), image: compressed }); closePicker(); }; reader.readAsDataURL(file); } });

// ==================== LOGOUT ====================
window.logout = async () => { if (auth.currentUser) await chatDb.ref("users/" + auth.currentUser.uid).update({ online: false, lastSeen: Date.now() }); auth.signOut().then(() => window.location = "index.html"); };

// ==================== INIT ====================
auth.onAuthStateChanged(async user => {
    if (!user) { window.location = "index.html"; return; }
    chatBox.innerHTML = '<div class="empty-chat"><img src="mate.png"><strong>Your messages</strong><span>Select a user to start chatting</span></div>';
    await chatDb.ref("users/" + user.uid).update({ online: true, lastSeen: Date.now() });
    chatDb.ref("users/" + user.uid).onDisconnect().update({ online: false, lastSeen: Date.now() });
    await window.loadAndDisplayUserProfile(user);
    chatDb.ref("messages").on("child_added", s => { const msgs = s.val(); if (msgs) Object.keys(msgs).forEach(k => { const m = msgs[k]; if (m && m.receiverId === user.uid && !m.seen) { unreadMessages[m.senderId] = (unreadMessages[m.senderId] || 0) + 1; renderUsers(); } }); });
    setInterval(async () => { const s = await chatDb.ref("users").once("value"); usersCache = s.val() || {}; renderUsers(); if (currentPeerId && usersCache[currentPeerId]) updateChatHeader(usersCache[currentPeerId]); }, 30000);
    const stored = localStorage.getItem('openChatWith'); if (stored) { try { const { userId } = JSON.parse(stored); localStorage.removeItem('openChatWith'); setTimeout(async () => { if (usersCache[userId]) openChat(userId); else { const us = await chatDb.ref(`users/${userId}`).once("value"); if (us.val()) { usersCache[userId] = us.val(); openChat(userId); } } }, 1000); } catch(e) {} }
});
chatDb.ref("users").on("value", async s => { usersCache = s.val() || {}; await renderUsers(); if (currentPeerId && usersCache[currentPeerId]) updateChatHeader(usersCache[currentPeerId]); });