// ============================================
// AuraSense — Dashboard Module
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    requireAuth(initDashboard);
});

async function initDashboard(user) {
    // Set greeting
    const welcomeName = document.getElementById('welcome-name');
    const profileBtnInitial = document.getElementById('profile-btn-initial');

    try {
        const doc = await db.collection('users').doc(user.uid).get();
        const data = doc.data();
        const displayName = data?.name || user.displayName || 'User';

        if (welcomeName) {
            welcomeName.textContent = displayName;
        }
        if (profileBtnInitial) {
            profileBtnInitial.textContent = displayName.charAt(0).toUpperCase();
        }
    } catch (error) {
        const displayName = user.displayName || 'User';
        if (welcomeName) welcomeName.textContent = displayName;
        if (profileBtnInitial) profileBtnInitial.textContent = displayName.charAt(0).toUpperCase();
    }

    // Show placeholder vitals
    setVitalPlaceholders();

    // Setup profile panel
    setupProfilePanel(user);

    // Listen for consultation invitations
    listenForConsultationInvites(user);

    // Store user ref for vital monitoring
    window._dashboardUser = user;
}

// ── Vital Monitoring State ──
let vitalListener = null;
let isMonitoring = false;

function setVitalPlaceholders() {
    const ids = ['vital-heart', 'vital-spo2', 'vital-temp', 'vital-location'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '--';
    });
}

// ── Start Vital Monitoring (called by button) ──
async function startVitalMonitoring() {
    if (isMonitoring) {
        showToast('Live monitoring is already active!', 'success');
        return;
    }

    const user = window._dashboardUser;
    if (!user) {
        showToast('Please log in first.', 'error');
        return;
    }

    const btn = document.getElementById('btn-check-vitals');
    if (btn) {
        btn.textContent = '⏳ Connecting...';
        btn.disabled = true;
    }

    try {
        // Get patient name from Firestore to map to RTDB node
        const userDoc = await db.collection('users').doc(user.uid).get();
        let patientName = '';
        if (userDoc.exists) {
            patientName = userDoc.data().name || '';
        }
        if (!patientName) {
            patientName = user.displayName || '';
        }

        if (!patientName) {
            showToast('Patient name not found. Please update your profile.', 'error');
            if (btn) { btn.textContent = '⚡ Check Your Vitals'; btn.disabled = false; }
            return;
        }

        // Start real-time listener on RTDB Patients/{patientName}
        listenToVitals(patientName);

        isMonitoring = true;
        if (btn) btn.textContent = '✅ Monitoring Active';

        const hint = document.getElementById('vitals-cta-hint');
        if (hint) hint.textContent = 'Receiving real-time data from your AuraSense device';

        const liveIndicator = document.getElementById('live-monitor-status');
        if (liveIndicator) liveIndicator.style.display = 'flex';

        showToast('Connected to AuraSense device! Live monitoring started.', 'success');
    } catch (error) {
        console.error('Error starting vital monitoring:', error);
        showToast('Failed to connect. Please try again.', 'error');
        if (btn) { btn.textContent = '⚡ Check Your Vitals'; btn.disabled = false; }
    }
}

// ── Real-time RTDB Listener ──
function listenToVitals(patientName) {
    if (vitalListener) {
        rtdb.ref('Patients/' + patientName).off('value', vitalListener);
    }

    const patientRef = rtdb.ref('Patients/' + patientName);

    vitalListener = patientRef.on('value', (snapshot) => {
        const data = snapshot.val();

        if (!data) {
            // No data yet — show waiting state
            showVitalWaiting();
            return;
        }

        // ── Heart Rate ──
        const heartEl = document.getElementById('vital-heart');
        const bpm = data.bpm;
        if (heartEl) {
            heartEl.textContent = (bpm !== undefined && bpm !== null) ? bpm + ' bpm' : 'Waiting...';
        }
        updateCardStatus('vital-heart', evaluateHeartRate(bpm));

        // ── SpO2 ──
        const spo2El = document.getElementById('vital-spo2');
        const spo2 = data.spo2;
        if (spo2El) {
            spo2El.textContent = (spo2 !== undefined && spo2 !== null) ? spo2 + '%' : 'Waiting...';
        }
        updateCardStatus('vital-spo2', evaluateSpO2(spo2));

        // ── Temperature ──
        const tempEl = document.getElementById('vital-temp');
        const temp = data.temp;
        if (tempEl) {
            tempEl.textContent = (temp !== undefined && temp !== null) ? temp + '°C' : 'Waiting...';
        }
        updateCardStatus('vital-temp', evaluateTemp(temp));

        // ── Location ──
        const locEl = document.getElementById('vital-location');
        const location = data.location;
        if (locEl) {
            locEl.textContent = location || 'Unknown';
        }
        const locStatus = document.getElementById('vital-location-status');
        if (locStatus) locStatus.textContent = data.status || '--';

        // ── Map Link ──
        const mapLink = document.getElementById('vital-map-link');
        if (mapLink) {
            if (data.map) {
                mapLink.href = data.map;
                mapLink.style.display = 'inline-block';
            } else {
                mapLink.style.display = 'none';
            }
        }

    }, (error) => {
        console.error('RTDB listener error:', error);
        showVitalWaiting();
    });
}

