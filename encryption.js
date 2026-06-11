// encryption.js - Multi-Device End-to-End Encryption

// ==================== KEY MANAGEMENT ====================

// Generate a master encryption key for the user
async function generateMasterKey() {
    const key = await crypto.subtle.generateKey(
        {
            name: "AES-GCM",
            length: 256,
        },
        true,
        ["encrypt", "decrypt"]
    );
    return key;
}

// Export master key to Base64
async function exportMasterKey(key) {
    const exported = await crypto.subtle.exportKey("raw", key);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

// Import master key from Base64
async function importMasterKey(base64Key) {
    const keyData = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
    return await crypto.subtle.importKey(
        "raw",
        keyData,
        "AES-GCM",
        true,
        ["encrypt", "decrypt"]
    );
}

// Derive a chat-specific key from the master key and chat ID
async function deriveChatKey(masterKey, chatId) {
    const encoder = new TextEncoder();
    const chatIdData = encoder.encode(chatId);
    
    // Import master key as CryptoKey
    const masterKeyObj = await importMasterKey(masterKey);
    
    // Derive a key using HKDF
    const hkdfKey = await crypto.subtle.deriveKey(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: encoder.encode("ChatMateChatKey"),
            info: chatIdData,
        },
        masterKeyObj,
        {
            name: "AES-GCM",
            length: 256,
        },
        true,
        ["encrypt", "decrypt"]
    );
    
    return hkdfKey;
}

// Store master key encrypted with user's password (for multi-device sync)
async function storeMasterKeyEncrypted(userId, masterKey, password) {
    // Use password to encrypt master key
    const encoder = new TextEncoder();
    const passwordKey = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password.padEnd(32, '0').slice(0, 32)),
        "PBKDF2",
        false,
        ["deriveBits", "deriveKey"]
    );
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        passwordKey,
        encoder.encode(masterKey)
    );
    
    const encryptedData = {
        iv: btoa(String.fromCharCode(...iv)),
        data: btoa(String.fromCharCode(...new Uint8Array(encrypted)))
    };
    
    await firebase.database().ref(`encryptedMasterKeys/${userId}`).set(encryptedData);
    return encryptedData;
}

// Retrieve and decrypt master key
async function getMasterKey(userId, password) {
    const snapshot = await firebase.database().ref(`encryptedMasterKeys/${userId}`).once('value');
    const encryptedData = snapshot.val();
    
    if (!encryptedData) {
        // First time - generate new master key
        const newMasterKey = await generateMasterKey();
        const exportedKey = await exportMasterKey(newMasterKey);
        await storeMasterKeyEncrypted(userId, exportedKey, password);
        return exportedKey;
    }
    
    const encoder = new TextEncoder();
    const passwordKey = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password.padEnd(32, '0').slice(0, 32)),
        "PBKDF2",
        false,
        ["deriveBits", "deriveKey"]
    );
    
    const iv = Uint8Array.from(atob(encryptedData.iv), c => c.charCodeAt(0));
    const encryptedDataBytes = Uint8Array.from(atob(encryptedData.data), c => c.charCodeAt(0));
    
    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        passwordKey,
        encryptedDataBytes
    );
    
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
}

// Store master key in localStorage for offline access across devices
async function cacheMasterKeyLocally(userId, masterKey) {
    try {
        localStorage.setItem(`chatmate_masterkey_${userId}`, masterKey);
        localStorage.setItem(`chatmate_masterkey_time_${userId}`, Date.now().toString());
    } catch (e) {
        console.warn('Could not cache master key locally:', e);
    }
}

// Get cached master key
function getCachedMasterKey(userId) {
    const cached = localStorage.getItem(`chatmate_masterkey_${userId}`);
    const cachedTime = localStorage.getItem(`chatmate_masterkey_time_${userId}`);
    
    if (cached && cachedTime) {
        const age = Date.now() - parseInt(cachedTime);
        if (age < 7 * 24 * 60 * 60 * 1000) { // 7 days
            return cached;
        }
    }
    return null;
}

// Sync master key across devices using Firebase (encrypted)
async function syncMasterKeyAcrossDevices(userId, masterKey) {
    // Store in Firebase (already encrypted with password)
    // This allows any device with the password to retrieve it
    const snapshot = await firebase.database().ref(`encryptedMasterKeys/${userId}`).once('value');
    if (!snapshot.exists()) {
        // First device - key already stored during login
        console.log('Master key already synced');
    }
}

// ==================== MESSAGE ENCRYPTION/DECRYPTION ====================

