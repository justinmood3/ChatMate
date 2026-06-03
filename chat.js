/* ============================================================
   chat.js  —  ChatMate frontend logic
   All media uploads go through /api/upload (server.js).
   Profile saves go through /api/upload-profile (server.js).
   ============================================================ */

'use strict';

/* ── Constants & state ────────────────────────────────────── */

const UPLOAD_URL         = '/api/upload';
const UPLOAD_PROFILE_URL = '/api/upload-profile';
const MAX_PROFILE_BYTES  = 5 * 1024 * 1024;   // 5 MB
const CALL_RING_TIMEOUT  = 45_000;             // 45 s
const FILE_CHUNK_SIZE    = 16_000;             // WebRTC data-channel chunk

const TERMINAL_STATUSES  = ['ended', 'declined', 'missed', 'cancelled', 'failed'];

let currentChat      = null;
let currentPeerId    = null;
let currentMessagesRef = null;
let currentTypingRef   = null;
let usersCache         = {};
let currentMediaType   = null;

/* WebRTC */
let localStream          = null;
let peerConnection       = null;
let currentCallId        = null;
let currentCallRef       = null;
let currentCallMode      = 'video';
let incomingCallData     = null;
let peerCandidateRef     = null;
let callValueRef         = null;
let callCandidatesRef    = null;
let pendingIceCandidates = [];
let dataChannel          = null;
let receivingFileMeta    = null;
let receivingFileTransfer = null;

/* Call history */
let callHistoryRef         = null;
let missedCallTimer        = null;
let lastRenderedCallHistory = [];

const servers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

/* ── DOM refs ─────────────────────────────────────────────── */

const chatBox  = document.getElementById('chat-box');
const userList = document.getElementById('user-list');
const callList = document.getElementById('call-list');
const auth     = firebase.auth();
const storage  = firebase.storage();   // kept for legacy reads; writes go via server

const fallbackAvatar =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect width='96' height='96' fill='%231e2d40'/%3E%3Ccircle cx='48' cy='35' r='18' fill='%234a6580'/%3E%3Cpath d='M18 88c4-18 18-29 30-29s26 11 30 29' fill='%234a6580'/%3E%3C/svg%3E";

/* ── Utilities ────────────────────────────────────────────── */

function getChatId(a, b) { return a < b ? `${a}_${b}` : `${b}_${a}`; }