function showVitalWaiting() {
    const ids = ['vital-heart', 'vital-spo2', 'vital-temp', 'vital-location'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = 'Waiting for device…';
    });
}

// ── Vital Status Evaluation ──
function evaluateHeartRate(bpm) {
    if (bpm === undefined || bpm === null) return { label: '--', level: 'normal' };
    const v = Number(bpm);
    if (v < 60 || v > 100) return { label: 'Abnormal', level: 'warning' };
    if (v < 40 || v > 130) return { label: 'Critical', level: 'critical' };
    return { label: 'Normal', level: 'normal' };
}

function evaluateSpO2(spo2) {
    if (spo2 === undefined || spo2 === null) return { label: '--', level: 'normal' };
    const v = Number(spo2);
    if (v < 90) return { label: 'Critical', level: 'critical' };
    if (v < 95) return { label: 'Low', level: 'warning' };
    return { label: 'Normal', level: 'normal' };
}

function evaluateTemp(temp) {
    if (temp === undefined || temp === null) return { label: '--', level: 'normal' };
    const v = Number(temp);
    if (v > 38.5 || v < 35) return { label: 'Critical', level: 'critical' };
    if (v > 37.5 || v < 36) return { label: 'Abnormal', level: 'warning' };
    return { label: 'Normal', level: 'normal' };
}

function updateCardStatus(cardValueId, status) {
    const cardEl = document.getElementById(cardValueId);
    if (!cardEl) return;
    const card = cardEl.closest('.vital-card');
    if (!card) return;
    const badge = card.querySelector('.card-status');
    if (!badge) return;

    badge.textContent = status.label;
    badge.className = 'card-status ' + status.level;

    // Apply color based on level
    if (status.level === 'warning') {
        badge.style.background = 'rgba(255, 193, 7, 0.15)';
        badge.style.color = 'var(--color-warning)';
    } else if (status.level === 'critical') {
        badge.style.background = 'rgba(255, 107, 107, 0.15)';
        badge.style.color = 'var(--color-error)';
    } else {
        badge.style.background = 'rgba(0, 201, 167, 0.15)';
        badge.style.color = 'var(--color-teal)';
    }
}

// ── Profile Panel ──
function setupProfilePanel(user) {
    const overlay = document.getElementById('profile-overlay');
    const panel = document.getElementById('profile-panel');
    const openBtn = document.getElementById('profile-btn');
    const closeBtn = document.getElementById('profile-close');

    if (openBtn) {
        openBtn.addEventListener('click', () => openProfile(user));
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', closeProfile);
    }

    if (overlay) {
        overlay.addEventListener('click', closeProfile);
    }

    // Logout button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }

    // Save profile
    const saveBtn = document.getElementById('profile-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => saveProfile(user));
    }
}

function openProfile(user) {
    const overlay = document.getElementById('profile-overlay');
    const panel = document.getElementById('profile-panel');
    overlay.classList.add('open');
    panel.classList.add('open');
    loadProfileData(user);
}

function closeProfile() {
    const overlay = document.getElementById('profile-overlay');
    const panel = document.getElementById('profile-panel');
    overlay.classList.remove('open');
    panel.classList.remove('open');
}

async function loadProfileData(user) {
    const emailEl = document.getElementById('profile-email');
    if (emailEl) emailEl.textContent = user.email;

    try {
        const doc = await db.collection('users').doc(user.uid).get();
        if (doc.exists) {
            const data = doc.data();
            document.getElementById('profile-name').value = data.name || '';
            document.getElementById('profile-age').value = data.age || '';
            document.getElementById('profile-gender').value = data.gender || '';
            document.getElementById('profile-medical').value = data.medicalInfo || data.medicalConditions || '';

            // Guardian Information
            const guardianNameEl = document.getElementById('profile-guardian-name');
            const guardianPhoneEl = document.getElementById('profile-guardian-phone');
            const guardianEmailEl = document.getElementById('profile-guardian-email');
            if (guardianNameEl) guardianNameEl.value = data.guardianName || '';
            if (guardianPhoneEl) guardianPhoneEl.value = data.guardianPhone || '';
            if (guardianEmailEl) guardianEmailEl.value = data.guardianEmail || '';

            // Update avatar initial
            const avatarEl = document.getElementById('profile-avatar-icon');
            if (avatarEl && data.name) avatarEl.textContent = data.name.charAt(0).toUpperCase();
        }
    } catch (error) {
        console.error('Error loading profile:', error);
    }
}

