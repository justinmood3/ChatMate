// ==================== AUTHENTICATION SYSTEM ====================
const LOGIN_PAGE = 'login.html';
const CHAT_PAGE = 'chat.html';

document.addEventListener('DOMContentLoaded', () => {
    initAuth();
});

async function initAuth() {
    if (!window.firebase || !window.auth) {
        console.log('Waiting for Firebase...');
        setTimeout(initAuth, 100);
        return;
    }
    console.log('Firebase auth initialized successfully');
}

// ==================== HELPERS ====================
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

// Turn any name into a valid username key: lowercase letters, numbers, underscores
function toUsernameKey(name) {
    let key = String(name || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_');
    key = key.replace(/^_+|_+$/g, '');
    if (key.length < 3) key = (key + '_user').slice(0, 30);
    return key.slice(0, 30);
}

// Sends the verification email. If a "continue" link is rejected, falls back to a plain send.
async function sendVerification(user) {
    const base = window.location.href.replace(/[^/]*$/, '');
    try {
        await user.sendEmailVerification({ url: base + 'verified.html' });
    } catch (e) {
        if (e.code === 'auth/unauthorized-continue-uri' || e.code === 'auth/invalid-continue-uri') {
            await user.sendEmailVerification();
        } else {
            throw e;
        }
    }
}

// ==================== SIGNUP FUNCTION ====================
window.signup = async function (event) {
    const btn = event?.target;
    setLoading(btn, true, 'Sign Up');

    window.__signingUp = true; // stops the auth listener redirecting before the profile is saved
    let createdUser = null;
    let succeeded = false;

    try {
        const username = getValue('username');
        const email = getValue('email');
        const password = getValue('password');

        if (!username || !email || !password) {
            showMessage('Please fill all fields', 'error');
            return;
        }

        const usernameKey = username.toLowerCase();
        if (!/^[a-z0-9_]{3,30}$/.test(usernameKey)) {
            showMessage('Username: 3-30 characters, letters, numbers and underscores only.', 'error');
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

        if (!window.auth || !window.db) {
            showMessage('Firebase not initialized. Please refresh the page.', 'error');
            return;
        }

        // Quick pre-check (works while signed out)
        const taken = await window.db.ref(`usernames/${usernameKey}`).once('value');
        if (taken.exists()) {
            showMessage('Username already taken. Please choose another.', 'error');
            return;
        }

        // Create the account
        const userCredential = await window.auth.createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;
        createdUser = user;

        // Claim the username (fails if someone grabbed it in the meantime)
        try {
            await window.db.ref(`usernames/${usernameKey}`).set(user.uid);
        } catch (e) {
            console.error('Username claim failed:', e);
            await user.delete();
            createdUser = null;
            showMessage('Username already taken. Please choose another.', 'error');
            return;
        }

        // Public profile (no email here)
        await window.db.ref(`users/${user.uid}`).set({
            username: username,
            displayName: username,
            status: 'Available',
            photo: '',
            online: true,
            lastSeen: Date.now(),
            createdAt: Date.now()
        });

        // Private data
        await window.db.ref(`privateUsers/${user.uid}`).set({ email: email });

        // Send the verification email in the background; don't make signup wait for it
        sendVerification(user).catch((e) => console.warn('Verification send failed:', e.code));
        try { localStorage.setItem('verifyLastSent', String(Date.now())); } catch (e) { /* ignore */ }

        createdUser = null; // success, nothing to clean up
        succeeded = true;
        window.location.href = CHAT_PAGE;

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
        } else if (err.code === 'PERMISSION_DENIED' || /permission_denied/i.test(err.message || '')) {
            msg = 'Database permission error. Check the console and your rules.';
        }

        showMessage(msg, 'error');

        // Clean up only the account created during this attempt
        if (createdUser) {
            try {
                await window.db.ref(`usernames/${getValue('username').toLowerCase()}`).remove();
            } catch (e) { /* ignore */ }
            try {
                await createdUser.delete();
            } catch (e) {
                console.error('Cleanup failed:', e);
            }
        }
    } finally {
        if (!succeeded) window.__signingUp = false;
        setLoading(btn, false, 'Sign Up');
    }
};

// ==================== FAST VERIFICATION DETECTION ====================
// Reacts instantly when verified.html confirms the account (storage event),
// checks on tab focus, polls quickly while visible, never gives up
function watchVerification(user, onVerified) {
    let stopped = false;
    let busy = false;
    let timer = null;
    const started = Date.now();

    function cleanup() {
        stopped = true;
        clearTimeout(timer);
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('focus', check);
        window.removeEventListener('storage', onStorage);
    }

    async function check() {
        if (stopped || busy) return;
        busy = true;
        clearTimeout(timer);
        try {
            await user.reload();
            if (user.emailVerified) {
                cleanup();
                await user.getIdToken(true); // refresh token so database rules see email_verified
                onVerified();
                return;
            }
        } catch (e) {
            console.warn('Verification check failed:', e.code || e.message);
        } finally {
            busy = false;
        }
        schedule();
    }

    function schedule() {
        if (stopped || document.hidden) return; // no polling while the tab is hidden
        const delay = Date.now() - started < 120000 ? 2000 : 5000;
        timer = setTimeout(check, delay);
    }

    function onVisible() {
        if (!document.hidden) check(); // user just came back from their email
    }

    function onStorage(e) {
        if (e.key === 'emailVerifiedAt') check(); // verified.html just confirmed the account
    }

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    window.addEventListener('storage', onStorage);
    check();

    return cleanup;
}

// Kept for an optional verify screen on signup.html
function startEmailVerificationChecker(user) {
    watchVerification(user, () => {
        showMessage('Email verified! Redirecting...', 'success');
        setTimeout(() => { window.location.href = CHAT_PAGE; }, 500);
    });
}

window.checkVerificationStatus = async function (event) {
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
            await user.getIdToken(true);
            window.location.href = CHAT_PAGE;
        } else {
            showMessage('Email not verified yet. Please check your inbox (and spam folder).', 'info');
        }
    } catch (err) {
        console.error('Check verification error:', err);
        showMessage('Error checking verification status.', 'error');
    } finally {
        setLoading(btn, false, '✅ I\'ve Verified');
    }
};

