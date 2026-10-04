const express = require('express');
const multer = require('multer');
const admin = require('firebase-admin');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
require('dotenv').config();

// Initialize Firebase Admin
let serviceAccount;
try {
    serviceAccount = require('./firebase-adminsdk-key');
} catch (error) {
    console.error('❌ firebase-adminsdk-key.json not found!');
    console.log('📝 Please download it from Firebase Console:');
    console.log('   Project Settings → Service accounts → Generate new private key');
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET
});

const bucket = admin.storage().bucket();
const db = admin.database();
const app = express();

// ==================== MIDDLEWARE ====================
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// ==================== MULTER CONFIGURATION ====================
const storage = multer.memoryStorage();

// File filter for different media types
const fileFilter = (req, file, cb) => {
    const allowedTypes = {
        'image': ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
        'video': ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
        'audio': ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3'],
        'document': ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']
    };
    
    const allAllowed = [...allowedTypes.image, ...allowedTypes.video, ...allowedTypes.audio, ...allowedTypes.document];
    
    if (allAllowed.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`File type ${file.mimetype} is not supported`), false);
    }
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 // 10MB default
    },
    fileFilter: fileFilter
});

// ==================== HELPER FUNCTIONS ====================
async function uploadToStorage(buffer, mimeType, storagePath, isPublic = true) {
    const file = bucket.file(storagePath);
    const stream = file.createWriteStream({
        metadata: {
            contentType: mimeType,
            metadata: {
                uploaded: Date.now().toString()
            }
        },
        resumable: false
    });

    return new Promise((resolve, reject) => {
        stream.on('error', (error) => {
            console.error('Upload error:', error);
            reject(error);
        });
        
        stream.on('finish', async () => {
            try {
                if (isPublic) {
                    await file.makePublic();
                }
                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
                resolve(publicUrl);
            } catch (err) {
                reject(err);
            }
        });
        
        stream.end(buffer);
    });
}

function getMediaType(mimeType) {
    if (mimeType.startsWith('image/')) return 'images';
    if (mimeType.startsWith('video/')) return 'videos';
    if (mimeType.startsWith('audio/')) return 'audio';
    return 'documents';
}

// ==================== API ROUTES ====================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        storage: bucket.name
    });
});

// Upload file (single file)
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { chatId, senderId, receiverId, type = 'chat' } = req.body;
        
        if (!chatId || !senderId) {
            return res.status(400).json({ error: 'chatId and senderId are required' });
        }

        const file = req.file;
        const mediaType = getMediaType(file.mimetype);
        const timestamp = Date.now();
        const uniqueName = `${timestamp}_${uuidv4()}_${path.basename(file.originalname)}`;
        
        // Store in different folders based on type
        let storagePath;
        if (type === 'profile') {
            storagePath = `profiles/${senderId}/${uniqueName}`;
        } else if (type === 'group') {
            storagePath = `groups/${chatId}/${mediaType}/${uniqueName}`;
        } else {
            storagePath = `chats/${chatId}/${mediaType}/${uniqueName}`;
        }

        console.log(`📤 Uploading ${file.originalname} (${(file.size / 1024).toFixed(2)}KB) to ${storagePath}`);

        const fileUrl = await uploadToStorage(
            file.buffer,
            file.mimetype,
            storagePath,
            true // Make public
        );

        // Create file metadata
        const fileMetadata = {
            url: fileUrl,
            fileName: file.originalname,
            fileSize: file.size,
            mimeType: file.mimetype,
            mediaType: mediaType,
            storagePath: storagePath,
            uploadedAt: timestamp,
            senderId: senderId,
            receiverId: receiverId || null
        };

        // Save file reference to Realtime Database
        if (type === 'profile') {
            await db.ref(`users/${senderId}`).update({
                photo: fileUrl,
                photoUpdatedAt: timestamp
            });
        } else if (type === 'chat') {
            // Save to chat messages
            const messageRef = db.ref(`messages/${chatId}`).push();
            await messageRef.set({
                text: `📎 ${file.originalname}`,
                file: fileMetadata,
                senderId: senderId,
                receiverId: receiverId || null,
                seen: false,
                time: timestamp,
                isFile: true,
                fileType: mediaType
            });
        }

        res.json({
            success: true,
            data: {
                url: fileUrl,
                fileName: file.originalname,
                fileSize: file.size,
                mimeType: file.mimetype,
                mediaType: mediaType,
                storagePath: storagePath,
                messageId: type === 'chat' ? messageRef.key : null
            }
        });

    } catch (error) {
        console.error('❌ Upload error:', error);
        res.status(500).json({ 
            error: error.message,
            details: error.stack
        });
    }
});

