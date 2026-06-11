const firebaseConfig = {
    apiKey: "AIzaSyAGu2sRWetpe-gR19agt8l6QZqFbVsJDSc",
    authDomain: "chatmates-1abc2.firebaseapp.com",
    databaseURL: "https://chatmates-1abc2-default-rtdb.firebaseio.com/",
    projectId: "chatmates-1abc2",
    storageBucket: "chatmates-1abc2.appspot.com",
    messagingSenderId: "133261514325",
    appId: "1:133261514325:web:cf2dfd14b6bb731ca4e6dc"
};

firebase.initializeApp(firebaseConfig);

window.auth = firebase.auth();
window.db = firebase.database();