window.resendVerificationEmail = async function (event) {
    const btn = event?.target;
    setLoading(btn, true, 'Resend');
    try {
        const user = window.auth.currentUser;
        if (!user) {
            showMessage('No user found. Please sign up again.', 'error');
            return;
        }
        await sendVerification(user);
        showMessage('Verification email resent! Please check your inbox and spam folder.', 'success');
    } catch (err) {
        console.error('Resend email error:', err);
        showMessage(err.code === 'auth/too-many-requests'
            ? 'Too many requests. Please try again later.'
            : 'Failed to resend verification email.', 'error');
    } finally {
        setLoading(btn, false, '📧 Resend Email');
    }
};

// ==================== VERIFY BANNER (shown on app pages) ====================
function showVerifyBanner(user) {
    if (document.getElementById('verifyBanner') || !document.body) return;

    const bar = document.createElement('div');
    bar.id = 'verifyBanner';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#fff3cd;color:#664d03;' +
        'padding:8px 16px;font-size:14px;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap';
    bar.innerHTML = '<span>Verify your email to unlock messaging and friend requests.</span>';

    const btnStyle = 'width:auto;margin:0;padding:6px 12px;border:none;border-radius:6px;cursor:pointer;background:#667eea;color:#fff';

    const resend = document.createElement('button');
    resend.textContent = 'Resend email';
    resend.style.cssText = btnStyle;
    resend.onclick = async () => {
        let last = 0;
        try { last = Number(localStorage.getItem('verifyLastSent') || 0); } catch (e) { /* ignore */ }
        const wait = 60000 - (Date.now() - last);
        if (wait > 0) {
            alert('Please wait ' + Math.ceil(wait / 1000) + ' seconds before resending.');
            return;
        }
        try {
            await sendVerification(user);
            try { localStorage.setItem('verifyLastSent', String(Date.now())); } catch (e) { /* ignore */ }
            alert('Verification email sent. Check your inbox and spam folder.');
        } catch (e) {
            alert(e.code === 'auth/too-many-requests'
                ? 'Too many requests. Please try again later.'
                : 'Could not send email: ' + e.code);
        }
    };

    const done = document.createElement('button');
    done.textContent = "I've verified";
    done.style.cssText = btnStyle;
    done.onclick = async () => {
        await user.reload();
        if (user.emailVerified) {
            await user.getIdToken(true);
            bar.remove();
        } else {
            alert('Not verified yet.');
        }
    };

    bar.append(resend, done);
    document.body.prepend(bar);

    watchVerification(user, () => {
        bar.remove();
        showMessage('Email verified! Messaging is unlocked.', 'success');
    });
}

