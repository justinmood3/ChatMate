// set-admin.js
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-adminsdk-key.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://chatmates-1abc2-default-rtdb.firebaseio.com"
});

const email = process.argv[2];

if (!email) {
    console.log('Usage: node set-admin.js email@example.com');
    process.exit(1);
}

async function setAdmin() {
    try {
        // Get user by email
        const user = await admin.auth().getUserByEmail(email);
        
        console.log(`✅ User found: ${user.email}`);
        console.log(`🆔 UID: ${user.uid}`);
        
        // Set admin claim
        await admin.auth().setCustomUserClaims(user.uid, { admin: true });
        console.log(`✅ Admin claim set successfully!`);
        
        // Update database
        await admin.database().ref(`users/${user.uid}`).update({
            admin: true,
            updatedAt: Date.now()
        });
        console.log(`✅ Database updated!`);
        
        console.log(`\n🎉 ${email} is now an ADMIN!`);
        console.log(`🔐 You can now login at: http://localhost:3001/admin-login`);
        
    } catch (error) {
        if (error.code === 'auth/user-not-found') {
            console.log(`\n❌ User ${email} not found in Firebase Authentication!`);
            console.log(`\n💡 To fix this, do ONE of the following:\n`);
            console.log(`   1. Have the user sign up through your chat app first`);
            console.log(`   2. Create user in Firebase Console:`);
            console.log(`      Firebase Console → Authentication → Add User`);
        } else {
            console.error('❌ Error:', error.message);
        }
    }
}

setAdmin();