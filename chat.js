let currentChat = null;
let currentPeerId = null;
let currentMessagesRef = null;
let currentTypingRef = null;
let usersCache = {};
let currentMediaType = null;
const maxProfilePhotoSize = 5 * 1024 * 1024;

// Initialize media file input listener
window.addEventListener("load", function(){
    const mediaFileInput = document.getElementById("mediaFile");
    if(mediaFileInput){
        mediaFileInput.addEventListener("change", function(){
            if(this.files[0] && currentMediaType){
                uploadMediaMessage(this.files[0], currentMediaType);
                this.value = "";
            }
        });
    }

    const profilePhotoInput = document.getElementById("profilePhoto");
    if(profilePhotoInput){
        profilePhotoInput.addEventListener("change", function(){
            previewSelectedProfilePhoto(this.files[0]);
        });
    }
});

function toggleMediaPicker(){
    const picker = document.getElementById("mediaPicker");
    picker.hidden = !picker.hidden;
}

function closePicker(){
    const picker = document.getElementById("mediaPicker");
    picker.hidden = true;
}

function pickMediaType(type){
    currentMediaType = type;
    const input = document.getElementById("mediaFile");
    
    let accept = "image/*";
    if(type === "video") accept = "video/*";
    else if(type === "audio") accept = "audio/*";
    else if(type === "document") accept = ".pdf,.doc,.docx,.txt,.xlsx,.zip";
    
    input.accept = accept;
    input.click();
}

function uploadMediaMessage(file, mediaType){
    const user = auth.currentUser;

    if(!user || !currentChat){
        alert("Choose a user to message first.");
        return;
    }

    if(!file) return;

    const timestamp = Date.now();
    const folderMap = {
        "image": "images",
        "video": "videos",
        "audio": "voice",
        "document": "documents"
    };
    const folder = folderMap[mediaType] || "files";
    const storageRef = storage.ref("media/" + currentChat + "/" + folder + "/" + timestamp + "_" + file.name);
    const me = usersCache[user.uid] || {};

    storageRef.put(file)
        .then(()=> storageRef.getDownloadURL())
        .then((url)=>{
            const messageData = {
                senderEmail: user.email,
                senderId: user.uid,
                senderName: getDisplayName(me),
                receiverId: currentPeerId,
                seen: false,
                time: timestamp,
                mediaType: mediaType,
                mediaUrl: url,
                fileName: file.name
            };

            if(mediaType === "image"){
                messageData.image = url;
            }

            return db.ref("messages/" + currentChat).push(messageData);
        })
        .then(()=>{
            closePicker();
            document.getElementById("mediaFile").value = "";
        })
        .catch((error)=>{
            console.error("uploadMediaMessage error:", error);
            alert("Error uploading media: " + error.message);
        });
}

const chatBox = document.getElementById("chat-box");
const userList = document.getElementById("user-list");
const callList = document.getElementById("call-list");
const auth = firebase.auth();
const storage = firebase.storage();

const fallbackAvatar =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' fill='%23dfe7e4'/%3E%3Ccircle cx='48' cy='35' r='18' fill='%23728a84'/%3E%3Cpath d='M18 88c4-18 18-29 30-29s26 11 30 29' fill='%23728a84'/%3E%3C/svg%3E";

function getChatId(user1, user2){
    return user1 < user2 ? user1 + "_" + user2 : user2 + "_" + user1;
}

