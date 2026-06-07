'use strict';

const auth = firebase.auth();
const db = firebase.database();

/* ================= UTIL ================= */

function getValue(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
}

function generateCode() {
    return Math.floor(100000 + Math.random() * 900000);
}

function sendEmailCode(email, code) {
    return emailjs.send("service_cquxd0f", "template_246i6ro", {
        email,
        code
    });
}

/* ================= SIGNUP ================= */

window.signup = async function () {
    const email = getValue("email");
    const password = getValue("password");

    if (!email || !password) {
        alert("Enter email and password");
        return;
    }

    try {
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        const user = cred.user;

        // create user in database (IMPORTANT FIX)
        await db.ref("users/" + user.uid).set({
            uid: user.uid,
            email: user.email,
            username: email.split("@")[0],
            photo: "",
            status: "Available",
            online: true,
            verified: false,
            createdAt: Date.now()
        });

        const code = generateCode();

        await db.ref("emailCodes/" + user.uid).set({
            code,
            email,
            verified: false,
            createdAt: Date.now()
        });

        await sendEmailCode(email, code);

        alert("OTP sent to email!");
        await auth.signOut();

    } catch (err) {
        console.error(err);
        alert(err.message);
    }
};

/* ================= VERIFY OTP ================= */

window.verifyEmailCode = async function () {
    const codeInput = getValue("emailVerificationCode");
    const user = auth.currentUser;

    if (!user) return alert("Login first");

    const snap = await db.ref("emailCodes/" + user.uid).once("value");
    const data = snap.val();

    if (!data) return alert("No code found");

    if (Number(data.code) === Number(codeInput)) {
        await db.ref("users/" + user.uid).update({
            verified: true
        });

        alert("Verified!");
        window.location = "chat.html";
    } else {
        alert("Wrong code");
    }
};

/* ================= LOGIN ================= */

window.login = async function () {
    const email = getValue("email");
    const password = getValue("password");

    try {
        const cred = await auth.signInWithEmailAndPassword(email, password);
        const user = cred.user;

        await db.ref("users/" + user.uid).update({
            online: true,
            email: user.email,
            lastSeen: Date.now()
        });

        window.location = "chat.html";
    } catch (err) {
        alert(err.message);
    }
};

/* ================= GOOGLE LOGIN ================= */

window.googleLogin = async function () {
    const provider = new firebase.auth.GoogleAuthProvider();
    const result = await auth.signInWithPopup(provider);

    await db.ref("users/" + result.user.uid).set({
        uid: result.user.uid,
        email: result.user.email,
        username: result.user.displayName,
        photo: result.user.photoURL,
        status: "Available",
        online: true,
        verified: true,
        createdAt: Date.now()
    });

    window.location = "chat.html";
};

/* ================= AUTH STATE ================= */

auth.onAuthStateChanged(user => {
    if (!user) return;

    db.ref("users/" + user.uid).update({
        online: true,
        lastSeen: Date.now()
    });

    db.ref("users/" + user.uid).onDisconnect().update({
        online: false,
        lastSeen: Date.now()
    });
});