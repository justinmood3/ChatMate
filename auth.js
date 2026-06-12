// ==================== AUTHENTICATION SYSTEM ====================
// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
});

async function initAuth() {
    // Wait for Firebase to be ready
    if (!window.firebase || !window.auth) {
        console.log('Waiting for Firebase...');
        setTimeout(initAuth, 100);
        return;
    }
    
    console.log('Firebase auth initialized successfully');
    
    // Check if user is already logged in
    const user = window.auth.currentUser;
    if (user && window.location.pathname.includes('index.html') && user.emailVerified) {
        window.location.href = 'chat.html';
    }
}

// Helper functions
function showMessage(msg, type = 'error') {
    const msgDiv = document.getElementById('message');
    if (msgDiv) {
        msgDiv.textContent = msg;
        msgDiv.className = `message ${type}`;
        msgDiv.style.display = 'block';
        setTimeout(() => { 
            if (msgDiv) msgDiv.style.display = 'none'; 
        }, 5000);
    } else {
        // Fallback if message div doesn't exist
        alert(msg);
    }
}

function getValue(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
}

function setLoading(btn, isLoading, originalText = '') {
    if (!btn) return;
    if (isLoading) {
        btn.disabled = true;
        btn.originalText = btn.textContent;
        btn.textContent = 'Loading...';
    } else {
        btn.disabled = false;
        btn.textContent = btn.originalText || originalText;
    }
}

// ==================== SIGNUP FUNCTION ====================
window.signup = async function(event) {
    const btn = event?.target;
    setLoading(btn, true, 'Sign Up');
    
    try {
        const username = getValue('username');
        const email = getValue('email');
        const password = getValue('password');
        
        // Validation
        if (!username || !email || !password) {
            showMessage('Please fill all fields', 'error');
            return;
        }
        
        if (username.length < 3) {
            showMessage('Username must be at least 3 characters', 'error');
            return;
        }
        
        if (password.length < 6) {
            showMessage('Password must be at least 6 characters', 'error');
            return;
        }
        
        if (!email.includes('@')) {
            showMessage('Please enter a valid email address', 'error');
            return;
        }
        
        // Check if username exists in database
        if (window.db) {
            const usersRef = window.db.ref('users');
            const snapshot = await usersRef.orderByChild('username').equalTo(username).once('value');
            if (snapshot.exists()) {
                showMessage('Username already taken. Please choose another.', 'error');
                return;
            }
        }
        
        // Create user with email and password
        const userCredential = await window.auth.createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;
        
        // Send verification email
        await user.sendEmailVerification();
        
        // Save user data to database
        if (window.db) {
            await window.db.ref(`users/${user.uid}`).set({
                username: username,
                email: email,
                displayName: username,
                status: 'Available',
                photo: '',
                online: false,
                lastSeen: Date.now(),
                createdAt: Date.now(),
                friends: {},
                friendRequests: {},
                sentRequests: {}
            });
        }
        
        // Show verification section
        const signupSection = document.getElementById('signupSection');
        const verifySection = document.getElementById('verifySection');
        const verificationEmail = document.getElementById('verificationEmail');
        
        if (signupSection) signupSection.style.display = 'none';
        if (verifySection) verifySection.style.display = 'block';
        if (verificationEmail) verificationEmail.textContent = email;
        
        showMessage('Verification email sent! Please check your inbox.', 'success');
        
        // Start checking for email verification
        startEmailVerificationChecker(user);
        
    } catch (err) {
        console.error('Signup error:', err);
        
        let msg = 'Signup failed. Please try again.';
        if (err.code === 'auth/email-already-in-use') {
            msg = 'Email already registered. Please login instead.';
        } else if (err.code === 'auth/invalid-email') {
            msg = 'Invalid email address format.';
        } else if (err.code === 'auth/weak-password') {
            msg = 'Password is too weak. Use at least 6 characters.';
        } else if (err.code === 'auth/operation-not-allowed') {
            msg = 'Email/password signup is disabled. Contact support.';
        }
        
        showMessage(msg, 'error');
        
        // Clean up - delete the user if creation succeeded but something else failed
        if (err.code !== 'auth/email-already-in-use' && window.auth.currentUser) {
            await window.auth.currentUser.delete();
        }
    } finally {
        setLoading(btn, false, 'Sign Up');
    }
};

// ==================== EMAIL VERIFICATION CHECKER ====================
let verificationInterval = null;