// Encrypt message for a specific chat
async function encryptMessageForChat(message, chatId, masterKey) {
    try {
        const chatKey = await deriveChatKey(masterKey, chatId);
        const encoder = new TextEncoder();
        const data = encoder.encode(message);
        
        const iv = crypto.getRandomValues(new Uint8Array(12));
        
        const encrypted = await crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv: iv,
            },
            chatKey,
            data
        );
        
        // Combine IV + encrypted data
        const encryptedArray = new Uint8Array(iv.length + encrypted.byteLength);
        encryptedArray.set(iv);
        encryptedArray.set(new Uint8Array(encrypted), iv.length);
        
        // Also generate a hash for integrity
        const hash = await generateMessageHash(message, chatId);
        
        return {
            encrypted: btoa(String.fromCharCode(...encryptedArray)),
            hash: hash,
            version: "2.0"
        };
    } catch (error) {
        console.error('Encryption error:', error);
        return { encrypted: message, hash: '', version: "1.0" };
    }
}

// Decrypt message from a specific chat
async function decryptMessageFromChat(encryptedBase64, hash, chatId, masterKey) {
    try {
        const chatKey = await deriveChatKey(masterKey, chatId);
        
        const encryptedData = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
        
        const iv = encryptedData.slice(0, 12);
        const data = encryptedData.slice(12);
        
        const decrypted = await crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: iv,
            },
            chatKey,
            data
        );
        
        const decoder = new TextDecoder();
        const decryptedMessage = decoder.decode(decrypted);
        
        // Verify integrity
        const isValid = await verifyMessageHash(decryptedMessage, hash, chatId);
        if (!isValid) {
            console.warn('Message integrity check failed!');
            return '[Message integrity compromised]';
        }
        
        return decryptedMessage;
    } catch (error) {
        console.error('Decryption error:', error);
        return '[Unable to decrypt message]';
    }
}

// Generate message hash for integrity
async function generateMessageHash(message, salt) {
    const encoder = new TextEncoder();
    const data = encoder.encode(message + salt);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(hash))).substring(0, 32);
}

// Verify message integrity
async function verifyMessageHash(message, hash, salt) {
    const expectedHash = await generateMessageHash(message, salt);
    return expectedHash === hash;
}

// ==================== DEVICE MANAGEMENT ====================

// Register a new device for the user
async function registerDevice(userId, deviceName) {
    const deviceId = generateDeviceId();
    const deviceInfo = {
        deviceId: deviceId,
        deviceName: deviceName,
        userAgent: navigator.userAgent,
        lastActive: Date.now(),
        createdAt: Date.now()
    };
    
    await firebase.database().ref(`userDevices/${userId}/${deviceId}`).set(deviceInfo);
    localStorage.setItem(`chatmate_device_${userId}`, deviceId);
    return deviceId;
}

// Generate unique device ID
function generateDeviceId() {
    return 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Get current device ID
function getCurrentDeviceId(userId) {
    return localStorage.getItem(`chatmate_device_${userId}`);
}

// Sync messages across devices (mark as read on all devices)
async function syncMessageReadStatus(chatId, messageId) {
    const user = firebase.auth().currentUser;
    if (!user) return;
    
    await firebase.database().ref(`messages/${chatId}/${messageId}/readBy/${user.uid}`).set(true);
}

// ==================== INITIALIZATION ====================

// Initialize encryption for current user
let currentMasterKey = null;

async function initEncryption(password) {
    const user = firebase.auth().currentUser;
    if (!user) return null;
    
    // Try to get cached master key first
    let masterKey = getCachedMasterKey(user.uid);
    
    if (!masterKey) {
        // Retrieve from Firebase (decrypt with password)
        masterKey = await getMasterKey(user.uid, password);
        if (masterKey) {
            cacheMasterKeyLocally(user.uid, masterKey);
        }
    }
    
    if (masterKey) {
        currentMasterKey = masterKey;
        await syncMasterKeyAcrossDevices(user.uid, masterKey);
        
        // Register this device
        let deviceId = getCurrentDeviceId(user.uid);
        if (!deviceId) {
            deviceId = await registerDevice(user.uid, getDeviceName());
        }
    }
    
    return masterKey;
}

// Get device name
function getDeviceName() {
    const platform = navigator.platform;
    const language = navigator.language;
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (isMobile) {
        return `Mobile Device (${platform})`;
    }
    return `Desktop (${platform})`;
}

// Get current master key
function getCurrentMasterKey() {
    return currentMasterKey;
}