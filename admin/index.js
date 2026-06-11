// index.js
const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const path = require('path');

// Load service account
const serviceAccount = require('./firebase-adminsdk-key.json');

// Initialize Firebase Admin
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://chatmates-1abc2-default-rtdb.firebaseio.com"
});

const app = express();
const db = admin.database();

// Middleware - Allow CORS from both ports
app.use(cors({
    origin: ['http://localhost:8000', 'http://localhost:3001'],
    credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ==================== API ROUTES ====================

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Admin server is running!',
        timestamp: new Date().toISOString()
    });
});

// Get all users
app.get('/api/users', async (req, res) => {
    try {
        const snapshot = await db.ref('users').once('value');
        const users = snapshot.val() || {};
        
        // Get auth users for emails
        const authUsers = await admin.auth().listUsers();
        const authUserMap = {};
        authUsers.users.forEach(user => {
            authUserMap[user.uid] = user.email;
        });
        
        const usersList = [];
        for (const [uid, userData] of Object.entries(users)) {
            usersList.push({
                uid: uid,
                email: authUserMap[uid] || userData.email,
                username: userData.username || userData.displayName || '',
                status: userData.status || '',
                photo: userData.photo || '',
                online: userData.online || false,
                lastSeen: userData.lastSeen || null,
                admin: userData.admin || false,
                lastMessage: userData.lastMessage || '',
                lastMessageTime: userData.lastMessageTime || null
            });
        }
        
        res.json({ success: true, users: usersList });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get user stats
app.get('/api/stats', async (req, res) => {
    try {
        const snapshot = await db.ref('users').once('value');
        const users = snapshot.val() || {};
        
        let totalUsers = 0;
        let onlineUsers = 0;
        
        for (const [uid, userData] of Object.entries(users)) {
            totalUsers++;
            if (userData.online) onlineUsers++;
        }
        
        res.json({
            success: true,
            stats: {
                totalUsers: totalUsers,
                onlineUsers: onlineUsers,
                lastUpdated: Date.now()
            }
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Make user admin
app.post('/api/make-admin', async (req, res) => {
    try {
        const { uid, email } = req.body;
        
        if (!uid && !email) {
            return res.status(400).json({ error: 'Either uid or email is required' });
        }
        
        let user;
        if (email) {
            user = await admin.auth().getUserByEmail(email);
        } else {
            user = await admin.auth().getUser(uid);
        }
        
        // Set admin claim in Auth
        await admin.auth().setCustomUserClaims(user.uid, { admin: true });
        
        // Update database
        await db.ref(`users/${user.uid}`).update({
            admin: true,
            updatedAt: Date.now()
        });
        
        res.json({ 
            success: true, 
            message: `${user.email} is now an admin`
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete user
app.post('/api/delete-user', async (req, res) => {
    try {
        const { uid } = req.body;
        
        if (!uid) {
            return res.status(400).json({ error: 'User ID is required' });
        }
        
        // Get user email before deleting
        let userEmail = '';
        try {
            const user = await admin.auth().getUser(uid);
            userEmail = user.email;
        } catch (e) {
            userEmail = uid;
        }
        
        // Delete from Authentication
        await admin.auth().deleteUser(uid);
        
        // Delete from Realtime Database
        await db.ref(`users/${uid}`).remove();
        
        // Delete user's messages
        const messagesRef = db.ref('messages');
        const snapshot = await messagesRef.once('value');
        
        const deletePromises = [];
        snapshot.forEach((chat) => {
            if (chat.key.includes(uid)) {
                deletePromises.push(db.ref(`messages/${chat.key}`).remove());
            }
        });
        
        await Promise.all(deletePromises);
        
        // Delete from call history
        await db.ref(`callHistory/${uid}`).remove();
        
        res.json({ 
            success: true, 
            message: `User ${userEmail} deleted successfully` 
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Serve admin panel
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-panel.html'));
});

app.get('/admin-login', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-login.html'));
});

// Start server
const PORT = 3001;
app.listen(PORT, () => {
    console.log(`✅ Admin server running on http://localhost:${PORT}`);
    console.log(`📊 Admin Panel: http://localhost:${PORT}/admin`);
    console.log(`🔐 Admin Login: http://localhost:${PORT}/admin-login`);
    console.log(`🗄️ Database: https://chatmates-1abc2-default-rtdb.firebaseio.com`);
    console.log(`🔗 Chat App: http://localhost:8000`);
});