function startEmailVerificationChecker(user) {
    let attempts = 0;
    const maxAttempts = 40; // 2 minutes max (3 seconds * 40)
    
    if (verificationInterval) clearInterval(verificationInterval);
    
    verificationInterval = setInterval(async () => {
        attempts++;
        
        if (attempts > maxAttempts) {
            clearInterval(verificationInterval);
            showMessage('Verification taking too long. You can click "Resend Email" or "I\'ve Verified" manually.', 'info');
            return;
        }
        
        try {
            await user.reload();
            
            if (user.emailVerified) {
                clearInterval(verificationInterval);
                showMessage('Email verified successfully! Redirecting to chat...', 'success');
                
                // Update online status
                if (window.db) {
                    await window.db.ref(`users/${user.uid}`).update({
                        online: true,
                        lastSeen: Date.now()
                    });
                }
                
                setTimeout(() => {
                    window.location.href = 'chat.html';
                }, 2000);
            }
        } catch (err) {
            console.error('Verification check error:', err);
        }
    }, 3000);
}

// ==================== CHECK VERIFICATION STATUS ====================
window.checkVerificationStatus = async function(event) {
    const btn = event?.target;
    setLoading(btn, true, 'Check');
    
    try {
        const user = window.auth.currentUser;
        if (!user) {
            showMessage('No user found. Please sign up again.', 'error');
            return;
        }
        
        await user.reload();
        
        if (user.emailVerified) {
            if (verificationInterval) clearInterval(verificationInterval);
            showMessage('Email verified! Redirecting to chat...', 'success');
            
            if (window.db) {
                await window.db.ref(`users/${user.uid}`).update({
                    online: true,
                    lastSeen: Date.now()
                });
            }
            
            setTimeout(() => {
                window.location.href = 'chat.html';
            }, 1500);
        } else {
            showMessage('Email not verified yet. Please check your inbox (and spam folder).', 'info');
        }
    } catch (err) {
        console.error('Check verification error:', err);
        showMessage('Error checking verification status.', 'error');
    } finally {
        setLoading(btn, false, 'I\'ve Verified');
    }
};

// ==================== RESEND VERIFICATION EMAIL ====================
window.resendVerificationEmail = async function(event) {
    const btn = event?.target;
    setLoading(btn, true, 'Resend');
    
    try {
        const user = window.auth.currentUser;
        if (!user) {
            showMessage('No user found. Please sign up again.', 'error');
            return;
        }
        
        await user.sendEmailVerification();
        showMessage('Verification email resent! Please check your inbox and spam folder.', 'success');
    } catch (err) {
        console.error('Resend email error:', err);
        
        let msg = 'Failed to resend verification email.';
        if (err.code === 'auth/too-many-requests') {
            msg = 'Too many requests. Please try again later.';
        }
        showMessage(msg, 'error');
    } finally {
        setLoading(btn, false, 'Resend Email');
    }
};

// ==================== LOGIN FUNCTION ====================
window.login = async function(event) {
    const btn = event?.target;
    setLoading(btn, true, 'Login');
    
    try {
        const email = getValue('email');
        const password = getValue('password');
        
        if (!email || !password) {
            showMessage('Please enter both email and password', 'error');
            return;
        }
        
        if (!window.auth) {
            showMessage('Firebase not initialized. Please refresh the page.', 'error');
            return;
        }
        
        // Attempt login
        const userCredential = await window.auth.signInWithEmailAndPassword(email, password);
        const user = userCredential.user;
        
        // Check if email is verified
        if (!user.emailVerified) {
            await window.auth.signOut();
            showMessage('Please verify your email first. Check your inbox and spam folder.', 'error');
            return;
        }
        
        // Update online status in database
        if (window.db) {
            await window.db.ref(`users/${user.uid}`).update({
                online: true,
                lastSeen: Date.now()
            });
        }
        
        showMessage('Login successful! Redirecting...', 'success');
        
        setTimeout(() => {
            window.location.href = 'chat.html';
        }, 1500);
        
    } catch (err) {
        console.error('Login error:', err);
        
        let msg = 'Login failed. Please try again.';
        if (err.code === 'auth/user-not-found') {
            msg = 'No account found with this email. Please sign up first.';
        } else if (err.code === 'auth/wrong-password') {
            msg = 'Incorrect password. Please try again.';
        } else if (err.code === 'auth/invalid-email') {
            msg = 'Invalid email format.';
        } else if (err.code === 'auth/too-many-requests') {
            msg = 'Too many failed attempts. Please try again later.';
        } else if (err.code === 'auth/user-disabled') {
            msg = 'This account has been disabled. Contact support.';
        }
        
        showMessage(msg, 'error');
    } finally {
        setLoading(btn, false, 'Login');
    }
};

