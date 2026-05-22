importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAGu2sRWetpe-gR19agt8l6QZqFbVsJDSc",
  authDomain: "chatmates-1abc2.firebaseapp.com",
  projectId: "chatmates-1abc2",
  storageBucket: "chatmates-1abc2.appspot.com",
  messagingSenderId: "133261514325",
  appId: "1:133261514325:web:cf2dfd14b6bb731ca4e6dc"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload){
  const notification = payload.notification || {};

  self.registration.showNotification(
    notification.title || "New Message",
    {
      body: notification.body || ""
    }
  );
});
