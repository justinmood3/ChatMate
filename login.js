const auth = firebase.auth();
const db = firebase.database();


// ==========================
// REGISTER
// ==========================

window.register = function(){

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    if(!email || !password){
        alert("Please enter email and password");
        return;
    }

    auth.createUserWithEmailAndPassword(email, password)

    .then((cred)=>{

        return db.ref("users/" + cred.user.uid).set({

            email: cred.user.email,
            online: false,
            createdAt: Date.now()

        });

    })

    .then(()=>{

        alert("Account created successfully");

        window.location = "chat.html";

    })

    .catch((error)=>{

        console.error(error);

        alert(error.message);

    });

};


// ==========================
// LOGIN
// ==========================

window.login = function(){

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    if(!email || !password){
        alert("Please enter email and password");
        return;
    }

    auth.signInWithEmailAndPassword(email, password)

    .then(()=>{

        window.location = "chat.html";

    })

    .catch((error)=>{

        console.error(error);

        alert(error.message);

    });

};


// ==========================
// GOOGLE LOGIN
// ==========================

window.googleLogin = function(){

    const provider = new firebase.auth.GoogleAuthProvider();

    auth.signInWithPopup(provider)

    .then((result)=>{

        const user = result.user;

        return db.ref("users/" + user.uid).update({

            email: user.email,
            name: user.displayName || "",
            photo: user.photoURL || "",
            online: true

        });

    })

    .then(()=>{

        window.location = "chat.html";

    })

    .catch((error)=>{

        console.error(error);

        alert(error.message);

    });

};


// ==========================
// FORGOT PASSWORD
// ==========================

window.resetPassword = function(){

    const email = document.getElementById("email").value.trim();

    if(!email){

        alert("Enter your email address first");

        return;
    }

    auth.sendPasswordResetEmail(email)

    .then(()=>{

        alert("Password reset email sent");

    })

    .catch((error)=>{

        console.error(error);

        alert(error.message);

    });

};


// ==========================
// AUTO REDIRECT IF LOGGED IN
// ==========================

auth.onAuthStateChanged((user)=>{

    if(user){

        console.log("Logged in:", user.email);

    }

});