function escapeHtml(value){
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getDisplayName(user){
    if(!user) return "Unknown user";
    return user.username || user.displayName || user.email || "Unknown user";
}

function setImage(element, src){
    if(!element) return;
    element.src = src || fallbackAvatar;
}

function setProfileUploadStatus(message, type){
    const status = document.getElementById("profileUploadStatus");
    if(!status) return;

    status.textContent = message || "";
    status.className = "profile-upload-status" + (type ? " " + type : "");
}

function validateProfilePhoto(file){
    if(!file) return "";

    if(!file.type || !file.type.startsWith("image/")){
        return "Please choose an image file.";
    }

    if(file.size > maxProfilePhotoSize){
        return "Choose an image smaller than 5 MB.";
    }

    return "";
}

function previewSelectedProfilePhoto(file){
    const input = document.getElementById("profilePhoto");
    const error = validateProfilePhoto(file);

    if(error){
        if(input) input.value = "";
        setProfileUploadStatus(error, "error");
        return;
    }

    if(!file){
        setProfileUploadStatus("");
        return;
    }

    const reader = new FileReader();
    reader.onload = function(event){
        setImage(document.getElementById("profilePreview"), event.target.result);
        setProfileUploadStatus("New photo selected. Save profile to upload it.");
    };
    reader.readAsDataURL(file);
}

function updateChatHeader(peer){
    const name = document.getElementById("activeChatName");
    const status = document.getElementById("activeChatStatus");
    const photo = document.getElementById("activeChatPhoto");

    if(!peer){
        name.textContent = "Choose someone to chat";
        status.textContent = "Select a user from the people list.";
        setImage(photo, "");
        return;
    }

    name.textContent = getDisplayName(peer);
    status.textContent = peer.online ? "Online" : (peer.status || "Offline");
    setImage(photo, peer.photo);
}

function renderMessage(snapshot){
    const data = snapshot.val();
    if(!data) return;

    const message = document.createElement("div");
    const isMine = auth.currentUser && data.senderId === auth.currentUser.uid;
    const sender = escapeHtml(data.senderName || data.senderEmail || "Unknown");

    message.className = isMine ? "message mine" : "message theirs";
    message.dataset.id = snapshot.key;

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.innerHTML = `<strong>${sender}</strong>`;
    message.appendChild(meta);

    if(data.image){
        const image = document.createElement("img");
        image.src = data.image;
        image.alt = "Uploaded photo";
        image.className = "message-photo";
        message.appendChild(image);
    } else if(data.mediaType === "video" && data.mediaUrl){
        const video = document.createElement("video");
        video.src = data.mediaUrl;
        video.controls = true;
        video.className = "message-media";
        video.style.maxWidth = "260px";
        message.appendChild(video);
    } else if(data.mediaType === "audio" && data.mediaUrl){
        const audio = document.createElement("audio");
        audio.src = data.mediaUrl;
        audio.controls = true;
        audio.className = "message-media";
        message.appendChild(audio);
    } else if(data.mediaType === "document" && data.mediaUrl){
        const link = document.createElement("a");
        link.href = data.mediaUrl;
        link.textContent = "📄 " + (data.fileName || "Document");
        link.target = "_blank";
        link.className = "message-link";
        message.appendChild(link);
    } else {
        const text = document.createElement("div");
        text.textContent = data.text || "";
        message.appendChild(text);
    }

    if(data.seen && isMine){
        const seen = document.createElement("span");
        seen.className = "seen";
        seen.textContent = "Seen";
        message.appendChild(seen);
    }

    chatBox.appendChild(message);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function listenToTyping(chatId, peerId){
    if(currentTypingRef){
        currentTypingRef.off();
    }

    const indicator = document.getElementById("typingIndicator");
    currentTypingRef = db.ref("typing/" + chatId + "/" + peerId);

    currentTypingRef.on("value", (snapshot)=>{
        indicator.textContent = snapshot.exists() ? "Typing..." : "";
    });
}

function listenToChat(chatId, peerId){
    if(currentMessagesRef){
        currentMessagesRef.off();
    }

    chatBox.innerHTML = "";
    currentChat = chatId;
    currentPeerId = peerId;
    currentMessagesRef = db.ref("messages/" + chatId);

    currentMessagesRef.orderByChild("time").on("child_added", (snapshot)=>{
        const data = snapshot.val();
        renderMessage(snapshot);

        if(data && auth.currentUser && data.senderId !== auth.currentUser.uid){
            snapshot.ref.update({ seen: true });
        }
    });

    listenToTyping(chatId, peerId);
}

function openChat(userId){
    const user = auth.currentUser;
    if(!user || user.uid === userId) return;

    const peer = usersCache[userId];
    updateChatHeader(peer);
    listenToChat(getChatId(user.uid, userId), userId);
}

function filterUsers(){
    const search = document.getElementById("userSearch").value.toLowerCase();
    document.querySelectorAll("#user-list .user").forEach((row)=>{
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(search) ? "" : "none";
    });
}

function renderUsers(){
    const user = auth.currentUser;
    userList.innerHTML = "";

    Object.keys(usersCache).forEach((uid)=>{
        if(user && uid === user.uid) return;

        const profile = usersCache[uid];
        const row = document.createElement("button");
        row.className = uid === currentPeerId ? "user active" : "user";
        row.type = "button";
        row.onclick = () => openChat(uid);

        row.innerHTML = `
            <img class="avatar" src="${escapeHtml(profile.photo || fallbackAvatar)}" alt="">
            <span>
                <strong>${escapeHtml(getDisplayName(profile))}</strong>
                <small>${profile.online ? "Online" : escapeHtml(profile.status || "Offline")}</small>
            </span>
        `;

        userList.appendChild(row);
    });

    if(!userList.children.length){
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No other users yet.";
        userList.appendChild(empty);
    }

    renderCallHistory(lastRenderedCallHistory);
}

function loadMyProfile(user){
    db.ref("users/" + user.uid).once("value").then((snapshot)=>{
        const profile = snapshot.val() || {};
        document.getElementById("profileName").value = profile.username || "";
        document.getElementById("profileStatus").value = profile.status || "";
        setImage(document.getElementById("profilePreview"), profile.photo || user.photoURL);
        setProfileUploadStatus("");
    });
}

auth.onAuthStateChanged((user)=>{
    if(!user){
        window.location = "login.html";
        return;
    }

    const userStatus = db.ref("users/" + user.uid);

    userStatus.update({
        email: user.email,
        online: true,
        lastSeen: Date.now()
    });

    userStatus.onDisconnect().update({
        online: false,
        lastSeen: Date.now()
    });

    loadMyProfile(user);
    listenToCallHistory(user);
    listenForIncomingCalls(user);
});

db.ref("users").on("value", (snapshot)=>{
    usersCache = snapshot.val() || {};
    renderUsers();

    if(currentPeerId){
        updateChatHeader(usersCache[currentPeerId]);
    }
});

window.saveProfile = function(){
    const user = auth.currentUser;
    if(!user) return;

    const name = document.getElementById("profileName").value.trim();
    const status = document.getElementById("profileStatus").value.trim();
    const file = document.getElementById("profilePhoto").files[0];
    const saveButton = document.querySelector(".profile-panel button");
    const photoError = validateProfilePhoto(file);

    if(photoError){
        setProfileUploadStatus(photoError, "error");
        return;
    }

    if(saveButton){
        saveButton.disabled = true;
        saveButton.textContent = file ? "Uploading..." : "Saving...";
    }

    setProfileUploadStatus(file ? "Uploading profile photo..." : "Saving profile...");

    const updates = {
        username: name || user.email,
        status: status,
        email: user.email,
        online: true,
        lastSeen: Date.now()
    };

    const saveUpdates = (photoUrl)=>{
        if(photoUrl){
            updates.photo = photoUrl;
        }

        const authUpdates = {
            displayName: updates.username
        };

        if(photoUrl){
            authUpdates.photoURL = photoUrl;
        }

        const authProfileUpdate = user.updateProfile ? user.updateProfile(authUpdates) : Promise.resolve();

        return Promise.all([
            db.ref("users/" + user.uid).update(updates),
            authProfileUpdate
        ]).then(()=>{
            if(photoUrl){
                setImage(document.getElementById("profilePreview"), photoUrl);
            }
            document.getElementById("profilePhoto").value = "";
            
            // Refresh user cache to show updates in chat header
            db.ref("users/" + user.uid).once("value").then((snapshot)=>{
                if(snapshot.exists()){
                    usersCache[user.uid] = snapshot.val();
                    if(currentPeerId){
                        updateChatHeader(usersCache[currentPeerId]);
                    }
                }
            });

            setProfileUploadStatus("Profile saved.", "success");
        });
    };

    if(!file){
        saveUpdates().catch((error)=>{
            console.error("Error saving profile:", error);
            setProfileUploadStatus("Error saving profile: " + error.message, "error");
        }).finally(()=>{
            if(saveButton){
                saveButton.disabled = false;
                saveButton.textContent = "Save profile";
            }
        });
        return;
    }

    const ref = storage.ref("profiles/" + user.uid + "/" + Date.now() + "_" + file.name);
    ref.put(file)
        .then(()=> ref.getDownloadURL())
        .then(saveUpdates)
        .catch((error)=>{
            console.error("Error uploading profile photo:", error);
            setProfileUploadStatus("Error uploading profile photo: " + error.message, "error");
        })
        .finally(()=>{
            if(saveButton){
                saveButton.disabled = false;
                saveButton.textContent = "Save profile";
            }
        });
};

window.sendMessage = function(){
    const input = document.getElementById("message");
    const user = auth.currentUser;

    if(!user || !currentChat){
        alert("Choose a user to message first.");
        return;
    }

    if(!input || input.value.trim() === "") return;

    const me = usersCache[user.uid] || {};

    db.ref("messages/" + currentChat).push({
        text: input.value.trim(),
        senderEmail: user.email,
        senderId: user.uid,
        senderName: getDisplayName(me),
        receiverId: currentPeerId,
        seen: false,
        time: Date.now()
    });

    input.value = "";
    db.ref("typing/" + currentChat + "/" + user.uid).remove();
};

window.handleMessageKey = function(event){
    if(event.key === "Enter"){
        sendMessage();
    }
};

window.uploadPhoto = function(){
    uploadMediaMessage(document.getElementById("mediaFile").files[0], "image");
};

window.sendMediaFromButton = function(){
    const input = document.getElementById("mediaFile");
    const file = input.files[0];
    if(file){
        uploadMediaMessage(file, currentMediaType);
    }
};

window.typing = function(){
    const user = auth.currentUser;
    if(!user || !currentChat) return;

    const typingRef = db.ref("typing/" + currentChat + "/" + user.uid);
    typingRef.set(true);

    setTimeout(()=>{
        typingRef.remove();
    }, 2000);
};

window.uploadProfilePic = function(file){
    const user = auth.currentUser;
    if(!file || !user) return;

    const ref = storage.ref("profiles/" + user.uid + "/" + Date.now() + "_" + file.name);

    ref.put(file)
        .then(()=> ref.getDownloadURL())
        .then((url)=>{
            setImage(document.getElementById("profilePreview"), url);
            return db.ref("users/" + user.uid).update({ photo: url });
        })
        .catch((error)=>{
            console.error("Error uploading profile pic:", error);
            alert("Error uploading profile photo: " + error.message);
        });
};

let localStream;
let peerConnection;
let currentCallId = null;
let currentCallRef = null;
let currentCallMode = "video";
let incomingCallData = null;
let peerCandidateRef = null;
let callValueRef = null;
let callCandidatesRef = null;
let pendingIceCandidates = [];
let callHistoryRef = null;
let missedCallTimer = null;
let lastRenderedCallHistory = [];

const CALL_RING_TIMEOUT_MS = 45000;
const terminalCallStatuses = ["ended", "declined", "missed", "cancelled", "failed"];

const servers = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

function setCallStatus(message){
    const status = document.getElementById("callStatus");
    if(status) status.textContent = message || "";
}

function showCallPanel(show){
    const panel = document.getElementById("callPanel");
    if(panel) panel.hidden = !show;
}

function showAnswerButton(show){
    const button = document.getElementById("answerCallBtn");
    if(button) button.hidden = !show;
}

function setEndCallLabel(label){
    const button = document.getElementById("endCallBtn");
    if(button) button.textContent = label || "End";
}

function getCallLabel(userId){
    const profile = usersCache[userId];
    return getDisplayName(profile) || "Someone";
}

function stopLocalStream(){
    if(localStream){
        localStream.getTracks().forEach((track)=> track.stop());
        localStream = null;
    }
}

function clearCallMedia(){
    const localVideo = document.getElementById("localVideo");
    const remoteVideo = document.getElementById("remoteVideo");

    if(localVideo) localVideo.srcObject = null;
    if(remoteVideo) remoteVideo.srcObject = null;
}

function detachCallListeners(){
    if(currentCallRef && callValueRef){
        currentCallRef.off("value", callValueRef);
    }

    if(peerCandidateRef && callCandidatesRef){
        peerCandidateRef.off("child_added", callCandidatesRef);
    }

    callValueRef = null;
    callCandidatesRef = null;
    peerCandidateRef = null;
}

function clearMissedCallTimer(){
    if(missedCallTimer){
        clearTimeout(missedCallTimer);
        missedCallTimer = null;
    }
}

function resetCallState(){
    detachCallListeners();
    clearMissedCallTimer();

    if(peerConnection){
        peerConnection.onicecandidate = null;
        peerConnection.ontrack = null;
        peerConnection.close();
        peerConnection = null;
    }

    stopLocalStream();
    clearCallMedia();
    showAnswerButton(false);
    setEndCallLabel("End");
    showCallPanel(false);
    setCallStatus("");
    currentCallId = null;
    currentCallRef = null;
    incomingCallData = null;
    pendingIceCandidates = [];
}

function isTerminalCallStatus(status){
    return terminalCallStatuses.indexOf(status) !== -1;
}

function getCallPeerId(call, userId){
    if(!call || !userId) return "";
    return call.callerId === userId ? call.receiverId : call.callerId;
}

function getCallStatusLabel(call){
    if(!call) return "Call";

    if(call.status === "missed") return "Missed call";
    if(call.status === "declined") return "Declined call";
    if(call.status === "cancelled") return "Cancelled call";
    if(call.status === "failed") return "Failed call";
    if(call.mode === "audio") return "Audio call";
    return "Video call";
}

function formatCallTime(value){
    if(!value) return "";

    const date = new Date(value);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();

    return date.toLocaleString([], {
        month: isToday ? undefined : "short",
        day: isToday ? undefined : "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function renderCallHistory(calls){
    if(!callList) return;

    const user = auth.currentUser;
    callList.innerHTML = "";

    if(!calls || !calls.length){
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No calls yet.";
        callList.appendChild(empty);
        return;
    }

    calls.forEach((call)=>{
        const peerId = call.peerId || getCallPeerId(call, user && user.uid);
        const row = document.createElement("button");
        row.type = "button";
        row.className = "call-row" + (call.status === "missed" ? " missed" : "");
        row.onclick = () => {
            if(peerId){
                openChat(peerId);
            }
        };

        const direction = call.direction === "outgoing" ? "Outgoing" : "Incoming";
        const mode = call.mode === "audio" ? "Audio" : "Video";

        row.innerHTML = `
            <span class="call-icon">${call.direction === "outgoing" ? "Out" : "In"}</span>
            <span>
                <strong>${escapeHtml(getCallLabel(peerId))}</strong>
                <small>${escapeHtml(getCallStatusLabel(call))} - ${direction} ${mode} - ${escapeHtml(formatCallTime(call.time || call.startedAt))}</small>
            </span>
        `;

        callList.appendChild(row);
    });
}

function listenToCallHistory(user){
    if(callHistoryRef){
        callHistoryRef.off();
    }

    callHistoryRef = db.ref("callHistory/" + user.uid);
    callHistoryRef.orderByChild("time").limitToLast(30).on("value", (snapshot)=>{
        const calls = [];
        snapshot.forEach((child)=>{
            calls.push(Object.assign({ callId: child.key }, child.val()));
        });

        lastRenderedCallHistory = calls.reverse();
        renderCallHistory(lastRenderedCallHistory);
    });
}

function saveCallHistory(callId, call){
    if(!call || !call.callerId || !call.receiverId || !isTerminalCallStatus(call.status)){
        return Promise.resolve();
    }

    const endedAt = call.endedAt || Date.now();
    const callerPeer = call.receiverId;
    const receiverPeer = call.callerId;
    const base = {
        callId: callId,
        callerId: call.callerId,
        receiverId: call.receiverId,
        mode: call.mode || "video",
        status: call.status,
        startedAt: call.startedAt || endedAt,
        answeredAt: call.answeredAt || null,
        endedAt: endedAt,
        time: endedAt
    };
    const updates = {};

    updates["callHistory/" + call.callerId + "/" + callId] = Object.assign({}, base, {
        direction: "outgoing",
        peerId: callerPeer
    });
    updates["callHistory/" + call.receiverId + "/" + callId] = Object.assign({}, base, {
        direction: "incoming",
        peerId: receiverPeer
    });

    return db.ref().update(updates);
}

function startMissedCallTimer(callId, callRef){
    clearMissedCallTimer();

    missedCallTimer = setTimeout(()=>{
        callRef.once("value").then((snapshot)=>{
            const call = snapshot.val();
            if(call && call.status === "ringing"){
                return callRef.update({
                    status: "missed",
                    missedBy: call.receiverId,
                    endedAt: Date.now()
                });
            }
        }).catch((error)=>{
            console.error("Error marking missed call:", error);
        });
    }, CALL_RING_TIMEOUT_MS);
}

async function startLocalMedia(mode){
    const constraints = {
        audio: true,
        video: mode === "video"
    };

    localStream = await navigator.mediaDevices.getUserMedia(constraints);

    document.getElementById("localVideo").srcObject = localStream;
    return localStream;
}

function createCallPeer(callId, peerId){
    peerConnection = new RTCPeerConnection(servers);

    peerConnection.ontrack = function(event){
        const remoteVideo = document.getElementById("remoteVideo");
        if(remoteVideo){
            remoteVideo.srcObject = event.streams[0];
        }
    };

    peerConnection.onicecandidate = function(event){
        if(event.candidate && auth.currentUser){
            db.ref("calls/" + callId + "/candidates/" + auth.currentUser.uid).push(event.candidate.toJSON());
        }
    };

    if(localStream){
        localStream.getTracks().forEach((track)=>{
            peerConnection.addTrack(track, localStream);
        });
    }

    peerCandidateRef = db.ref("calls/" + callId + "/candidates/" + peerId);
    callCandidatesRef = peerCandidateRef.on("child_added", (snapshot)=>{
        const candidate = snapshot.val();
        if(candidate && peerConnection){
            const iceCandidate = new RTCIceCandidate(candidate);

            if(peerConnection.remoteDescription){
                peerConnection.addIceCandidate(iceCandidate).catch((error)=>{
                    console.error("Error adding ICE candidate:", error);
                });
            } else {
                pendingIceCandidates.push(iceCandidate);
            }
        }
    });

    return peerConnection;
}

function flushPendingIceCandidates(){
    if(!peerConnection || !peerConnection.remoteDescription) return;

    pendingIceCandidates.forEach((candidate)=>{
        peerConnection.addIceCandidate(candidate).catch((error)=>{
            console.error("Error adding queued ICE candidate:", error);
        });
    });

    pendingIceCandidates = [];
}

function watchCurrentCall(callId){
    currentCallRef = db.ref("calls/" + callId);
    callValueRef = currentCallRef.on("value", async (snapshot)=>{
        const call = snapshot.val();
        if(!call){
            resetCallState();
            return;
        }

        if(isTerminalCallStatus(call.status)){
            saveCallHistory(callId, call).catch((error)=>{
                console.error("Error saving call history:", error);
            });
            resetCallState();
            return;
        }

        if(call.answer && peerConnection && !peerConnection.currentRemoteDescription){
            try {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(call.answer));
                flushPendingIceCandidates();
                clearMissedCallTimer();
                setCallStatus("Connected");
            } catch(error){
                console.error("Error setting remote answer:", error);
            }
        }
    });
}

window.startCall = async function(mode){
    const user = auth.currentUser;

    if(!user || !currentPeerId){
        alert("Choose a user to call first.");
        return;
    }

    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
        alert("Calling needs camera/microphone support in this browser.");
        return;
    }

    resetCallState();

    currentCallMode = mode === "audio" ? "audio" : "video";
    currentCallRef = db.ref("calls").push();
    currentCallId = currentCallRef.key;

    showCallPanel(true);
    showAnswerButton(false);
    setEndCallLabel("End");
    setCallStatus("Calling " + getCallLabel(currentPeerId) + "...");

    try {
        await currentCallRef.update({
            callerId: user.uid,
            receiverId: currentPeerId,
            chatId: getChatId(user.uid, currentPeerId),
            mode: currentCallMode,
            status: "starting",
            startedAt: Date.now()
        });

        await startLocalMedia(currentCallMode);
        createCallPeer(currentCallId, currentPeerId);

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        await currentCallRef.update({
            callerId: user.uid,
            receiverId: currentPeerId,
            chatId: getChatId(user.uid, currentPeerId),
            mode: currentCallMode,
            status: "ringing",
            startedAt: Date.now(),
            offer: {
                type: offer.type,
                sdp: offer.sdp
            }
        });

        startMissedCallTimer(currentCallId, currentCallRef);
        watchCurrentCall(currentCallId);
    } catch(error){
        console.error("Error starting call:", error);
        alert("Could not start call: " + error.message);
        if(currentCallRef){
            currentCallRef.update({ status: "failed", endedAt: Date.now() });
        }
        resetCallState();
    }
};

window.answerCall = async function(){
    const user = auth.currentUser;
    const call = incomingCallData;

    if(!user || !call || !currentCallId || !currentCallRef) return;

    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
        alert("Calling needs camera/microphone support in this browser.");
        return;
    }

    showAnswerButton(false);
    setEndCallLabel("End");
    setCallStatus("Connecting...");

    try {
        await startLocalMedia(call.mode || "video");
        createCallPeer(currentCallId, call.callerId);

        await peerConnection.setRemoteDescription(new RTCSessionDescription(call.offer));
        flushPendingIceCandidates();
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        await currentCallRef.update({
            status: "active",
            answeredAt: Date.now(),
            answer: {
                type: answer.type,
                sdp: answer.sdp
            }
        });

        watchCurrentCall(currentCallId);
        clearMissedCallTimer();
        setCallStatus("Connected");
    } catch(error){
        console.error("Error answering call:", error);
        alert("Could not answer call: " + error.message);
        await currentCallRef.update({ status: "failed", endedAt: Date.now() });
        resetCallState();
    }
};

window.endCall = async function(){
    if(currentCallRef){
        const user = auth.currentUser;
        const snapshot = await currentCallRef.once("value");
        const call = snapshot.val() || {};
        let status = "ended";

        if(call.status === "ringing"){
            status = user && call.receiverId === user.uid ? "declined" : "cancelled";
        }

        currentCallRef.update({
            status: status,
            endedBy: user ? user.uid : null,
            endedAt: Date.now()
        }).finally(resetCallState);
        return;
    }

    resetCallState();
};

function handleIncomingCallSnapshot(snapshot){
        const call = snapshot.val();
        if(!call || call.status !== "ringing" || currentCallId) return;

        if(call.startedAt && Date.now() - call.startedAt > CALL_RING_TIMEOUT_MS){
            snapshot.ref.update({
                status: "missed",
                missedBy: call.receiverId,
                endedAt: Date.now()
            });
            return;
        }

        currentCallId = snapshot.key;
        currentCallRef = snapshot.ref;
        incomingCallData = call;
        currentCallMode = call.mode || "video";

        showCallPanel(true);
        showAnswerButton(true);
        setEndCallLabel("Decline");
        setCallStatus("Incoming " + currentCallMode + " call from " + getCallLabel(call.callerId));
        startMissedCallTimer(currentCallId, currentCallRef);
}

function listenForIncomingCalls(user){
    db.ref("calls").orderByChild("receiverId").equalTo(user.uid).on("child_added", (snapshot)=>{
        handleIncomingCallSnapshot(snapshot);
    });

    db.ref("calls").orderByChild("receiverId").equalTo(user.uid).on("child_changed", (snapshot)=>{
        const call = snapshot.val();

        handleIncomingCallSnapshot(snapshot);

        if(snapshot.key === currentCallId && call && isTerminalCallStatus(call.status)){
            saveCallHistory(snapshot.key, call).catch((error)=>{
                console.error("Error saving call history:", error);
            });
            resetCallState();
        }
    });
}

window.logout = async function(){
    const user = firebase.auth().currentUser;

    if(user){
        await db.ref("users/" + user.uid).update({
            online: false,
            lastSeen: Date.now()
        });
    }

    firebase.auth().signOut()
        .then(()=>{
            window.location = "login.html";
        })
        .catch((error)=>{
            console.log(error);
        });
};
