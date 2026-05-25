// ============================================
// AuraSense — Doctor Authentication Module
// ============================================

// ── Utility: Show / Hide alerts ──
function showDoctorAlert(message, type = 'error') {
    const el = document.getElementById('doctor-login-alert');
    if (!el) return;
    el.className = `alert alert-${type} show`;
    el.textContent = message;
}

function hideDoctorAlert() {
    const el = document.getElementById('doctor-login-alert');
    if (!el) return;
    el.className = 'alert';
    el.textContent = '';
}

function setDoctorLoading(btn, loading) {
    if (loading) {
        btn.dataset.originalText = btn.innerHTML;
        btn.innerHTML = '<span class="spinner"></span> Verifying...';
        btn.classList.add('loading');
    } else {
        btn.innerHTML = btn.dataset.originalText || btn.innerHTML;
        btn.classList.remove('loading');
    }
}

// ── Doctor Login ──
async function loginDoctor(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const doctorId = document.getElementById('doctor-id').value.trim();
    const password = document.getElementById('doctor-password').value;

    hideDoctorAlert();

    // Validate Doctor ID format
    if (!doctorId || !/^\d{6}$/.test(doctorId)) {
        showDoctorAlert('Please enter a valid 6-digit Doctor ID.');
        return;
    }

    if (!password) {
        showDoctorAlert('Please enter your password.');
        return;
    }

    setDoctorLoading(btn, true);

    try {
        // Look up doctor in Firestore
        const docRef = db.collection('doctors').doc(doctorId);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            showDoctorAlert('Invalid Doctor ID. Please check and try again.');
            setDoctorLoading(btn, false);
            return;
        }

        const doctorData = docSnap.data();

        // Validate password
        if (doctorData.password !== password) {
            showDoctorAlert('Incorrect password. Please try again.');
            setDoctorLoading(btn, false);
            return;
        }

        // Success — Store session and redirect
        sessionStorage.setItem('doctorId', doctorId);
        sessionStorage.setItem('doctorName', doctorData.name || 'Doctor');
        sessionStorage.setItem('doctorSpecialization', doctorData.specialization || 'General Physician');
        sessionStorage.setItem('doctorLoggedIn', 'true');

        // Update doctor status to online
        await docRef.update({
            role: 'doctor',
            status: 'online',
            lastLogin: firebase.firestore.FieldValue.serverTimestamp()
        });

        window.location.href = 'doctor-dashboard.html';

    } catch (error) {
        console.error('Doctor login error:', error);
        showDoctorAlert('Something went wrong. Please try again later.');
    } finally {
        setDoctorLoading(btn, false);
    }
}

// ── Doctor Auth Guard ──
function requireDoctorAuth(callback) {
    const doctorId = sessionStorage.getItem('doctorId');
    const isLoggedIn = sessionStorage.getItem('doctorLoggedIn');

    if (!doctorId || isLoggedIn !== 'true') {
        window.location.href = 'doctor-login.html';
        return;
    }

    // Verify doctor still exists in Firestore
    db.collection('doctors').doc(doctorId).get()
        .then((doc) => {
            if (doc.exists) {
                callback({ id: doctorId, ...doc.data() });
            } else {
                sessionStorage.clear();
                window.location.href = 'doctor-login.html';
            }
        })
        .catch((error) => {
            console.error('Auth verification error:', error);
            sessionStorage.clear();
            window.location.href = 'doctor-login.html';
        });
}

// ── Doctor Logout ──
async function logoutDoctor() {
    const doctorId = sessionStorage.getItem('doctorId');

    try {
        if (doctorId) {
            await db.collection('doctors').doc(doctorId).update({
                status: 'offline'
            });
        }
    } catch (error) {
        console.error('Error updating status on logout:', error);
    }

    sessionStorage.removeItem('doctorId');
    sessionStorage.removeItem('doctorName');
    sessionStorage.removeItem('doctorLoggedIn');
    window.location.href = 'index.html';
}

// ── Toast for doctor pages ──
function showDoctorToast(message, type = 'success') {
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
