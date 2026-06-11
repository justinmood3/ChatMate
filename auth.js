// auth.js - Firebase Email Verification (No EmailJS)
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

// ==================== SIGNUP WITH FIREBASE EMAIL VERIFICATION ====================
window.signup = async function () {
    console.log("Signup function called");
    
    const username = getValue("username");
    const email = getValue("email");
    const password = getValue("password");
    const btn = event.target;
    
    // Validation
    if (!username) {
        showMessage("Please enter a username", "error");
        return;
    }
    
    if (username.length < 3) {
        showMessage("Username must be at least 3 characters", "error");
        return;
    }
    
    if (!email) {
        showMessage("Please enter an email address", "error");
        return;
    }
    
    if (!email.includes('@')) {
        showMessage("Please enter a valid email address", "error");
        return;
    }
    
    if (!password) {
        showMessage("Please enter a password", "error");
        return;
    }
    
    if (password.length < 6) {
        showMessage("Password must be at least 6 characters", "error");
        return;
    }

    btn.disabled = true;
    btn.textContent = "Creating account...";

    try {
        // Create user in Firebase Auth
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;
        
        console.log("User created:", user.uid);
        
        // Update profile with username
        await user.updateProfile({ displayName: username });
        
        // Send verification email (Firebase built-in)
        await user.sendEmailVerification();
        console.log("Verification email sent to:", email);
        
        // Create user profile in database (email not verified yet)
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
        
        showMessage(`Verification email sent to ${email}! Please check your inbox.`, "success");
        
        // Show verification UI, hide signup UI
        const signupSection = document.getElementById("signupSection");
        const verifySection = document.getElementById("verifySection");
        const verificationEmail = document.getElementById("verificationEmail");
        
        if (signupSection) signupSection.style.display = "none";
        if (verifySection) verifySection.style.display = "block";
        if (verificationEmail) verificationEmail.textContent = email;
        
    } catch (err) {
        console.error("Signup error:", err);
        
        let errorMessage = "";
        if (err.code === 'auth/email-already-in-use') {
            errorMessage = "Email already registered. Please login.";
        } else if (err.code === 'auth/weak-password') {
            errorMessage = "Password is too weak. Use at least 6 characters.";
        } else if (err.code === 'auth/invalid-email') {
            errorMessage = "Invalid email address.";
        } else {
            errorMessage = err.message || "Signup failed. Please try again.";
        }
        
        showMessage(errorMessage, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Sign Up";
    }
};

// ==================== CHECK VERIFICATION STATUS ====================
window.checkVerificationStatus = async function () {
    const user = auth.currentUser;
    if (!user) {
        showMessage("No user found. Please sign up again.", "error");
        return;
    }
    
    const btn = event.target;
    btn.disabled = true;
    btn.textContent = "Checking...";
    
    try {
        // Reload user to get latest emailVerified status
        await user.reload();
        
        if (user.emailVerified) {
            // Update database
            await db.ref("users/" + user.uid).update({
                online: true,
                emailVerified: true,
                lastSeen: Date.now()
            });
            
            showMessage("Email verified! Redirecting to chat...", "success");
            setTimeout(() => {
                window.location.href = "chat.html";
            }, 1500);
        } else {
            showMessage("Email not verified yet. Please check your inbox and click the verification link.", "info");
        }
    } catch (err) {
        console.error("Check verification error:", err);
        showMessage(err.message, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "I've Verified My Email";
    }
};

// ==================== RESEND VERIFICATION EMAIL ====================
window.resendVerificationEmail = async function () {
    const user = auth.currentUser;
    if (!user) {
        showMessage("No user found. Please sign up again.", "error");
        return;
    }
    
    const btn = event.target;
    btn.disabled = true;
    btn.textContent = "Sending...";
    
    try {
        await user.sendEmailVerification();
        showMessage(`Verification email sent to ${user.email}!`, "success");
    } catch (err) {
        console.error("Resend error:", err);
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
        
        // Check if email is verified
        if (!user.emailVerified) {
            showMessage("Please verify your email first. Check your inbox.", "info");
            btn.disabled = false;
            btn.textContent = "Login";
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
            await db.ref("users/" + user.uid).update({
                online: true,
                lastSeen: Date.now()
            });
        }
        
        showMessage("Login successful!", "success");
        setTimeout(() => {
            window.location.href = "chat.html";
        }, 1500);
        
    } catch (err) {
        console.error(err);
        let errorMessage = err.code === 'auth/user-not-found' ? "No account found. Please sign up." :
                          err.code === 'auth/wrong-password' ? "Incorrect password." : err.message;
        showMessage(errorMessage, "error");
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
            await db.ref("users/" + user.uid).update({
                online: true,
                lastSeen: Date.now()
            });
        }
        
        showMessage("Google login successful!", "success");
        setTimeout(() => {
            window.location.href = "chat.html";
        }, 1500);
        
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
        await db.ref("users/" + user.uid).update({
            online: false,
            lastSeen: Date.now()
        });
    }
    await auth.signOut();
    window.location.href = "index.html";
};

// ==================== AUTH STATE ====================
auth.onAuthStateChanged(async user => {
    console.log("Auth state changed:", user ? user.uid : "No user");
    if (!user) return;
    
    try {
        const userSnap = await db.ref("users/" + user.uid).once("value");
        if (userSnap.exists()) {
            if (user.emailVerified) {
                await db.ref("users/" + user.uid).update({
                    online: true,
                    lastSeen: Date.now()
                });
            }
            db.ref("users/" + user.uid).onDisconnect().update({
                online: false,
                lastSeen: Date.now()
            });
        }
    } catch (err) {
        console.error("Auth state error:", err);
    }
});