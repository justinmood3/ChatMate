// create-user.js
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-adminsdk-key.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://YOUR-PROJECT-ID.firebaseio.com"
});

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
    console.log('Usage: node create-user.js email@example.com password123');
    process.exit(1);
}

async function createUser() {
    try {
        const userRecord = await admin.auth().createUser({
            email: email,
            password: password,
            emailVerified: true
        });
        console.log(`✅ User created successfully!`);
        console.log(`📧 Email: ${email}`);
        console.log(`🆔 UID: ${userRecord.uid}`);
        
        // Also create user in database
        await admin.database().ref(`users/${userRecord.uid}`).set({
            email: email,
            username: email.split('@')[0],
            displayName: email.split('@')[0],
            status: "Available",
            online: false,
            createdAt: Date.now()
        });
        console.log(`✅ User also added to database`);
    } catch (error) {
        console.error('Error:', error.message);
    }
}

createUser();