function escapeHtml(v) {
    return String(v || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function getDisplayName(user) {
    if (!user) return 'Unknown user';
    return user.username || user.displayName || user.email || 'Unknown user';
}

function setImage(el, src) {
    if (el) el.src = src || fallbackAvatar;
}

function setProfileUploadStatus(msg, type) {
    const el = document.getElementById('profileUploadStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className   = 'profile-upload-status' + (type ? ` ${type}` : '');
}

function validateProfilePhoto(file) {
    if (!file) return '';
    if (!file.type?.startsWith('image/')) return 'Please choose an image file.';
    if (file.size > MAX_PROFILE_BYTES)     return 'Choose an image smaller than 5 MB.';
    return '';
}

/* ── Bootstrap ────────────────────────────────────────────── */

window.addEventListener('load', () => {
    /* Media file input → auto-upload on selection */
    document.getElementById('mediaFile')?.addEventListener('change', function () {
        if (this.files[0] && currentMediaType) {
            uploadMediaMessage(this.files[0], currentMediaType);
            this.value = '';
        }
    });

    /* Profile photo preview on selection */
    document.getElementById('profilePhoto')?.addEventListener('change', function () {
        previewSelectedProfilePhoto(this.files[0]);
    });
});

/* ── Media picker ─────────────────────────────────────────── */

window.toggleMediaPicker = function () {
    const picker = document.getElementById('mediaPicker');
    picker.hidden = !picker.hidden;
};

window.closePicker = function () {
    document.getElementById('mediaPicker').hidden = true;
};

window.pickMediaType = function (type) {
    currentMediaType = type;
    const input  = document.getElementById('mediaFile');
    const accept = { image: 'image/*', video: 'video/*', audio: 'audio/*',
                     document: '.pdf,.doc,.docx,.txt,.xlsx,.zip' };
    input.accept = accept[type] || '*/*';
    input.click();
    closePicker();
};

/* ── Upload media via server ──────────────────────────────── */

async function uploadMediaMessage(file, mediaType) {
    const user = auth.currentUser;
    if (!user || !currentChat) { alert('Choose a user to message first.'); return; }
    if (!file) return;

    /* Optimistic WebRTC transfer for images/video/audio during an active call */
    if (dataChannel?.readyState === 'open' && mediaType !== 'document') {
        sendFileViaDataChannel(file, mediaType);
    }

    try {
        const form = new FormData();
        form.append('mediaFile', file);
        form.append('chatId',    currentChat);
        form.append('senderId',  user.uid);

        const res  = await fetch(UPLOAD_URL, { method: 'POST', body: form });
        const json = await res.json();

        if (!res.ok) throw new Error(json.error || 'Upload failed');

        const me = usersCache[user.uid] || {};
        const msg = {
            senderEmail: user.email,
            senderId:    user.uid,
            senderName:  getDisplayName(me),
            receiverId:  currentPeerId,
            seen:        false,
            time:        Date.now(),
            mediaType:   json.mediaType,
            mediaUrl:    json.fileUrl,
            fileName:    file.name
        };
        if (json.mediaType === 'images') msg.image = json.fileUrl;

        await db.ref(`messages/${currentChat}`).push(msg);

    } catch (err) {
        console.error('[uploadMediaMessage]', err);
        alert('Upload error: ' + err.message);
    }
}

window.sendMediaFromButton = function () {
    const file = document.getElementById('mediaFile').files[0];
    if (file) uploadMediaMessage(file, currentMediaType);
};

/* ── Profile photo preview ────────────────────────────────── */

function previewSelectedProfilePhoto(file) {
    const input = document.getElementById('profilePhoto');
    const err   = validateProfilePhoto(file);
    if (err) {
        if (input) input.value = '';
        setProfileUploadStatus(err, 'error');
        return;
    }
    if (!file) { setProfileUploadStatus(''); return; }

    const reader = new FileReader();
    reader.onload = e => {
        setImage(document.getElementById('profilePreview'), e.target.result);
        setProfileUploadStatus('Photo selected — save profile to upload.');
    };
    reader.readAsDataURL(file);
}

/* ── Save profile via server ──────────────────────────────── */

window.saveProfile = async function () {
    const user = auth.currentUser;
    if (!user) return;

    const name   = document.getElementById('profileName').value.trim();
    const status = document.getElementById('profileStatus').value.trim();
    const file   = document.getElementById('profilePhoto').files[0];
    const btn    = document.querySelector('.profile-panel button');

    const photoErr = validateProfilePhoto(file);
    if (photoErr) { setProfileUploadStatus(photoErr, 'error'); return; }

    if (btn) { btn.disabled = true; btn.textContent = file ? 'Uploading…' : 'Saving…'; }
    setProfileUploadStatus(file ? 'Uploading profile photo…' : 'Saving profile…');

    try {
        const form = new FormData();
        form.append('userId',   user.uid);
        form.append('username', name || user.email);
        form.append('status',   status);
        form.append('email',    user.email);
        if (file) form.append('photo', file);

        const res  = await fetch(UPLOAD_PROFILE_URL, { method: 'POST', body: form });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Save failed');

        /* Update Firebase Auth profile (display name + photo) */
        const authUpdate = { displayName: name || user.email };
        if (json.profile?.photo) {
            authUpdate.photoURL = json.profile.photo;
            setImage(document.getElementById('profilePreview'), json.profile.photo);
        }
        if (user.updateProfile) await user.updateProfile(authUpdate);

        document.getElementById('profilePhoto').value = '';

        /* Refresh local cache */
        const snap = await db.ref(`users/${user.uid}`).once('value');
        if (snap.exists()) {
            usersCache[user.uid] = snap.val();
            if (currentPeerId) updateChatHeader(usersCache[currentPeerId]);
        }

        setProfileUploadStatus('Profile saved.', 'success');

    } catch (err) {
        console.error('[saveProfile]', err);
        setProfileUploadStatus('Error: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save profile'; }
    }
};

/* ── Chat header ──────────────────────────────────────────── */

function updateChatHeader(peer) {
    const name   = document.getElementById('activeChatName');
    const status = document.getElementById('activeChatStatus');
    const photo  = document.getElementById('activeChatPhoto');

    if (!peer) {
        name.textContent   = 'Choose someone to chat';
        status.textContent = 'Select a user from the people list.';
        setImage(photo, '');
        return;
    }
    name.textContent   = getDisplayName(peer);
    status.textContent = peer.online ? 'Online' : (peer.status || 'Offline');
    setImage(photo, peer.photo);
}

/* ── Message rendering ────────────────────────────────────── */

function renderMessage(snapshot) {
    const data = snapshot.val();
    if (!data) return;

    const msg    = document.createElement('div');
    const isMine = auth.currentUser && data.senderId === auth.currentUser.uid;
    msg.className  = isMine ? 'message mine' : 'message theirs';
    msg.dataset.id = snapshot.key;

    const meta = document.createElement('div');
    meta.className   = 'message-meta';
    meta.textContent = data.senderName || data.senderEmail || 'Unknown';
    msg.appendChild(meta);

    if (data.image) {
        const img = document.createElement('img');
        img.src = data.image; img.alt = 'Photo'; img.className = 'message-photo';
        msg.appendChild(img);

    } else if (data.mediaType === 'videos' && data.mediaUrl) {
        const vid = document.createElement('video');
        vid.src = data.mediaUrl; vid.controls = true; vid.className = 'message-media';
        msg.appendChild(vid);

    } else if (data.mediaType === 'voice' && data.mediaUrl) {
        const aud = document.createElement('audio');
        aud.src = data.mediaUrl; aud.controls = true; aud.className = 'message-media';
        msg.appendChild(aud);

    } else if (data.mediaType === 'documents' && data.mediaUrl) {
        const link = document.createElement('a');
        link.href = data.mediaUrl;
        link.textContent = '📄 ' + (data.fileName || 'Document');
        link.target = '_blank'; link.className = 'message-link';
        msg.appendChild(link);

    } else {
        const txt = document.createElement('div');
        txt.textContent = data.text || '';
        msg.appendChild(txt);
    }

    if (data.seen && isMine) {
        const seen = document.createElement('span');
        seen.className = 'seen'; seen.textContent = 'Seen';
        msg.appendChild(seen);
    }

    chatBox.appendChild(msg);
    chatBox.scrollTop = chatBox.scrollHeight;
}

/* ── Typing indicator ─────────────────────────────────────── */

function listenToTyping(chatId, peerId) {
    currentTypingRef?.off();
    const indicator   = document.getElementById('typingIndicator');
    currentTypingRef  = db.ref(`typing/${chatId}/${peerId}`);
    currentTypingRef.on('value', snap => {
        indicator.textContent = snap.exists() ? 'Typing…' : '';
    });
}

/* ── Open chat ────────────────────────────────────────────── */

function listenToChat(chatId, peerId) {
    currentMessagesRef?.off();
    chatBox.innerHTML = '';
    currentChat       = chatId;
    currentPeerId     = peerId;
    currentMessagesRef = db.ref(`messages/${chatId}`);

    currentMessagesRef.orderByChild('time').on('child_added', snap => {
        renderMessage(snap);
        const d = snap.val();
        if (d && auth.currentUser && d.senderId !== auth.currentUser.uid) {
            snap.ref.update({ seen: true });
        }
    });

    listenToTyping(chatId, peerId);
}

function openChat(userId) {
    const user = auth.currentUser;
    if (!user || user.uid === userId) return;
    updateChatHeader(usersCache[userId]);
    listenToChat(getChatId(user.uid, userId), userId);

    /* Mark active in user list */
    document.querySelectorAll('#user-list .user').forEach(el => {
        el.classList.toggle('active', el.dataset.uid === userId);
    });
}

/* ── Render users ─────────────────────────────────────────── */

window.filterUsers = function () {
    const q = document.getElementById('userSearch').value.toLowerCase();
    document.querySelectorAll('#user-list .user').forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
};

function renderUsers() {
    const user = auth.currentUser;
    userList.innerHTML = '';

    Object.keys(usersCache).forEach(uid => {
        if (user && uid === user.uid) return;
        const p   = usersCache[uid];
        const row = document.createElement('button');
        row.className    = 'user' + (uid === currentPeerId ? ' active' : '');
        row.type         = 'button';
        row.dataset.uid  = uid;
        row.onclick      = () => openChat(uid);

        row.innerHTML = `
            <img class="avatar" src="${escapeHtml(p.photo || fallbackAvatar)}" alt="">
            <span>
                <strong>${escapeHtml(getDisplayName(p))}</strong>
                <small>${p.online ? 'Online' : escapeHtml(p.status || 'Offline')}</small>
            </span>`;
        if (!p.online) row.classList.add('offline');
        userList.appendChild(row);
    });

    if (!userList.children.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'No other users yet.';
        userList.appendChild(empty);
    }

    renderCallHistory(lastRenderedCallHistory);
}

/* ── Load my profile ──────────────────────────────────────── */

function loadMyProfile(user) {
    db.ref(`users/${user.uid}`).once('value').then(snap => {
        const p = snap.val() || {};
        const nameEl   = document.getElementById('profileName');
        const statusEl = document.getElementById('profileStatus');
        if (nameEl)   nameEl.value   = p.username || '';
        if (statusEl) statusEl.value = p.status   || '';
        setImage(document.getElementById('profilePreview'), p.photo || user.photoURL);
        setProfileUploadStatus('');
    });
}

/* ── Auth state ───────────────────────────────────────────── */

auth.onAuthStateChanged(user => {
    if (!user) { window.location = 'login.html'; return; }

    db.ref(`users/${user.uid}`).update({ email: user.email, online: true, lastSeen: Date.now() });
    db.ref(`users/${user.uid}`).onDisconnect().update({ online: false, lastSeen: Date.now() });

    loadMyProfile(user);
    listenToCallHistory(user);
    listenForIncomingCalls(user);
});

db.ref('users').on('value', snap => {
    usersCache = snap.val() || {};
    renderUsers();
    if (currentPeerId) updateChatHeader(usersCache[currentPeerId]);
});

/* ── Send text message ────────────────────────────────────── */

window.sendMessage = function () {
    const input = document.getElementById('message');
    const user  = auth.currentUser;
    if (!user || !currentChat) { alert('Choose a user to message first.'); return; }
    if (!input?.value.trim()) return;

    const me = usersCache[user.uid] || {};
    db.ref(`messages/${currentChat}`).push({
        text:        input.value.trim(),
        senderEmail: user.email,
        senderId:    user.uid,
        senderName:  getDisplayName(me),
        receiverId:  currentPeerId,
        seen:        false,
        time:        Date.now()
    });

    input.value = '';
    db.ref(`typing/${currentChat}/${user.uid}`).remove();
};

window.handleMessageKey = function (e) {
    if (e.key === 'Enter') sendMessage();
};

window.typing = function () {
    const user = auth.currentUser;
    if (!user || !currentChat) return;
    const ref = db.ref(`typing/${currentChat}/${user.uid}`);
    ref.set(true);
    setTimeout(() => ref.remove(), 2000);
};

/* ── Call history ─────────────────────────────────────────── */

function isTerminal(status) { return TERMINAL_STATUSES.includes(status); }

function getCallPeerId(call, uid) {
    return call?.callerId === uid ? call.receiverId : call.callerId;
}

function getCallStatusLabel(call) {
    if (!call) return 'Call';
    const labels = { missed: 'Missed', declined: 'Declined', cancelled: 'Cancelled', failed: 'Failed' };
    if (labels[call.status]) return labels[call.status] + ' call';
    return call.mode === 'audio' ? 'Audio call' : 'Video call';
}

function formatCallTime(ts) {
    if (!ts) return '';
    const d = new Date(ts), today = new Date();
    return d.toLocaleString([], {
        month:  d.toDateString() === today.toDateString() ? undefined : 'short',
        day:    d.toDateString() === today.toDateString() ? undefined : 'numeric',
        hour:   '2-digit', minute: '2-digit'
    });
}

function renderCallHistory(calls) {
    if (!callList) return;
    const user = auth.currentUser;
    callList.innerHTML = '';
    if (!calls?.length) {
        const p = document.createElement('p');
        p.className = 'empty-state'; p.textContent = 'No calls yet.';
        callList.appendChild(p); return;
    }
    calls.forEach(call => {
        const peerId = call.peerId || getCallPeerId(call, user?.uid);
        const row    = document.createElement('button');
        row.type      = 'button';
        row.className = 'call-row' + (call.status === 'missed' ? ' missed' : '');
        row.onclick   = () => peerId && openChat(peerId);
        row.innerHTML = `
            <span class="call-icon">${call.direction === 'outgoing' ? '↗' : '↙'}</span>
            <span>
                <strong>${escapeHtml(getDisplayName(usersCache[peerId]))}</strong>
                <small>${escapeHtml(getCallStatusLabel(call))} · ${call.direction === 'outgoing' ? 'Out' : 'In'} · ${escapeHtml(formatCallTime(call.time || call.startedAt))}</small>
            </span>`;
        callList.appendChild(row);
    });
}

function listenToCallHistory(user) {
    callHistoryRef?.off();
    callHistoryRef = db.ref(`callHistory/${user.uid}`);
    callHistoryRef.orderByChild('time').limitToLast(30).on('value', snap => {
        const calls = [];
        snap.forEach(c => calls.push({ callId: c.key, ...c.val() }));
        lastRenderedCallHistory = calls.reverse();
        renderCallHistory(lastRenderedCallHistory);
    });
}

async function saveCallHistory(callId, call) {
    if (!call?.callerId || !call?.receiverId || !isTerminal(call.status)) return;
    const endedAt = call.endedAt || Date.now();
    const base = {
        callId, callerId: call.callerId, receiverId: call.receiverId,
        mode: call.mode || 'video', status: call.status,
        startedAt: call.startedAt || endedAt, answeredAt: call.answeredAt || null,
        endedAt, time: endedAt
    };
    await db.ref().update({
        [`callHistory/${call.callerId}/${callId}`]: { ...base, direction: 'outgoing', peerId: call.receiverId },
        [`callHistory/${call.receiverId}/${callId}`]: { ...base, direction: 'incoming', peerId: call.callerId }
    });
}

/* ── Call UI helpers ──────────────────────────────────────── */

function setCallStatus(msg) {
    const el = document.getElementById('callStatus');
    if (el) el.textContent = msg || '';
}
function showCallPanel(show) {
    const el = document.getElementById('callPanel');
    if (el) el.hidden = !show;
}
function showAnswerButton(show) {
    const el = document.getElementById('answerCallBtn');
    if (el) el.hidden = !show;
}
function setEndCallLabel(label) {
    const el = document.getElementById('endCallBtn');
    if (el) el.textContent = label || 'End';
}
function getCallLabel(uid) { return getDisplayName(usersCache[uid]) || 'Someone'; }

/* ── Media / peer helpers ─────────────────────────────────── */

function stopLocalStream() {
    localStream?.getTracks().forEach(t => t.stop());
    localStream = null;
}

function clearCallMedia() {
    const lv = document.getElementById('localVideo');
    const rv = document.getElementById('remoteVideo');
    if (lv) lv.srcObject = null;
    if (rv) rv.srcObject = null;
}

function detachCallListeners() {
    if (currentCallRef  && callValueRef)     currentCallRef.off('value', callValueRef);
    if (peerCandidateRef && callCandidatesRef) peerCandidateRef.off('child_added', callCandidatesRef);
    callValueRef = callCandidatesRef = peerCandidateRef = null;
}

function clearMissedCallTimer() {
    if (missedCallTimer) { clearTimeout(missedCallTimer); missedCallTimer = null; }
}

function resetCallState() {
    detachCallListeners();
    clearMissedCallTimer();
    if (peerConnection) {
        peerConnection.onicecandidate = peerConnection.ontrack = null;
        peerConnection.close();
        peerConnection = null;
    }
    stopLocalStream();
    clearCallMedia();
    showAnswerButton(false);
    setEndCallLabel('End');
    showCallPanel(false);
    setCallStatus('');
    currentCallId = currentCallRef = incomingCallData = null;
    pendingIceCandidates = [];
}

function flushPendingIceCandidates() {
    if (!peerConnection?.remoteDescription) return;
    pendingIceCandidates.forEach(c =>
        peerConnection.addIceCandidate(c).catch(e => console.warn('ICE flush', e))
    );
    pendingIceCandidates = [];
}

function startMissedCallTimer(callId, ref) {
    clearMissedCallTimer();
    missedCallTimer = setTimeout(() => {
        ref.once('value').then(snap => {
            const c = snap.val();
            if (c?.status === 'ringing') {
                ref.update({ status: 'missed', missedBy: c.receiverId, endedAt: Date.now() });
            }
        });
    }, CALL_RING_TIMEOUT);
}

async function startLocalMedia(mode) {
    localStream = await navigator.mediaDevices.getUserMedia({
        audio: true, video: mode === 'video'
    });
    document.getElementById('localVideo').srcObject = localStream;
    return localStream;
}

/* ── WebRTC peer setup ────────────────────────────────────── */

function createCallPeer(callId, peerId, isOfferer) {
    peerConnection = new RTCPeerConnection(servers);

    peerConnection.ontrack = e => {
        const rv = document.getElementById('remoteVideo');
        if (rv) rv.srcObject = e.streams[0];
    };

    peerConnection.onicecandidate = e => {
        if (e.candidate && auth.currentUser) {
            db.ref(`calls/${callId}/candidates/${auth.currentUser.uid}`).push(e.candidate.toJSON());
        }
    };

    if (isOfferer) {
        dataChannel = peerConnection.createDataChannel('file-transfer');
        setupDataChannel();
    } else {
        peerConnection.ondatachannel = e => { dataChannel = e.channel; setupDataChannel(); };
    }

    localStream?.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

    peerCandidateRef = db.ref(`calls/${callId}/candidates/${peerId}`);
    callCandidatesRef = peerCandidateRef.on('child_added', snap => {
        const c = snap.val();
        if (!c || !peerConnection) return;
        const ice = new RTCIceCandidate(c);
        peerConnection.remoteDescription
            ? peerConnection.addIceCandidate(ice).catch(e => console.warn('ICE add', e))
            : pendingIceCandidates.push(ice);
    });

    return peerConnection;
}

/* ── Data channel (in-call file sharing) ─────────────────── */

function setupDataChannel() {
    if (!dataChannel) return;
    dataChannel.binaryType = 'arraybuffer';
    dataChannel.onopen    = () => setCallStatus('Connected — media sharing enabled.');
    dataChannel.onmessage = e => handleDataChannelMessage(e.data);
    dataChannel.onclose   = () => console.log('Data channel closed');
    dataChannel.onerror   = e => console.error('Data channel error', e);
}

function handleDataChannelMessage(data) {
    if (typeof data === 'string') {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }

        if (msg.type === 'file-meta') {
            receivingFileMeta     = msg;
            receivingFileTransfer = { chunks: [], receivedSize: 0 };
            setCallStatus(`Receiving ${msg.mediaType}: ${msg.fileName}…`);
            return;
        }
        if (msg.type === 'file-complete' && receivingFileMeta?.fileId === msg.fileId) {
            const blob = new Blob(receivingFileTransfer.chunks, { type: receivingFileMeta.mimeType });
            renderReceivedCallMedia(receivingFileMeta, URL.createObjectURL(blob));
            receivingFileMeta = receivingFileTransfer = null;
            setCallStatus('Media received.');
        }
        return;
    }
    if (receivingFileTransfer && data instanceof ArrayBuffer) {
        receivingFileTransfer.chunks.push(data);
        receivingFileTransfer.receivedSize += data.byteLength;
        const pct = Math.floor(receivingFileTransfer.receivedSize / receivingFileMeta.size * 100);
        setCallStatus(`Receiving ${receivingFileMeta.mediaType}: ${pct}%`);
    }
}

function renderReceivedCallMedia(meta, url) {
    const msg = document.createElement('div');
    msg.className = 'message theirs';
    const m = document.createElement('div');
    m.className   = 'message-meta';
    m.textContent = `Received ${meta.mediaType} via call`;
    msg.appendChild(m);

    if (meta.mediaType === 'image') {
        const img = document.createElement('img');
        img.src = url; img.alt = meta.fileName; img.className = 'message-photo';
        msg.appendChild(img);
    } else if (meta.mediaType === 'video') {
        const vid = document.createElement('video');
        vid.src = url; vid.controls = true; vid.className = 'message-media';
        msg.appendChild(vid);
    } else if (meta.mediaType === 'audio') {
        const aud = document.createElement('audio');
        aud.src = url; aud.controls = true; aud.className = 'message-media';
        msg.appendChild(aud);
    }
    chatBox.appendChild(msg);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function sendFileViaDataChannel(file, mediaType) {
    if (dataChannel?.readyState !== 'open') return;
    const fileId      = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
    const totalChunks = Math.ceil(file.size / FILE_CHUNK_SIZE);

    dataChannel.send(JSON.stringify({
        type: 'file-meta', fileId, fileName: file.name, mediaType,
        size: file.size, mimeType: file.type, totalChunks,
        senderId: auth.currentUser?.uid || ''
    }));

    let offset = 0;
    const reader = new FileReader();
    reader.onload = () => {
        dataChannel.send(reader.result);
        offset += reader.result.byteLength;
        if (offset < file.size) {
            reader.readAsArrayBuffer(file.slice(offset, offset + FILE_CHUNK_SIZE));
        } else {
            dataChannel.send(JSON.stringify({ type: 'file-complete', fileId }));
        }
    };
    reader.readAsArrayBuffer(file.slice(0, FILE_CHUNK_SIZE));
}

/* ── Watch active call ────────────────────────────────────── */

function watchCurrentCall(callId) {
    currentCallRef = db.ref(`calls/${callId}`);
    callValueRef   = currentCallRef.on('value', async snap => {
        const call = snap.val();
        if (!call) { resetCallState(); return; }
        if (isTerminal(call.status)) {
            await saveCallHistory(callId, call).catch(console.error);
            resetCallState(); return;
        }
        if (call.answer && peerConnection && !peerConnection.currentRemoteDescription) {
            try {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(call.answer));
                flushPendingIceCandidates();
                clearMissedCallTimer();
                setCallStatus('Connected');
            } catch (e) { console.error('setRemoteDescription', e); }
        }
    });
}

/* ── Start call ───────────────────────────────────────────── */

window.startCall = async function (mode) {
    const user = auth.currentUser;
    if (!user || !currentPeerId) { alert('Choose a user to call first.'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { alert('Camera/microphone not supported.'); return; }

    resetCallState();
    currentCallMode = mode === 'audio' ? 'audio' : 'video';
    currentCallRef  = db.ref('calls').push();
    currentCallId   = currentCallRef.key;

    showCallPanel(true);
    setEndCallLabel('End');
    setCallStatus(`Calling ${getCallLabel(currentPeerId)}…`);

    try {
        await currentCallRef.update({
            callerId: user.uid, receiverId: currentPeerId,
            chatId: getChatId(user.uid, currentPeerId),
            mode: currentCallMode, status: 'starting', startedAt: Date.now()
        });

        await startLocalMedia(currentCallMode);
        createCallPeer(currentCallId, currentPeerId, true);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        await currentCallRef.update({
            callerId: user.uid, receiverId: currentPeerId,
            chatId: getChatId(user.uid, currentPeerId),
            mode: currentCallMode, status: 'ringing', startedAt: Date.now(),
            offer: { type: offer.type, sdp: offer.sdp }
        });

        startMissedCallTimer(currentCallId, currentCallRef);
        watchCurrentCall(currentCallId);

    } catch (err) {
        console.error('[startCall]', err);
        alert('Could not start call: ' + err.message);
        currentCallRef?.update({ status: 'failed', endedAt: Date.now() });
        resetCallState();
    }
};

/* ── Answer call ──────────────────────────────────────────── */

window.answerCall = async function () {
    const user = auth.currentUser;
    const call = incomingCallData;
    if (!user || !call || !currentCallId || !currentCallRef) return;
    if (!navigator.mediaDevices?.getUserMedia) { alert('Camera/microphone not supported.'); return; }

    showAnswerButton(false);
    setEndCallLabel('End');
    setCallStatus('Connecting…');

    try {
        await startLocalMedia(call.mode || 'video');
        createCallPeer(currentCallId, call.callerId, false);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(call.offer));
        flushPendingIceCandidates();
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        await currentCallRef.update({
            status: 'active', answeredAt: Date.now(),
            answer: { type: answer.type, sdp: answer.sdp }
        });
        watchCurrentCall(currentCallId);
        clearMissedCallTimer();
        setCallStatus('Connected');
    } catch (err) {
        console.error('[answerCall]', err);
        alert('Could not answer call: ' + err.message);
        await currentCallRef.update({ status: 'failed', endedAt: Date.now() });
        resetCallState();
    }
};

/* ── End call ─────────────────────────────────────────────── */

window.endCall = async function () {
    if (currentCallRef) {
        const user = auth.currentUser;
        const snap = await currentCallRef.once('value');
        const call = snap.val() || {};
        let status = 'ended';
        if (call.status === 'ringing') {
            status = user && call.receiverId === user.uid ? 'declined' : 'cancelled';
        }
        currentCallRef.update({ status, endedBy: user?.uid || null, endedAt: Date.now() })
            .finally(resetCallState);
        return;
    }
    resetCallState();
};

/* ── Incoming call listener ───────────────────────────────── */

function handleIncomingCallSnapshot(snap) {
    const call = snap.val();
    if (!call || call.status !== 'ringing' || currentCallId) return;
    if (call.startedAt && Date.now() - call.startedAt > CALL_RING_TIMEOUT) {
        snap.ref.update({ status: 'missed', missedBy: call.receiverId, endedAt: Date.now() });
        return;
    }
    currentCallId    = snap.key;
    currentCallRef   = snap.ref;
    incomingCallData = call;
    currentCallMode  = call.mode || 'video';
    showCallPanel(true);
    showAnswerButton(true);
    setEndCallLabel('Decline');
    setCallStatus(`Incoming ${currentCallMode} call from ${getCallLabel(call.callerId)}`);
    startMissedCallTimer(currentCallId, currentCallRef);
}

function listenForIncomingCalls(user) {
    const q = db.ref('calls').orderByChild('receiverId').equalTo(user.uid);
    q.on('child_added',   snap => handleIncomingCallSnapshot(snap));
    q.on('child_changed', snap => {
        handleIncomingCallSnapshot(snap);
        const call = snap.val();
        if (snap.key === currentCallId && call && isTerminal(call.status)) {
            saveCallHistory(snap.key, call).catch(console.error);
            resetCallState();
        }
    });
}

/* ── Logout ───────────────────────────────────────────────── */

window.logout = async function () {
    const user = firebase.auth().currentUser;
    if (user) await db.ref(`users/${user.uid}`).update({ online: false, lastSeen: Date.now() });
    firebase.auth().signOut()
        .then(() => { window.location = 'login.html'; })
        .catch(console.error);
};