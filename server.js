// server.js
const express = require('express');
const multer = require('multer');
const admin = require('firebase-admin');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Initialize Firebase Admin
const serviceAccount = require('./firebase-adminsdk-key.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET
});

const bucket = admin.storage().bucket();
const db = admin.database();
const app = express();

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
}));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Multer configuration
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

const uploadProfile = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB for profile photos
});

// Helper function to upload to Firebase Storage
async function uploadToStorage(buffer, mimeType, storagePath) {
    const file = bucket.file(storagePath);
    const stream = file.createWriteStream({
        metadata: { contentType: mimeType },
        resumable: false
    });

    return new Promise((resolve, reject) => {
        stream.on('error', reject);
        stream.on('finish', async () => {
            try {
                // Make file public
                await file.makePublic();
                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
                resolve(publicUrl);
            } catch (err) {
                reject(err);
            }
        });
        stream.end(buffer);
    });
}

// ==================== API ROUTES ====================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Upload chat media
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { chatId, senderId } = req.body;
        if (!chatId || !senderId) {
            return res.status(400).json({ error: 'chatId and senderId are required' });
        }

        // Determine media type folder
        let mediaType = 'files';
        if (req.file.mimetype.startsWith('image/')) mediaType = 'images';
        else if (req.file.mimetype.startsWith('video/')) mediaType = 'videos';
        else if (req.file.mimetype.startsWith('audio/')) mediaType = 'audio';
        else mediaType = 'documents';

        const timestamp = Date.now();
        const uniqueName = `${timestamp}_${uuidv4()}_${req.file.originalname}`;
        const storagePath = `media/${chatId}/${mediaType}/${uniqueName}`;

        const fileUrl = await uploadToStorage(
            req.file.buffer,
            req.file.mimetype,
            storagePath
        );

        res.json({
            success: true,
            url: fileUrl,
            fileName: req.file.originalname,
            mediaType: mediaType,
            fileSize: req.file.size,
            mimeType: req.file.mimetype
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Save profile (with optional photo)
app.post('/api/profile', uploadProfile.single('photo'), async (req, res) => {
    try {
        const { userId, username, status, email } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const updates = {
            username: username || email?.split('@')[0] || 'User',
            displayName: username || email?.split('@')[0] || 'User',
            status: status || 'Available',
            email: email || '',
            online: true,
            lastSeen: Date.now(),
            updatedAt: Date.now()
        };

        // Upload photo if provided
        if (req.file) {
            const timestamp = Date.now();
            const uniqueName = `${timestamp}_${uuidv4()}_${req.file.originalname}`;
            const storagePath = `profiles/${userId}/${uniqueName}`;
            
            const photoUrl = await uploadToStorage(
                req.file.buffer,
                req.file.mimetype,
                storagePath
            );
            
            updates.photo = photoUrl;
        }

        // Save to Firebase Realtime Database
        await db.ref(`users/${userId}`).update(updates);

        // Get the updated profile
        const snapshot = await db.ref(`users/${userId}`).once('value');
        const profile = snapshot.val();

        res.json({
            success: true,
            message: 'Profile saved successfully',
            profile: profile
        });

    } catch (error) {
        console.error('Profile save error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get user profile
app.get('/api/profile/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const snapshot = await db.ref(`users/${userId}`).once('value');
        const profile = snapshot.val();
        
        res.json({
            success: true,
            profile: profile || null
        });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all users
app.get('/api/users', async (req, res) => {
    try {
        const snapshot = await db.ref('users').once('value');
        const users = snapshot.val() || {};
        
        res.json({
            success: true,
            users: users
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Serve static files
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ ChatMate server running on http://localhost:${PORT}`);
    console.log(`📁 Storage bucket: ${bucket.name}`);
});