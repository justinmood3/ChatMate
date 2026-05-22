let confirmationResult = null;
let recaptchaVerifier;

function getValue(id){
    const element = document.getElementById(id);
    return element ? element.value.trim() : "";
}

function showAuthError(error, fallbackMessage){
    console.error("Firebase auth error:", error);

    const code = error && error.code ? error.code : "auth/unknown";
    const message = error && error.message ? error.message : fallbackMessage;

    const fixes = {
        "auth/internal-error": "Firebase returned an internal auth error. For phone login, check that Phone is enabled in Firebase Authentication, your page is running from http://localhost or a real authorized domain, and the domain is listed in Authentication > Settings > Authorized domains.",
        "auth/operation-not-allowed": "This sign-in method is disabled. Enable Email/Password or Phone in Firebase Authentication > Sign-in method.",
        "auth/invalid-phone-number": "Use the full phone number with country code, for example +15551234567.",
        "auth/captcha-check-failed": "The reCAPTCHA check failed. Refresh the page and make sure this app is opened from an authorized domain.",
        "auth/too-many-requests": "Firebase blocked requests temporarily because too many attempts were made. Wait a bit, or use a Firebase test phone number while developing.",
        "auth/invalid-verification-code": "That SMS code is not correct. Check the code and try again."
    };

    alert((fixes[code] || message) + "\n\nCode: " + code);
}

function showPhoneStep(show){
    const codeArea = document.getElementById("phone-code-area");
    if(codeArea){
        codeArea.hidden = !show;
    }
}

function updatePhoneStatus(message){
    const statusEl = document.getElementById("phone-status");
    if(statusEl){
        statusEl.textContent = message || "";
    }
}

function setupRecaptcha() {
    recaptchaVerifier = new firebase.auth.RecaptchaVerifier(
        "recaptcha-container",
        {
            size: "normal",
            callback: function(response) {
                updatePhoneStatus("✅ reCAPTCHA verified. Now send the SMS code.");
            },
            "expired-callback": function(){
                updatePhoneStatus("reCAPTCHA expired. Refresh the page and try again.");
            }
        }
    );

    recaptchaVerifier.render();
}

function ensureRecaptcha(){
    if(!recaptchaVerifier){
        setupRecaptcha();
    }
    return recaptchaVerifier;
}
function saveUserProfile(user, extraData){
    const username = getValue("username");

    return db.ref("users/" + user.uid).update({
        username: username || extraData.username || user.displayName || user.email || user.phoneNumber || "New user",
        status: extraData.status || "",
        photo: extraData.photo || "",
        email: user.email || extraData.email || "",
        phone: user.phoneNumber || extraData.phone || "",
        online: true,
        lastSeen: Date.now(),
        createdAt: extraData.createdAt || Date.now()
    });
}

function signup(){
    const email = getValue("email");
    const password = getValue("password");

    if(!email || !password){
        alert("Enter an email and password to sign up, or use phone sign in below.");
        return;
    }

    firebase.auth()
        .createUserWithEmailAndPassword(email, password)
        .then((credential)=>{
            return saveUserProfile(credential.user, {
                email: credential.user.email,
                createdAt: Date.now()
            });
        })
        .then(()=>{
            alert("Account created");
            window.location = "chat.html";
        })
        .catch((error)=>{
            showAuthError(error, "Could not create your account.");
        });
}

function login(){
    const email = getValue("email");
    const password = getValue("password");

    if(!email || !password){
        alert("Enter your email and password, or use phone sign in below.");
        return;
    }

    firebase.auth()
        .signInWithEmailAndPassword(email, password)
        .then((credential)=>{
            return saveUserProfile(credential.user, {
                email: credential.user.email
            });
        })
        .then(()=>{
            alert("Login successful");
            window.location = "chat.html";
        })
        .catch((error)=>{
            showAuthError(error, "Could not log you in.");
        });
}

function sendPhoneCode(){
    const phone = getValue("phone");

    if(!phone){
        updatePhoneStatus("Enter your phone number with country code, like +15551234567.");
        alert("Enter your phone number with country code, like +15551234567.");
        return;
    }

    if(window.location.protocol === "file:"){
        alert("Phone login cannot run from a file opened directly. Start a local web server and open this app at http://localhost.");
        return;
    }

    updatePhoneStatus("Sending SMS code to " + phone + "...");

    firebase.auth()
        .signInWithPhoneNumber(phone, ensureRecaptcha())
        .then((result)=>{
            confirmationResult = result;
            showPhoneStep(true);
            updatePhoneStatus("SMS verification code sent to " + phone + ". Enter it below.");
            const codeInput = document.getElementById("verificationCode");
            if(codeInput){
                codeInput.focus();
            }
            alert("SMS verification code sent");
        })
        .catch((error)=>{
            if(recaptchaVerifier){
                recaptchaVerifier.clear();
                recaptchaVerifier = null;
            }
            updatePhoneStatus("Could not send the verification code. Check the phone number and try again.");
            showAuthError(error, "Could not send the phone verification code.");
        });
}

function verifyPhoneCode(){
    const code = getValue("verificationCode");

    if(!confirmationResult){
        alert("Send a phone verification code first.");
        return;
    }

    if(!code){
        alert("Enter the verification code.");
        return;
    }

    confirmationResult.confirm(code)
        .then((credential)=>{
            return saveUserProfile(credential.user, {
                phone: credential.user.phoneNumber,
                createdAt: Date.now()
            });
        })
        .then(()=>{
            updatePhoneStatus("Phone login successful. Redirecting to chat...");
            alert("Phone login successful");
            window.location = "chat.html";
        })
        .catch((error)=>{
            updatePhoneStatus("The verification code is invalid. Please check the SMS and try again.");
            showAuthError(error, "Could not verify the phone code.");
        });
}

firebase.auth().onAuthStateChanged((user)=>{
    if(user){
        db.ref("users/" + user.uid).update({
            email: user.email || "",
            phone: user.phoneNumber || "",
            online: true,
            lastSeen: Date.now()
        });
    } else if(window.location.pathname.endsWith("chat.html")) {
        window.location = "login.html";
    }
});