async function saveProfile(user) {
    const btn = document.getElementById('profile-save');
    setLoading(btn, true);

    const medicalValue = document.getElementById('profile-medical').value.trim();

    try {
        await db.collection('users').doc(user.uid).set({
            name: document.getElementById('profile-name').value.trim(),
            age: parseInt(document.getElementById('profile-age').value) || '',
            gender: document.getElementById('profile-gender').value,
            email: user.email,
            medicalInfo: medicalValue,
            medicalConditions: medicalValue,
            role: 'patient'
        }, { merge: true });

        // Update greeting
        const name = document.getElementById('profile-name').value.trim();
        const welcomeName = document.getElementById('welcome-name');
        const profileBtnInitial = document.getElementById('profile-btn-initial');
        const avatarEl = document.getElementById('profile-avatar-icon');
        if (welcomeName) welcomeName.textContent = name || 'User';
        if (profileBtnInitial) profileBtnInitial.textContent = (name || 'U').charAt(0).toUpperCase();
        if (avatarEl) avatarEl.textContent = (name || 'U').charAt(0).toUpperCase();

        showToast('Profile updated successfully!', 'success');
    } catch (error) {
        showToast('Error saving profile. Please try again.', 'error');
        console.error('Save error:', error);
    } finally {
        setLoading(btn, false);
    }
}

// ============================================
// Consultation Invitation — Real-time Listener
// ============================================

let activeInviteNotifId = null;
let activeInviteMeetLink = null;
let unsubscribeInvites = null;

function listenForConsultationInvites(user) {
    const container = document.getElementById('consult-notification');
    if (!container) return;

    unsubscribeInvites = db.collection('notifications')
        .where('patientId', '==', user.uid)
        .where('status', '==', 'pending')
        .onSnapshot((snapshot) => {
            if (snapshot.empty) {
                container.style.display = 'none';
                activeInviteNotifId = null;
                activeInviteMeetLink = null;
                return;
            }

            // Show the most recent pending invite
            const doc = snapshot.docs[0];
            const data = doc.data();
            activeInviteNotifId = doc.id;
            activeInviteMeetLink = data.meetLink || '';

            const titleEl = document.getElementById('consult-notif-title');
            const doctorEl = document.getElementById('consult-notif-doctor');
            const messageEl = document.getElementById('consult-notif-message');

            if (titleEl) titleEl.textContent = data.title || 'Consultation Invitation';
            if (doctorEl) doctorEl.textContent = data.doctorName ? `🩺 Dr. ${data.doctorName}` : '';
            if (messageEl) messageEl.textContent = data.message || 'Your doctor has invited you to join the consultation';

            container.style.display = 'block';

            showToast('You have a new consultation invitation!', 'success');
        }, (error) => {
            console.error('Error listening for consultation invites:', error);
        });
}

async function joinMeeting() {
    if (activeInviteMeetLink) {
        window.open(activeInviteMeetLink, '_blank');
    }

    if (activeInviteNotifId) {
        try {
            await db.collection('notifications').doc(activeInviteNotifId).update({
                status: 'completed',
                joinedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            console.error('Error updating notification status:', error);
        }
    }

    const container = document.getElementById('consult-notification');
    if (container) container.style.display = 'none';
    activeInviteNotifId = null;
    activeInviteMeetLink = null;
}

async function dismissInvite() {
    if (activeInviteNotifId) {
        try {
            await db.collection('notifications').doc(activeInviteNotifId).update({
                status: 'dismissed'
            });
        } catch (error) {
            console.error('Error dismissing invite:', error);
        }
    }

    const container = document.getElementById('consult-notification');
    if (container) container.style.display = 'none';
    activeInviteNotifId = null;
    activeInviteMeetLink = null;
}

// Cleanup listeners on page unload
window.addEventListener('beforeunload', () => {
    if (unsubscribeInvites) unsubscribeInvites();
    if (vitalListener && window._dashboardUser) {
        // Clean up RTDB listener
        rtdb.ref().off();
    }
});