// Upload multiple files
app.post('/api/upload-multiple', upload.array('files', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const { chatId, senderId, receiverId } = req.body;
        
        if (!chatId || !senderId) {
            return res.status(400).json({ error: 'chatId and senderId are required' });
        }

        const uploadPromises = req.files.map(async (file) => {
            const mediaType = getMediaType(file.mimetype);
            const timestamp = Date.now();
            const uniqueName = `${timestamp}_${uuidv4()}_${path.basename(file.originalname)}`;
            const storagePath = `chats/${chatId}/${mediaType}/${uniqueName}`;

            const fileUrl = await uploadToStorage(
                file.buffer,
                file.mimetype,
                storagePath,
                true
            );

            // Save to chat messages
            const messageRef = db.ref(`messages/${chatId}`).push();
            await messageRef.set({
                text: `📎 ${file.originalname}`,
                file: {
                    url: fileUrl,
                    fileName: file.originalname,
                    fileSize: file.size,
                    mimeType: file.mimetype,
                    mediaType: mediaType,
                    storagePath: storagePath,
                    uploadedAt: timestamp
                },
                senderId: senderId,
                receiverId: receiverId || null,
                seen: false,
                time: timestamp,
                isFile: true,
                fileType: mediaType
            });

            return {
                url: fileUrl,
                fileName: file.originalname,
                fileSize: file.size,
                mimeType: file.mimetype,
                mediaType: mediaType,
                messageId: messageRef.key
            };
        });

        const results = await Promise.all(uploadPromises);

        res.json({
            success: true,
            data: results
        });

    } catch (error) {
        console.error('❌ Multiple upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Upload profile photo
app.post('/api/upload-profile', upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No photo uploaded' });
        }

        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const file = req.file;
        const timestamp = Date.now();
        const uniqueName = `${timestamp}_${uuidv4()}_${path.basename(file.originalname)}`;
        const storagePath = `profiles/${userId}/${uniqueName}`;

        console.log(`📤 Uploading profile photo for ${userId}`);

        const fileUrl = await uploadToStorage(
            file.buffer,
            file.mimetype,
            storagePath,
            true
        );

        await db.ref(`users/${userId}`).update({
            photo: fileUrl,
            photoUpdatedAt: timestamp
        });

        res.json({
            success: true,
            data: {
                url: fileUrl,
                storagePath: storagePath,
                fileName: file.originalname
            }
        });

    } catch (error) {
        console.error('❌ Profile upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get file URL
app.get('/api/file/:chatId/:fileId', async (req, res) => {
    try {
        const { chatId, fileId } = req.params;
        const snapshot = await db.ref(`messages/${chatId}/${fileId}`).once('value');
        const data = snapshot.val();
        
        if (!data || !data.file) {
            return res.status(404).json({ error: 'File not found' });
        }

        res.json({
            success: true,
            data: data.file
        });
    } catch (error) {
        console.error('❌ Get file error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete file (optional)
app.delete('/api/file/:chatId/:fileId', async (req, res) => {
    try {
        const { chatId, fileId } = req.params;
        const snapshot = await db.ref(`messages/${chatId}/${fileId}`).once('value');
        const data = snapshot.val();
        
        if (!data || !data.file) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Delete from storage
        await bucket.file(data.file.storagePath).delete();
        
        // Delete from database
        await db.ref(`messages/${chatId}/${fileId}`).remove();

        res.json({
            success: true,
            message: 'File deleted successfully'
        });
    } catch (error) {
        console.error('❌ Delete file error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== SERVE FRONTEND ====================
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ ChatMate server running on http://localhost:${PORT}`);
    console.log(`📁 Storage bucket: ${bucket.name}`);
    console.log(`📊 Database: ${process.env.FIREBASE_DATABASE_URL}`);
    console.log(`📎 Max file size: ${parseInt(process.env.MAX_FILE_SIZE || 10485760) / 1024 / 1024}MB`);
    console.log('\n📋 Available endpoints:');
    console.log('   POST /api/upload           - Upload single file');
    console.log('   POST /api/upload-multiple  - Upload multiple files');
    console.log('   POST /api/upload-profile   - Upload profile photo');
    console.log('   GET  /api/file/:chatId/:fileId - Get file info');
    console.log('   DELETE /api/file/:chatId/:fileId - Delete file');
});

// Error handling
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error);
});