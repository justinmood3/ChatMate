// admin-delete-user.js
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Check if service account file exists
const keyPath = path.join(__dirname, 'firebase-adminsdk-key.json');

if (!fs.existsSync(keyPath)) {
    console.error('❌ Error: firebase-adminsdk-key.json not found!');
    console.error('📁 Please download it from:');
    console.error('   Firebase Console → Project Settings → Service Accounts');
    console.error('   → Generate New Private Key');
    process.exit(1);
}

// Initialize Firebase Admin
const serviceAccount = require(keyPath);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://YOUR_PROJECT_ID.firebaseio.com" // Replace with your database URL
});

async function deleteUser(userId) {
    if (!userId) {
        console.error('❌ User ID is required');
        console.log('Usage: node admin-delete-user.js USER_ID');
        return;
    }
    
    try {
        console.log(`🗑️ Deleting user: ${userId}`);
        
        // Delete from Authentication
        await admin.auth().deleteUser(userId);
        console.log('✅ User deleted from Authentication');
        
        // Delete user data from Realtime Database
        await admin.database().ref(`users/${userId}`).remove();
        console.log('✅ User data deleted from Realtime Database');
        
        // Delete user's messages
        const messagesRef = admin.database().ref('messages');
        const snapshot = await messagesRef.once('value');
        
        let deletedChats = 0;
        const deletePromises = [];
        
        snapshot.forEach((chat) => {
            if (chat.key.includes(userId)) {
                deletePromises.push(admin.database().ref(`messages/${chat.key}`).remove());
                deletedChats++;
            }
        });
        
        await Promise.all(deletePromises);
        console.log(`✅ Deleted ${deletedChats} chat(s)`);
        
        console.log(`🎉 User ${userId} completely deleted!`);
        
    } catch (error) {
        if (error.code === 'auth/user-not-found') {
            console.error('❌ User not found in Authentication');
        } else {
            console.error('❌ Error:', error.message);
        }
    }
}

// Get user ID from command line
const userId = process.argv[2];
deleteUser(userId);