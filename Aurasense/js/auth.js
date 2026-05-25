// ============================================
// AuraSense — Authentication Module
// ============================================

// ── Utility: Show alerts ──
function showAlert(elementId, message, type = 'error') {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.className = `alert alert-${type} show`;
    el.textContent = message;
}

// Show alert with HTML content (for resend link etc.)
function showAlertHtml(elementId, html, type = 'error') {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.className = `alert alert-${type} show`;
    el.innerHTML = html;
}

function hideAlert(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.className = 'alert';
    el.textContent = '';
}

function setLoading(btn, loading) {
    if (loading) {
        btn.dataset.originalText = btn.innerHTML;
        btn.innerHTML = '<span class="spinner"></span> Please wait...';
        btn.classList.add('loading');
    } else {
        btn.innerHTML = btn.dataset.originalText || btn.innerHTML;
        btn.classList.remove('loading');
    }
}

// ── Toast Notification ──
function showToast(message, type = 'success') {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        document.body.appendChild(toast);
    }
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => toast.classList.remove('show'), 4000);
}

// ── Resend Verification Email ──
async function resendVerificationEmail() {
    const user = auth.currentUser;
    if (!user) {
        showToast('No user session found. Please sign up again.', 'error');
        return;
    }

    try {
        await user.sendEmailVerification();
        showToast('Verification email resent! Check your inbox.', 'success');
    } catch (error) {
        if (error.code === 'auth/too-many-requests') {
            showToast('Too many requests. Please wait before trying again.', 'error');
        } else {
            showToast('Failed to resend verification email. Please try again.', 'error');
        }
        console.error('Resend verification error:', error);
    }
}

// ── Sign Up with Email ──
async function signUpWithEmail(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const name = document.getElementById('signup-name').value.trim();
    const age = document.getElementById('signup-age').value.trim();
    const gender = document.getElementById('signup-gender').value;
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const guardianName = document.getElementById('signup-guardian-name').value.trim();
    const guardianPhone = document.getElementById('signup-guardian-phone').value.trim();
    const guardianEmail = document.getElementById('signup-guardian-email').value.trim();
    const medicalConditions = document.getElementById('signup-medical') ? document.getElementById('signup-medical').value.trim() : '';

    hideAlert('signup-alert');

    if (!name || !age || !gender || !email || !password || !guardianName || !guardianPhone || !guardianEmail) {
        showAlert('signup-alert', 'Please fill in all required fields.');
        return;
    }

    if (password.length < 6) {
        showAlert('signup-alert', 'Password must be at least 6 characters.');
        return;
    }

    // Validate guardian phone — must be 10 digits
    if (!/^\d{10}$/.test(guardianPhone)) {
        showAlert('signup-alert', 'Guardian phone must be a 10-digit number.');
        return;
    }

    // Validate guardian email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(guardianEmail)) {
        showAlert('signup-alert', 'Please enter a valid guardian email address.');
        return;
    }

    setLoading(btn, true);

    try {
        // Create user in Firebase Auth
        const cred = await auth.createUserWithEmailAndPassword(email, password);

        // Update display name
        await cred.user.updateProfile({ displayName: name });

        const patientData = {
            role: 'patient',
            name: name,
            age: parseInt(age),
            gender: gender,
            email: email,
            guardianName: guardianName,
            guardianPhone: guardianPhone,
            guardianEmail: guardianEmail,
            medicalConditions: medicalConditions,
            medicalInfo: medicalConditions,
            reports: [],
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        // Save to Firestore
        await db.collection('users').doc(cred.user.uid).set(patientData);

        // Save to Realtime Database
        const rtdbData = { ...patientData };
        rtdbData.createdAt = firebase.database.ServerValue.TIMESTAMP;
        delete rtdbData.reports;
        if (typeof rtdb !== 'undefined' && rtdb) {
            await rtdb.ref('patients/' + cred.user.uid).set(rtdbData);
        }

        // Send verification email
        try {
            await cred.user.sendEmailVerification();
        } catch (verifyError) {
            console.error('Verification email error:', verifyError);
        }

        // Sign out so user cannot access dashboard without verifying
        await auth.signOut();

        // Show verification message instead of redirecting
        showAlertHtml('signup-alert',
            '✅ Account created successfully! A verification email has been sent to <strong>' +
            email + '</strong>. Please check your inbox and verify your email before logging in.' +
            '<br><br><a href="patient-login.html" style="color: var(--color-accent); font-weight: 600;">← Go to Login</a>',
            'success'
        );

        // Disable the form to prevent re-submission
        btn.disabled = true;

    } catch (error) {
        let msg = 'Something went wrong. Please try again.';
        if (error.code === 'auth/email-already-in-use') msg = 'This email is already registered.';
        if (error.code === 'auth/invalid-email') msg = 'Invalid email address.';
        if (error.code === 'auth/weak-password') msg = 'Password is too weak.';
        showAlert('signup-alert', msg);
    } finally {
        setLoading(btn, false);
    }
}

