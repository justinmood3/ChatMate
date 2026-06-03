/* ============================================================
   server.js  —  ChatMate Media & Profile Upload Server
   Stack: Express · Multer · Firebase Admin SDK
   ============================================================

   Setup:
     1.  npm install express multer firebase-admin uuid cors dotenv
     2.  Create a .env file (see bottom of this file for template)
     3.  Download your Firebase service-account key JSON from:
           Firebase Console → Project Settings → Service Accounts
           → Generate new private key
     4.  node server.js   (or: npx nodemon server.js for dev)
   ============================================================ */

'use strict';

require('dotenv').config();

const express  = require('express');
const multer   = require('multer');
const admin    = require('firebase-admin');
const cors     = require('cors');
const path     = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDownloadURL } = require('firebase-admin/storage');

/* ── 1. Firebase Admin init ──────────────────────────────── */

const serviceAccount = require(
    process.env.FIREBASE_KEY_PATH || './firebase-adminsdk-key.json'
);

admin.initializeApp({
    credential:    admin.credential.cert(serviceAccount),
    databaseURL:   process.env.FIREBASE_DATABASE_URL
                   || 'https://chatmates-1abc2-default-rtdb.firebaseio.com/',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET
                   || 'chatmates-1abc2.appspot.com'
});

const bucket = admin.storage().bucket();
const db     = admin.database();           // server-side Realtime DB access

/* ── 2. Express app ──────────────────────────────────────── */

const app = express();

/* Allow your frontend origin.
   In production replace '*' with your exact domain, e.g.
   'https://chatmates-1abc2.web.app'                         */
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
}));

app.use(express.json());

/* Serve static frontend files from the same folder           */
app.use(express.static(path.join(__dirname)));

/* ── 3. Multer (in-memory, 10 MB cap) ───────────────────── */

const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/'];
const ALLOWED_DOCUMENT_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'application/zip'
];

function fileFilter(_req, file, cb) {
    const ok =
        ALLOWED_MIME_PREFIXES.some(p => file.mimetype.startsWith(p)) ||
        ALLOWED_DOCUMENT_TYPES.includes(file.mimetype);

    if (ok) {
        cb(null, true);
    } else {
        cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 10 * 1024 * 1024 },   // 10 MB
    fileFilter
});

/* Profile photos get a tighter 5 MB cap                      */
const uploadProfile = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 5 * 1024 * 1024 },
    fileFilter(req, file, cb) {
        file.mimetype.startsWith('image/')
            ? cb(null, true)
            : cb(new Error('Profile photo must be an image.'));
    }
});

/* ── 4. Helpers ──────────────────────────────────────────── */

/**
 * Upload a buffer to Firebase Storage and return a permanent
 * download URL (token-authenticated).
 */
async function uploadToStorage(buffer, mimeType, storagePath) {
    const blob       = bucket.file(storagePath);
    const blobStream = blob.createWriteStream({
        resumable: false,
        metadata:  { contentType: mimeType }
    });

    await new Promise((resolve, reject) => {
        blobStream.on('error', reject);
        blobStream.on('finish', resolve);
        blobStream.end(buffer);
    });

    return getDownloadURL(blob);   // permanent, token-authenticated URL
}

/**
 * Derive the logical media type bucket from a MIME type.
 */
function resolveMediaType(mimeType) {
    if (mimeType.startsWith('image/'))  return 'images';
    if (mimeType.startsWith('video/'))  return 'videos';
    if (mimeType.startsWith('audio/'))  return 'voice';
    return 'documents';
}

/* ── 5. Routes ───────────────────────────────────────────── */

/* ── POST /api/upload  (chat media: images, video, audio, docs) */
app.post('/api/upload', upload.single('mediaFile'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'No file received. Send the file as multipart/form-data with field name "mediaFile".' });
        }

        /* Optional metadata sent by the client */
        const chatId    = req.body.chatId    || 'general';
        const senderId  = req.body.senderId  || 'unknown';
        const mediaType = resolveMediaType(file.mimetype);

        const uniqueName  = `${uuidv4()}_${file.originalname}`;
        const storagePath = `chat_media/${chatId}/${mediaType}/${uniqueName}`;

        const downloadUrl = await uploadToStorage(
            file.buffer,
            file.mimetype,
            storagePath
        );

        return res.status(200).json({
            message:   'Upload successful.',
            fileName:  uniqueName,
            mediaType,
            fileUrl:   downloadUrl
        });

    } catch (err) {
        console.error('[/api/upload]', err);
        return res.status(500).json({ error: 'Upload failed.', details: err.message });
    }
});

/* ── POST /api/upload-profile  (profile photo + name/status) */
app.post('/api/upload-profile', uploadProfile.single('photo'), async (req, res) => {
    try {
        const { userId, username, status } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required.' });
        }

        const updates = {
            username:  username  || null,
            status:    status    || null,
            email:     req.body.email || null,
            online:    true,
            lastSeen:  Date.now()
        };

        /* If a photo was attached, upload it first */
        if (req.file) {
            const uniqueName  = `${uuidv4()}_${req.file.originalname}`;
            const storagePath = `profiles/${userId}/${uniqueName}`;

            const photoUrl = await uploadToStorage(
                req.file.buffer,
                req.file.mimetype,
                storagePath
            );

            updates.photo = photoUrl;
        }

        /* Persist to Realtime Database */
        await db.ref(`users/${userId}`).update(updates);

        return res.status(200).json({
            message: 'Profile saved.',
            profile: updates
        });

    } catch (err) {
        console.error('[/api/upload-profile]', err);
        return res.status(500).json({ error: 'Profile save failed.', details: err.message });
    }
});

/* ── GET /api/health ── quick liveness check ── */
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/* ── 6. Global error handler ─────────────────────────────── */
app.use((err, _req, res, _next) => {
    console.error('[Unhandled]', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

/* ── 7. Start ────────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`ChatMate server running → http://localhost:${PORT}`);
});

/* ============================================================
   .env template — create this file next to server.js
   ============================================================

   FIREBASE_KEY_PATH=./firebase-adminsdk-key.json
   FIREBASE_DATABASE_URL=https://chatmates-1abc2-default-rtdb.firebaseio.com/
   FIREBASE_STORAGE_BUCKET=chatmates-1abc2.appspot.com
   CORS_ORIGIN=https://your-production-domain.com
   PORT=3000

   ============================================================ */