// ==================== LOGIN FUNCTION ====================
window.login = async function (event) {
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

        const userCredential = await window.auth.signInWithEmailAndPassword(email, password);
        const user = userCredential.user;

        if (window.db) {
            await window.db.ref(`users/${user.uid}`).update({
                online: true,
                lastSeen: Date.now()
            });
        }

        showMessage('Login successful! Redirecting...', 'success');
        window.location.href = CHAT_PAGE;

    } catch (err) {
        console.error('Login error:', err);

        let msg = 'Login failed. Please try again.';
        if (err.code === 'auth/user-not-found') {
            msg = 'No account found with this email. Please sign up first.';
        } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
            msg = 'Incorrect email or password. Please try again.';
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
window.googleLogin = async function (event) {
    const btn = event?.target;
    setLoading(btn, true, 'Continue with Google');
    window.__signingUp = true;
    let succeeded = false;

    try {
        if (!window.auth) {
            throw new Error('Firebase not initialized');
        }

        const provider = new firebase.auth.GoogleAuthProvider();
        provider.addScope('email');
        provider.addScope('profile');

        const result = await window.auth.signInWithPopup(provider);
        const user = result.user;

        if (window.db) {
            const snap = await window.db.ref(`users/${user.uid}`).once('value');
            const fallbackName = (user.displayName || user.email.split('@')[0]).slice(0, 50);

            if (!snap.exists()) {
                let key = toUsernameKey(user.displayName || user.email.split('@')[0]);
                const existing = await window.db.ref(`usernames/${key}`).once('value');
                if (existing.exists()) {
                    key = (key.slice(0, 21) + '_' + user.uid.slice(0, 8).toLowerCase())
                        .replace(/[^a-z0-9_]/g, '_');
                }
                await window.db.ref(`usernames/${key}`).set(user.uid);

                await window.db.ref(`users/${user.uid}`).set({
                    username: key,
                    displayName: fallbackName,
                    status: 'Available',
                    photo: user.photoURL || '',
                    online: true,
                    lastSeen: Date.now(),
                    createdAt: Date.now()
                });

                await window.db.ref(`privateUsers/${user.uid}`).set({ email: user.email || '' });
            } else {
                await window.db.ref(`users/${user.uid}`).update({
                    online: true,
                    lastSeen: Date.now(),
                    photo: user.photoURL || ''
                });
            }
        }

        succeeded = true;
        window.location.href = CHAT_PAGE;

    } catch (err) {
        console.error('Google login error:', err);

        if (err.code === 'auth/popup-blocked') {
            showMessage('Popup blocked! Please allow popups for this website and try again.', 'error');
        } else if (err.code === 'auth/cancelled-popup-request' || err.code === 'auth/popup-closed-by-user') {
            showMessage('Login cancelled. Please try again.', 'error');
        } else if (err.code === 'auth/account-exists-with-different-credential') {
            showMessage('An account already exists with the same email address but different sign-in method.', 'error');
        } else {
            showMessage('Google login failed: ' + (err.message || 'Unknown error'), 'error');
        }
    } finally {
        if (!succeeded) window.__signingUp = false;
        setLoading(btn, false, 'Continue with Google');
    }
};

window.googleSignUp = window.googleLogin;

// ==================== RESET PASSWORD ====================
window.resetPassword = async function () {
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

// ==================== LOGOUT ====================
window.logout = async function () {
    try {
        if (window.auth && window.auth.currentUser && window.db) {
            await window.db.ref(`users/${window.auth.currentUser.uid}`).update({
                online: false,
                lastSeen: Date.now()
            });
        }

        await window.auth.signOut();
        window.location.href = LOGIN_PAGE;
    } catch (err) {
        console.error('Logout error:', err);
        alert('Error logging out. Please try again.');
    }
};

// ==================== AUTO-REDIRECT BASED ON AUTH STATE ====================
window.auth?.onAuthStateChanged((user) => {
    const page = window.location.pathname.split('/').pop() || '';
    const isAuthPage = ['', 'index.html', 'login.html', 'signup.html'].includes(page);

    if (user) {
        if (isAuthPage) {
            if (!window.__signingUp) window.location.href = CHAT_PAGE;
        } else if (!user.emailVerified) {
            showVerifyBanner(user);
        }
    } else if (!isAuthPage) {
        window.location.href = LOGIN_PAGE;
    }
});

// ==================== DEBUG HELPER (remove in production) ====================
window.debugAuth = function () {
    console.log('=== Auth Debug Info ===');
    console.log('Firebase initialized:', !!window.firebase);
    console.log('Auth available:', !!window.auth);
    console.log('DB available:', !!window.db);
    console.log('Current user:', window.auth?.currentUser?.email || 'None');
    console.log('Email verified:', window.auth?.currentUser?.emailVerified);
    console.log('Current path:', window.location.pathname);
    console.log('=======================');
};

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