// ── Login with Email ──
async function loginWithEmail(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    hideAlert('login-alert');

    if (!email || !password) {
        showAlert('login-alert', 'Please enter your email and password.');
        return;
    }

    setLoading(btn, true);

    try {
        const cred = await auth.signInWithEmailAndPassword(email, password);

        // Check email verification
        if (!cred.user.emailVerified) {
            // Sign out — do not allow dashboard access
            await auth.signOut();

            showAlertHtml('login-alert',
                '⚠️ Email not verified. Please check your inbox for the verification link.' +
                '<br><br><a href="#" onclick="resendVerificationForLogin(\'' +
                email.replace(/'/g, "\\'") + '\', \'' +
                password.replace(/'/g, "\\'") +
                '\'); return false;" style="color: var(--color-accent); font-weight: 600;">📧 Resend Verification Email</a>'
            );
            return;
        }

        // Email verified — redirect to dashboard
        window.location.href = 'dashboard.html';

    } catch (error) {
        let msg = 'Login failed. Please check your credentials.';
        if (error.code === 'auth/user-not-found') msg = 'No account found with this email.';
        if (error.code === 'auth/wrong-password') msg = 'Incorrect password.';
        if (error.code === 'auth/invalid-email') msg = 'Invalid email address.';
        if (error.code === 'auth/too-many-requests') msg = 'Too many attempts. Please try again later.';
        showAlert('login-alert', msg);
    } finally {
        setLoading(btn, false);
    }
}

// ── Resend verification from login page ──
async function resendVerificationForLogin(email, password) {
    try {
        // Temporarily sign in to get user object
        const cred = await auth.signInWithEmailAndPassword(email, password);

        if (cred.user.emailVerified) {
            // Already verified — redirect
            window.location.href = 'dashboard.html';
            return;
        }

        await cred.user.sendEmailVerification();

        // Sign out again
        await auth.signOut();

        showAlertHtml('login-alert',
            '✅ Verification email resent to <strong>' + email +
            '</strong>. Please check your inbox and click the verification link, then come back and log in.',
            'success'
        );
    } catch (error) {
        if (error.code === 'auth/too-many-requests') {
            showAlert('login-alert', 'Too many requests. Please wait a few minutes before trying again.');
        } else {
            showAlert('login-alert', 'Failed to resend verification email. Please try again.');
        }
        console.error('Resend verification error:', error);
    }
}

// ── Google Sign-In ──
async function signInWithGoogle() {
    hideAlert('login-alert');
    try {
        const result = await auth.signInWithPopup(googleProvider);
        const user = result.user;

        // Google-authenticated users are auto-verified — no check needed
        // Check if new user → save to Firestore
        const docRef = db.collection('users').doc(user.uid);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            await docRef.set({
                role: 'patient',
                name: user.displayName || '',
                age: '',
                gender: '',
                email: user.email,
                medicalInfo: '',
                reports: [],
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }

        window.location.href = 'dashboard.html';
    } catch (error) {
        if (error.code !== 'auth/popup-closed-by-user') {
            showAlert('login-alert', 'Google sign-in failed. Please try again.');
        }
    }
}

// ── Password Reset ──
async function sendPasswordReset(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const email = document.getElementById('reset-email').value.trim();

    hideAlert('reset-alert');

    if (!email) {
        showAlert('reset-alert', 'Please enter your email address.');
        return;
    }

    // Client-side email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showAlert('reset-alert', 'Please enter a valid email address.');
        return;
    }

    setLoading(btn, true);

    try {
        await auth.sendPasswordResetEmail(email);
        showAlert('reset-alert', 'Password reset email sent! Check your inbox and follow the link to reset your password.', 'success');
        // Disable the form after success to prevent multiple sends
        document.getElementById('reset-form').querySelector('input').disabled = true;
        btn.disabled = true;
    } catch (error) {
        let msg = 'Failed to send reset email. Please try again.';
        if (error.code === 'auth/user-not-found') msg = 'No account found with this email address.';
        if (error.code === 'auth/invalid-email') msg = 'Invalid email address.';
        if (error.code === 'auth/too-many-requests') msg = 'Too many attempts. Please try again later.';
        showAlert('reset-alert', msg);
    } finally {
        setLoading(btn, false);
    }
}

// ── Logout ──
async function logout() {
    try {
        await auth.signOut();
        window.location.href = 'index.html';
    } catch (error) {
        showToast('Error signing out', 'error');
    }
}

// ── Auth State Guard (for dashboard) ──
function requireAuth(callback) {
    auth.onAuthStateChanged((user) => {
        if (user) {
            // Check email verification (Google users are auto-verified)
            if (!user.emailVerified) {
                auth.signOut();
                window.location.href = 'patient-login.html';
                return;
            }
            callback(user);
        } else {
            window.location.href = 'patient-login.html';
        }
    });
}

// ── Redirect if already logged in (for login/signup pages) ──
function redirectIfLoggedIn() {
    auth.onAuthStateChanged((user) => {
        if (user && user.emailVerified) {
            window.location.href = 'dashboard.html';
        }
    });
}
