// ==================== AUTHENTICATION SYSTEM ====================
// Helper functions
function showMessage(msg, type = 'error') {
    const msgDiv = document.getElementById('message');
    if (msgDiv) {
        msgDiv.textContent = msg;
        msgDiv.className = `message ${type}`;
        msgDiv.style.display = 'block';
        setTimeout(() => { msgDiv.style.display = 'none'; }, 5000);
    }
}

function getValue(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
}

// ==================== SIGNUP ====================
window.signup = async function(event) {
    const btn = event?.target;
    if (btn) btn.disabled = true;
    
    try {
        const username = getValue('username');
        const email = getValue('email');
        const password = getValue('password');
        
        if (!username || !email || !password) {
            showMessage('Please fill all fields', 'error');
            return;
        }
        
        if (password.length < 6) {
            showMessage('Password must be at least 6 characters', 'error');
            return;
        }
        
        // Check if username exists
        const usersRef = window.db.ref('users');
        const snapshot = await usersRef.orderByChild('username').equalTo(username).once('value');
        if (snapshot.exists()) {
            showMessage('Username already taken', 'error');
            return;
        }
        
        // Create user
        const userCredential = await window.auth.createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;
        
        // Send verification email
        await user.sendEmailVerification();
        
        // Save user data
        await window.db.ref(`users/${user.uid}`).set({
            username: username,
            email: email,
            displayName: username,
            status: 'Available',
            photo: '',
            online: true,
            lastSeen: Date.now(),
            createdAt: Date.now(),
            friends: {},
            friendRequests: {},
            sentRequests: {}
        });
        
        // Show verification section
        const signupSection = document.getElementById('signupSection');
        const verifySection = document.getElementById('verifySection');
        const verificationEmail = document.getElementById('verificationEmail');
        
        if (signupSection) signupSection.style.display = 'none';
        if (verifySection) verifySection.style.display = 'block';
        if (verificationEmail) verificationEmail.textContent = email;
        
        showMessage('Verification email sent! Check your inbox.', 'success');
        
        // Start verification checker
        startVerificationChecker(user);
        
    } catch (err) {
        console.error(err);
        let msg = err.message;
        if (err.code === 'auth/email-already-in-use') msg = 'Email already registered';
        if (err.code === 'auth/invalid-email') msg = 'Invalid email address';
        if (err.code === 'auth/weak-password') msg = 'Password too weak';
        showMessage(msg, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
};

// ==================== VERIFICATION CHECKER ====================
let verificationInterval = null;

function startVerificationChecker(user) {
    let attempts = 0;
    const maxAttempts = 40;
    
    if (verificationInterval) clearInterval(verificationInterval);
    
    verificationInterval = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
            clearInterval(verificationInterval);
            showMessage('Verification taking too long. Click "Resend Email".', 'info');
            return;
        }
        
        await user.reload();
        if (user.emailVerified) {
            clearInterval(verificationInterval);
            showMessage('Email verified! Redirecting...', 'success');
            setTimeout(() => {
                window.location.href = 'chat.html';
            }, 1500);
        }
    }, 3000);
}

// ==================== CHECK VERIFICATION ====================
window.checkVerificationStatus = async function(event) {
    const btn = event?.target;
    if (btn) btn.disabled = true;
    
    try {
        const user = window.auth.currentUser;
        if (!user) {
            showMessage('No user found', 'error');
            return;
        }
        
        await user.reload();
        
        if (user.emailVerified) {
            if (verificationInterval) clearInterval(verificationInterval);
            showMessage('Email verified! Redirecting...', 'success');
            setTimeout(() => {
                window.location.href = 'chat.html';
            }, 1500);
        } else {
            showMessage('Not verified yet. Check your email or click Resend.', 'info');
        }
    } catch (err) {
        showMessage(err.message, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
};

// ==================== RESEND VERIFICATION ====================
window.resendVerificationEmail = async function(event) {
    const btn = event?.target;
    if (btn) btn.disabled = true;
    
    try {
        const user = window.auth.currentUser;
        if (!user) {
            showMessage('No user found', 'error');
            return;
        }
        
        await user.sendEmailVerification();
        showMessage('Verification email resent! Check your inbox.', 'success');
    } catch (err) {
        showMessage(err.message, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
};

// ==================== LOGIN ====================
window.login = async function(event) {
    const btn = event?.target;
    if (btn) btn.disabled = true;
    
    try {
        const email = getValue('email');
        const password = getValue('password');
        
        if (!email || !password) {
            showMessage('Please fill all fields', 'error');
            return;
        }
        
        const userCredential = await window.auth.signInWithEmailAndPassword(email, password);
        const user = userCredential.user;
        
        if (!user.emailVerified) {
            await window.auth.signOut();
            showMessage('Please verify your email first. Check your inbox.', 'error');
            return;
        }
        
        // Update online status
        await window.db.ref(`users/${user.uid}`).update({
            online: true,
            lastSeen: Date.now()
        });
        
        showMessage('Login successful!', 'success');
        window.location.href = 'chat.html';
        
    } catch (err) {
        console.error(err);
        let msg = 'Login failed';
        if (err.code === 'auth/user-not-found') msg = 'User not found';
        if (err.code === 'auth/wrong-password') msg = 'Wrong password';
        if (err.code === 'auth/invalid-email') msg = 'Invalid email';
        if (err.code === 'auth/too-many-requests') msg = 'Too many attempts. Try later';
        showMessage(msg, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
};

// ==================== GOOGLE LOGIN ====================
window.googleLogin = async function(event) {
    const btn = event?.target;
    if (btn) btn.disabled = true;
    
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const result = await window.auth.signInWithPopup(provider);
        const user = result.user;
        
        // Check if user exists in database
        const userRef = await window.db.ref(`users/${user.uid}`).once('value');
        
        if (!userRef.exists()) {
            // Create new user profile
            await window.db.ref(`users/${user.uid}`).set({
                username: user.displayName || user.email.split('@')[0],
                email: user.email,
                displayName: user.displayName,
                status: 'Available',
                photo: user.photoURL || '',
                online: true,
                lastSeen: Date.now(),
                createdAt: Date.now(),
                friends: {},
                friendRequests: {},
                sentRequests: {}
            });
        } else {
            // Update online status
            await window.db.ref(`users/${user.uid}`).update({
                online: true,
                lastSeen: Date.now()
            });
        }
        
        showMessage('Login successful!', 'success');
        window.location.href = 'chat.html';
        
    } catch (err) {
        console.error(err);
        if (err.code === 'auth/popup-blocked') {
            showMessage('Popup blocked. Please allow popups for this site.', 'error');
        } else {
            showMessage(err.message, 'error');
        }
    } finally {
        if (btn) btn.disabled = false;
    }
};

// ==================== GOOGLE SIGNUP (for signup page) ====================
window.googleSignUp = window.googleLogin;

// ==================== RESET PASSWORD ====================
window.resetPassword = async function() {
    const email = prompt('Enter your email address to reset password:');
    if (!email) return;
    
    try {
        await window.auth.sendPasswordResetEmail(email);
        alert('Password reset email sent! Check your inbox.');
    } catch (err) {
        let msg = err.message;
        if (err.code === 'auth/user-not-found') msg = 'No account found with this email';
        alert(msg);
    }
};

// ==================== AUTO-REDIRECT IF LOGGED IN ====================
window.auth.onAuthStateChanged(async (user) => {
    if (user && window.location.pathname.includes('signup.html')) {
        if (user.emailVerified) {
            window.location.href = 'chat.html';
        }
    }
});