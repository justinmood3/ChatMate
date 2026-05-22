const firebaseConfig = {
    apiKey: "AIzaSyAGu2sRWetpe-gR19agt8l6QZqFbVsJDSc",
    authDomain: "chatmates-1abc2.firebaseapp.com",
    databaseURL: "https://chatmates-1abc2-default-rtdb.firebaseio.com/",
    projectId: "chatmates-1abc2",
    storageBucket: "chatmates-1abc2.appspot.com",
    messagingSenderId: "133261514325",
    appId: "1:133261514325:web:cf2dfd14b6bb731ca4e6dc",
    measurementId: "G-WRXSKT12V8"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.database();

// SAFE messaging init
let messaging = null;

try {
    messaging = firebase.messaging();
} catch (e) {
    console.log("Messaging not available:", e);
}

// Notification system
async function enableNotifications(){

    if(!messaging) return;

    const permission = await Notification.requestPermission();

    if(permission !== "granted") return;

    const token = await messaging.getToken({
        vapidKey: "BK7T-WSwBbWGEUbh7eHuHR5X0gnPpPd9Zd82vgAl3U_6F_9kaLSLLye3A5jbAsoGv8SD5l1EyCdph5K3Nxx1kyc"
    });

    console.log("FCM Token:", token);
}

// Receive foreground messages
if(messaging){
    messaging.onMessage((payload)=>{

        new Notification(payload.notification.title, {
            body: payload.notification.body
        });

    });
}