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

// ==================== PROFILE: saved ONLY after the email is verified ====================
async function ensureProfile(user) {
    try {
        await createProfileOnce(user);
    } catch (e) {
        // Two tabs (the waiting tab and verified.html) can run this at the same moment.
        // If the other one finished the job, that is fine.
        await new Promise((r) => setTimeout(r, 1500));
        const done = await window.db.ref(`users/${user.uid}/username`).once('value');
        if (!done.exists()) throw e;
    }
}

async function createProfileOnce(user) {
    const userRef = window.db.ref(`users/${user.uid}`);
    if ((await userRef.child('username').once('value')).exists()) return; // real profile already saved

    const temp = (await window.db.ref(`tempVerification/${user.uid}`).once('value')).val() || {};
    let key = toUsernameKey(temp.username || (user.email || 'user').split('@')[0]);

    const taken = await window.db.ref(`usernames/${key}`).once('value');
    if (taken.exists() && taken.val() !== user.uid) {
        // someone else took it while this user was verifying
        key = (key.slice(0, 21) + '_' + user.uid.slice(0, 8).toLowerCase()).replace(/[^a-z0-9_]/g, '_');
    }
    if (!(taken.exists() && taken.val() === user.uid)) {
        await window.db.ref(`usernames/${key}`).set(user.uid);
    }

    await userRef.set({
        username: temp.username || key,
        displayName: temp.username || key,
        status: 'Available',
        photo: user.photoURL || '',
        online: true,
        lastSeen: Date.now(),
        createdAt: Date.now()
    });
    await window.db.ref(`privateUsers/${user.uid}`).set({ email: user.email || '' });
    await window.db.ref(`tempVerification/${user.uid}`).remove();
}

// Deletes an unverified account and its temporary data
async function cancelSignup() {
    const user = window.auth.currentUser;
    if (!user || user.emailVerified) return; // never delete a verified user
    try {
        // Old account that already has a saved profile (friends, messages): never delete it, only sign out
        const hasProfile = (await window.db.ref(`users/${user.uid}/username`).once('value')).exists();
        if (hasProfile) { await window.auth.signOut(); return; }
    } catch (e) { /* ignore */ }
    try { await window.db.ref(`tempVerification/${user.uid}`).remove(); } catch (e) { /* ignore */ }
    try { await user.delete(); } catch (e) { await window.auth.signOut(); }
}

// Waiting screen: blocks the page until verified, then redirects to the home page
function showWaitingScreen(user) {
    if (document.getElementById('verifyWait') || !document.body) return;
    const WAIT_MS = 10 * 60 * 1000; // 10 minutes, change if you want
    const endAt = Date.now() + WAIT_MS;

    const overlay = document.createElement('div');
    overlay.id = 'verifyWait';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.75);' +
        'display:flex;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML =
        '<div style="background:#fff;color:#222;max-width:380px;width:100%;border-radius:12px;padding:24px;text-align:center;font-family:sans-serif">' +
        '<h3 style="margin:0 0 8px">Verify your email</h3>' +
        '<p style="margin:0 0 8px">We sent a link to <b id="vwEmail"></b>. Open it, then come back here.</p>' +
        '<p style="margin:0 0 16px;font-size:13px;color:#666">Time left: <span id="vwTime"></span>. ' +
        'If it is not verified, your signup is cancelled.</p></div>';
    const box = overlay.firstChild;
    box.querySelector('#vwEmail').textContent = user.email || '';

    const btnStyle = 'width:auto;margin:4px;padding:8px 14px;border:none;border-radius:6px;cursor:pointer;background:#667eea;color:#fff';
    const resend = document.createElement('button');
    resend.textContent = 'Resend email';
    resend.style.cssText = btnStyle;
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel signup';
    cancel.style.cssText = btnStyle.replace('#667eea', '#999');
    box.append(resend, cancel);
    document.body.appendChild(overlay);

    let stopWatch = () => {};
    const ticker = setInterval(async () => {
        const left = endAt - Date.now();
        const s = Math.max(0, Math.ceil(left / 1000));
        const t = document.getElementById('vwTime');
        if (t) t.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
        if (left <= 0) {
            clearInterval(ticker);
            stopWatch();
            await cancelSignup();
            alert('Email was not verified in time. Please sign up again.');
            window.location.href = 'signup.html';
        }
    }, 1000);

    resend.onclick = async () => {
        let last = 0;
        try { last = Number(localStorage.getItem('verifyLastSent') || 0); } catch (e) { /* ignore */ }
        const wait = 60000 - (Date.now() - last);
        if (wait > 0) { alert('Please wait ' + Math.ceil(wait / 1000) + ' seconds.'); return; }
        try {
            await sendVerification(user);
            try { localStorage.setItem('verifyLastSent', String(Date.now())); } catch (e) { /* ignore */ }
            alert('Verification email sent. Check your inbox and spam folder.');
        } catch (e) {
            alert(e.code === 'auth/too-many-requests' ? 'Too many requests. Try again later.' : 'Could not send email.');
        }
    };

    cancel.onclick = async () => {
        if (!confirm('Cancel signup? Your account will be deleted.')) return;
        clearInterval(ticker);
        stopWatch();
        await cancelSignup();
        window.location.href = 'signup.html';
    };

    stopWatch = watchVerification(user, async () => {
        clearInterval(ticker);
        try {
            await ensureProfile(user); // the first time anything is saved
            window.location.href = CHAT_PAGE;
        } catch (e) {
            console.error('Profile save failed:', e);
            showMessage('Could not save your profile. Please log in again.', 'error');
        }
    });
}