// ==================== GOOGLE LOGIN ====================
window.googleLogin = async function(event) {
    const btn = event?.target;
    setLoading(btn, true, 'Google');
    
    try {
        if (!window.auth) {
            throw new Error('Firebase not initialized');
        }
        
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.addScope('email');
        provider.addScope('profile');
        
        const result = await window.auth.signInWithPopup(provider);
        const user = result.user;
        
        // Check if user exists in database
        if (window.db) {
            const userRef = await window.db.ref(`users/${user.uid}`).once('value');
            
            if (!userRef.exists()) {
                // Create new user profile
                await window.db.ref(`users/${user.uid}`).set({
                    username: user.displayName || user.email.split('@')[0],
                    email: user.email,
                    displayName: user.displayName || user.email.split('@')[0],
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
                // Update existing user
                await window.db.ref(`users/${user.uid}`).update({
                    online: true,
                    lastSeen: Date.now(),
                    photo: user.photoURL || '',
                    displayName: user.displayName
                });
            }
        }
        
        showMessage('Login successful! Redirecting...', 'success');
        
        setTimeout(() => {
            window.location.href = 'chat.html';
        }, 1500);
        
    } catch (err) {
        console.error('Google login error:', err);
        
        if (err.code === 'auth/popup-blocked') {
            showMessage('Popup blocked! Please allow popups for this website and try again.', 'error');
        } else if (err.code === 'auth/cancelled-popup-request') {
            showMessage('Login cancelled. Please try again.', 'error');
        } else if (err.code === 'auth/account-exists-with-different-credential') {
            showMessage('An account already exists with the same email address but different sign-in method.', 'error');
        } else {
            showMessage('Google login failed: ' + (err.message || 'Unknown error'), 'error');
        }
    } finally {
        setLoading(btn, false, 'Continue with Google');
    }
};

// ==================== GOOGLE SIGNUP (for signup page) ====================
window.googleSignUp = window.googleLogin;

// ==================== RESET PASSWORD ====================
window.resetPassword = async function() {
    const email = prompt('Enter your email address to reset your password:');
    if (!email) return;
    
    if (!window.auth) {
        alert('Firebase not initialized. Please refresh the page.');
        return;
    }
    
    try {
        await window.auth.sendPasswordResetEmail(email);
        alert('Password reset email sent! Check your inbox and spam folder.');
    } catch (err) {
        console.error('Reset password error:', err);
        
        let msg = 'Failed to send reset email.';
        if (err.code === 'auth/user-not-found') {
            msg = 'No account found with this email address.';
        } else if (err.code === 'auth/invalid-email') {
            msg = 'Invalid email address.';
        } else if (err.code === 'auth/too-many-requests') {
            msg = 'Too many requests. Please try again later.';
        }
        alert(msg);
    }
};

// ==================== LOGOUT FUNCTION (for other pages) ====================
window.logout = async function() {
    try {
        if (window.auth && window.auth.currentUser && window.db) {
            await window.db.ref(`users/${window.auth.currentUser.uid}`).update({
                online: false,
                lastSeen: Date.now()
            });
        }
        
        await window.auth.signOut();
        window.location.href = 'index.html';
    } catch (err) {
        console.error('Logout error:', err);
        alert('Error logging out. Please try again.');
    }
};

// ==================== AUTO-REDIRECT BASED ON AUTH STATE ====================
window.auth?.onAuthStateChanged(async (user) => {
    const currentPath = window.location.pathname;
    
    if (user) {
        // User is logged in
        if (user.emailVerified) {
            // On login/signup pages, redirect to chat
            if (currentPath.includes('index.html') || currentPath.includes('signup.html')) {
                window.location.href = 'chat.html';
            }
        } else {
            // Email not verified - only allow on signup page
            if (!currentPath.includes('signup.html')) {
                await window.auth.signOut();
                window.location.href = 'signup.html';
            }
        }
    } else {
        // User is not logged in
        if (currentPath.includes('chat.html')) {
            window.location.href = 'index.html';
        }
    }
});

// ==================== DEBUG HELPER (remove in production) ====================
window.debugAuth = function() {
    console.log('=== Auth Debug Info ===');
    console.log('Firebase initialized:', !!window.firebase);
    console.log('Auth available:', !!window.auth);
    console.log('DB available:', !!window.db);
    console.log('Current user:', window.auth?.currentUser?.email || 'None');
    console.log('Current path:', window.location.pathname);
    console.log('=======================');
};

// Log when auth is ready
window.addEventListener('load', () => {
    setTimeout(() => {
        if (window.auth) {
            console.log('✅ Firebase Auth is ready');
        } else {
            console.error('❌ Firebase Auth failed to initialize');
            showMessage('Loading authentication... Please refresh if this persists.', 'info');
        }
    }, 500);
});