// list-users.js
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-adminsdk-key.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://YOUR_PROJECT_ID.firebaseio.com"
});

async function listUsers() {
    try {
        const listUsersResult = await admin.auth().listUsers();
        console.log(`📋 Total users: ${listUsersResult.users.length}\n`);
        
        listUsersResult.users.forEach((user, index) => {
            console.log(`${index + 1}. Email: ${user.email}`);
            console.log(`   UID: ${user.uid}`);
            console.log(`   Admin: ${user.customClaims?.admin || false}`);
            console.log('---');
        });
    } catch (error) {
        console.error('Error:', error.message);
    }
}

listUsers();