// ==================== SIGNUP FUNCTION ====================
window.signup = async function (event) {
    const btn = event?.target;
    setLoading(btn, true, 'Sign Up');

    window.__signingUp = true; // stops the auth listener redirecting before signup finishes
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

        // Only a temporary note. NO profile is saved until the email is verified.
        await window.db.ref(`tempVerification/${user.uid}`).set({
            username: username,
            createdAt: Date.now()
        });

        await sendVerification(user);
        try { localStorage.setItem('verifyLastSent', String(Date.now())); } catch (e) { /* ignore */ }

        createdUser = null; // success, nothing to clean up
        succeeded = true;
        showWaitingScreen(user);

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
                await window.db.ref(`tempVerification/${createdUser.uid}`).remove();
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
    watchVerification(user, async () => {
        try { await ensureProfile(user); } catch (e) { console.error('Profile save failed:', e); }
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
            await ensureProfile(user);
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

// ==================== LOGIN FUNCTION ====================
window.login = async function (event) {
    const btn = event?.target;
    setLoading(btn, true, 'Login');

    try {
        window.__signingUp = true; // stops the auth listener redirecting before the checks finish

        const email = getValue('email');
        const password = getValue('password');

        if (!email || !password) {
            window.__signingUp = false;
            showMessage('Please enter both email and password', 'error');
            return;
        }

        if (!window.auth) {
            window.__signingUp = false;
            showMessage('Firebase not initialized. Please refresh the page.', 'error');
            return;
        }

        const userCredential = await window.auth.signInWithEmailAndPassword(email, password);
        const user = userCredential.user;

        await user.reload();
        if (!user.emailVerified) {
            showWaitingScreen(user); // nothing is written to the database
            return;
        }

        await user.getIdToken(true);  // so the rules see email_verified
        await ensureProfile(user);    // only creates it if it is missing
        await window.db.ref(`users/${user.uid}`).update({
            online: true,
            lastSeen: Date.now()
        });

        showMessage('Login successful! Redirecting...', 'success');
        window.location.href = CHAT_PAGE;

    } catch (err) {
        window.__signingUp = false;
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
    if (page === 'verified.html') return; // verified.html runs its own flow, no redirects here
    const isAuthPage = ['', 'index.html', 'login.html', 'signup.html'].includes(page);

    if (user) {
        if (!user.emailVerified) {
            // Not verified: wait here. Nothing is saved and the app stays blocked.
            if (!window.__signingUp && page !== 'verified.html') showWaitingScreen(user);
        } else if (isAuthPage && !window.__signingUp) {
            ensureProfile(user)
                .catch((e) => console.error(e))
                .finally(() => { window.location.href = CHAT_PAGE; });
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