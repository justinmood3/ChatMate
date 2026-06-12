// auth.js - Complete Working Authentication
'use strict';

const auth = window.auth;
const db = window.db;

function getValue(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
}

function showMessage(message, type = 'error') {
    const msgDiv = document.getElementById('message');
    if (msgDiv) {
        msgDiv.textContent = message;
        msgDiv.className = `message ${type}`;
        msgDiv.style.display = 'block';
        setTimeout(() => {
            msgDiv.style.display = 'none';
        }, 5000);
    } else {
        alert(message);
    }
}

// ==================== SIGNUP ====================
window.signup = async function () {
    const username = getValue("username");
    const email = getValue("email");
    const password = getValue("password");
    const btn = event.target;
    
    if (!username || username.length < 3) {
        showMessage("Username must be at least 3 characters", "error");
        return;
    }
    
    if (!email || !email.includes('@')) {
        showMessage("Valid email required", "error");
        return;
    }
    
    if (!password || password.length < 6) {
        showMessage("Password must be at least 6 characters", "error");
        return;
    }
    
    btn.disabled = true;
    btn.textContent = "Creating account...";
    
    try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;
        
        await user.updateProfile({ displayName: username });
        
        // Send verification email
        await user.sendEmailVerification();
        
        // Create user profile
        await db.ref("users/" + user.uid).set({
            uid: user.uid,
            email: email,
            username: username,
            displayName: username,
            photo: "",
            status: "Available",
            online: false,
            emailVerified: false,
            friends: {},
            friendRequests: {},
            sentRequests: {},
            createdAt: Date.now(),
            lastSeen: Date.now()
        });
        
        showMessage(`✅ Verification email sent to ${email}!`, "success");
        
        // Show verification UI
        document.getElementById("signupSection").style.display = "none";
        document.getElementById("verifySection").style.display = "block";
        document.getElementById("verificationEmail").innerHTML = email;
        
        // Auto-check every 3 seconds
        const checkInterval = setInterval(async () => {
            await user.reload();
            if (user.emailVerified) {
                clearInterval(checkInterval);
                await db.ref("users/" + user.uid).update({
                    online: true,
                    emailVerified: true,
                    lastSeen: Date.now()
                });
                showMessage("Email verified! Redirecting...", "success");
                setTimeout(() => window.location.href = "chat.html", 1500);
            }
        }, 3000);
        
    } catch (err) {
        let msg = err.code === 'auth/email-already-in-use' ? "Email already registered" : err.message;
        showMessage(msg, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Sign Up";
    }
};

// ==================== CHECK VERIFICATION ====================
window.checkVerificationStatus = async function () {
    const user = auth.currentUser;
    if (!user) {
        showMessage("No user found", "error");
        return;
    }
    
    const btn = event.target;
    btn.disabled = true;
    btn.textContent = "Checking...";
    
    try {
        await user.reload();
        
        if (user.emailVerified) {
            await db.ref("users/" + user.uid).update({
                online: true,
                emailVerified: true,
                lastSeen: Date.now()
            });
            showMessage("Email verified! Redirecting...", "success");
            setTimeout(() => window.location.href = "chat.html", 1500);
        } else {
            showMessage("Email not verified yet. Check your inbox (spam folder too).", "info");
        }
    } catch (err) {
        showMessage(err.message, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "I've Verified My Email";
    }
};

// ==================== RESEND VERIFICATION ====================
window.resendVerificationEmail = async function () {
    const user = auth.currentUser;
    if (!user) {
        showMessage("No user found", "error");
        return;
    }
    
    const btn = event.target;
    btn.disabled = true;
    btn.textContent = "Sending...";
    
    try {
        await user.sendEmailVerification();
        showMessage(`✅ Verification email sent to ${user.email}!`, "success");
    } catch (err) {
        showMessage(err.message, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Resend Email";
    }
};

// ==================== LOGIN ====================
window.login = async function () {
    const email = getValue("email");
    const password = getValue("password");
    const btn = event.target;
    
    if (!email || !password) {
        showMessage("Enter email and password", "error");
        return;
    }
    
    btn.disabled = true;
    btn.textContent = "Logging in...";
    
    try {
        const cred = await auth.signInWithEmailAndPassword(email, password);
        const user = cred.user;
        
        if (!user.emailVerified) {
            showMessage("Please verify your email first. Check your inbox.", "info");
            btn.disabled = false;
            return;
        }
        
        const userSnap = await db.ref("users/" + user.uid).once("value");
        
        if (!userSnap.exists()) {
            await db.ref("users/" + user.uid).set({
                uid: user.uid,
                email: email,
                username: email.split('@')[0],
                displayName: email.split('@')[0],
                photo: "",
                status: "Available",
                online: true,
                emailVerified: true,
                friends: {},
                friendRequests: {},
                sentRequests: {},
                createdAt: Date.now(),
                lastSeen: Date.now()
            });
        } else {
            await db.ref("users/" + user.uid).update({ online: true, lastSeen: Date.now() });
        }
        
        showMessage("Login successful!", "success");
        setTimeout(() => window.location.href = "chat.html", 1500);
        
    } catch (err) {
        let msg = err.code === 'auth/user-not-found' ? "No account found" : err.message;
        showMessage(msg, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Login";
    }
};

// ==================== GOOGLE LOGIN ====================
window.googleLogin = async function () {
    const provider = new firebase.auth.GoogleAuthProvider();
    const btn = event.target;
    btn.disabled = true;
    btn.textContent = "Connecting...";
    
    try {
        const result = await auth.signInWithPopup(provider);
        const user = result.user;
        const userSnap = await db.ref("users/" + user.uid).once("value");
        
        if (!userSnap.exists()) {
            await db.ref("users/" + user.uid).set({
                uid: user.uid,
                email: user.email,
                username: user.displayName || user.email.split("@")[0],
                displayName: user.displayName || user.email.split("@")[0],
                photo: user.photoURL || "",
                status: "Available",
                online: true,
                emailVerified: true,
                friends: {},
                friendRequests: {},
                sentRequests: {},
                createdAt: Date.now(),
                lastSeen: Date.now()
            });
        } else {
            await db.ref("users/" + user.uid).update({ online: true, lastSeen: Date.now() });
        }
        
        showMessage("Google login successful!", "success");
        setTimeout(() => window.location.href = "chat.html", 1500);
        
    } catch (err) {
        showMessage(err.message, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Continue with Google";
    }
};

window.googleSignUp = window.googleLogin;

// ==================== RESET PASSWORD ====================
window.resetPassword = async function () {
    const email = getValue('email');
    if (!email) {
        showMessage('Enter your email address', 'error');
        return;
    }
    
    try {
        await auth.sendPasswordResetEmail(email);
        showMessage('Password reset email sent!', 'success');
    } catch (err) {
        showMessage(err.message, 'error');
    }
};

// ==================== LOGOUT ====================
window.logout = async function () {
    const user = auth.currentUser;
    if (user) {
        await db.ref("users/" + user.uid).update({ online: false, lastSeen: Date.now() });
    }
    await auth.signOut();
    window.location.href = "index.html";
};

// ==================== AUTH STATE ====================
auth.onAuthStateChanged(async user => {
    if (!user) return;
    try {
        const userSnap = await db.ref("users/" + user.uid).once("value");
        if (userSnap.exists() && user.emailVerified) {
            await db.ref("users/" + user.uid).update({ online: true, lastSeen: Date.now() });
            db.ref("users/" + user.uid).onDisconnect().update({ online: false, lastSeen: Date.now() });
        }
    } catch (err) {
        console.error(err);
    }
});