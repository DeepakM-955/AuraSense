// ============================================
// AuraSense — Doctor Dashboard Module
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    requireDoctorAuth(initDoctorDashboard);
});

let unsubscribeRequests = null;

async function initDoctorDashboard(doctorData) {
    const doctorId = doctorData.id || sessionStorage.getItem('doctorId');
    const doctorName = doctorData.name || sessionStorage.getItem('doctorName') || 'Doctor';
    const doctorSpec = doctorData.specialization || sessionStorage.getItem('doctorSpecialization') || 'General Physician';

    // Set welcome name
    const welcomeEl = document.getElementById('doctor-welcome-name');
    if (welcomeEl) welcomeEl.textContent = doctorName;

    // Set specialization
    const specEl = document.getElementById('doctor-specialization');
    if (specEl) specEl.textContent = doctorSpec;

    // Setup status toggle
    setupStatusToggle(doctorId, doctorData.status || 'online');

    // Setup logout
    const logoutBtn = document.getElementById('doctor-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logoutDoctor);
    }

    // Listen for real-time patient requests (Firestore)
    listenForPatientRequests(doctorId);

    // Listen for real-time "Call a Doctor" requests (RTDB)
    listenForDoctorCallRequests(doctorId, doctorName);

    // Listen for appointment requests matching specialization
    listenForAppointments(doctorId, doctorName, doctorSpec);
}

// ── Status Toggle ──
function setupStatusToggle(doctorId, currentStatus) {
    const toggle = document.getElementById('status-toggle');
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    const statStatus = document.getElementById('stat-status');
    const statusIconEl = document.querySelector('.stat-icon-wrap.status-icon');

    let isOnline = currentStatus === 'online';
    updateStatusUI(isOnline);

    if (toggle) {
        toggle.addEventListener('click', async () => {
            isOnline = !isOnline;
            updateStatusUI(isOnline);

            try {
                await db.collection('doctors').doc(doctorId).update({
                    status: isOnline ? 'online' : 'offline'
                });
                // Update the RTDB notification flag
                if (typeof updateDoctorOnlineFlag === 'function') {
                    updateDoctorOnlineFlag(isOnline);
                }
            } catch (error) {
                console.error('Error updating status:', error);
                showDoctorToast('Failed to update status', 'error');
            }
        });
    }

    function updateStatusUI(online) {
        if (dot) {
            dot.className = online ? 'status-dot online' : 'status-dot offline';
        }
        if (text) {
            text.textContent = online ? 'Online' : 'Offline';
        }
        if (statStatus) {
            statStatus.textContent = online ? 'Online' : 'Offline';
            statStatus.style.color = online ? 'var(--color-teal)' : 'var(--color-text-muted)';
        }
        if (statusIconEl) {
            statusIconEl.textContent = online ? '🟢' : '🔴';
        }
    }
}

// ── Real-time Patient Requests Listener ──
function listenForPatientRequests(doctorId) {
    const container = document.getElementById('requests-container');
    const emptyState = document.getElementById('empty-requests');
    const badge = document.getElementById('notification-badge');

    // Listen to patientRequests collection for this doctor
    unsubscribeRequests = db.collection('patientRequests')
        .where('doctorId', '==', doctorId)
        .orderBy('timestamp', 'desc')
        .onSnapshot((snapshot) => {
            const requests = [];
            snapshot.forEach((doc) => {
                requests.push({ id: doc.id, ...doc.data() });
            });

            renderRequests(requests, container, emptyState);
            updateStats(requests);
            updateNotificationBadge(requests, badge);

            // Flash notification for new requests
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added' && !change.doc.metadata.hasPendingWrites) {
                    const data = change.doc.data();
                    showDoctorToast(`New request from ${data.patientName || 'a patient'}!`, 'success');
                    flashNotificationBell();
                }
            });
        }, (error) => {
            console.error('Error listening for requests:', error);
            // Still render the empty state gracefully
            if (emptyState) emptyState.style.display = 'flex';
        });
}

// ── Render Patient Request Cards ──
function renderRequests(requests, container, emptyState) {
    if (!container) return;

    // Remove existing request cards (keep empty state element)
    const existingCards = container.querySelectorAll('.request-card');
    existingCards.forEach(card => card.remove());

    if (requests.length === 0) {
        if (emptyState) emptyState.style.display = 'flex';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    requests.forEach((req, index) => {
        const card = document.createElement('div');
        card.className = `request-card glass-card ${req.status === 'pending' ? 'request-new' : ''}`;
        card.style.animationDelay = `${index * 0.1}s`;

        const timestamp = req.timestamp ? formatTimestamp(req.timestamp) : 'Just now';
        const statusClass = req.status === 'pending' ? 'status-pending' :
            req.status === 'accepted' ? 'status-accepted' : 'status-completed';
        const statusLabel = req.status === 'pending' ? '⏳ Pending' :
            req.status === 'accepted' ? '✅ Accepted' : '✔️ Completed';

        card.innerHTML = `
            <div class="request-card-header">
                <div class="request-patient-info">
                    <div class="request-avatar">${(req.patientName || 'P').charAt(0).toUpperCase()}</div>
                    <div>
                        <h3 class="request-patient-name">${escapeHtml(req.patientName || 'Unknown Patient')}</h3>
                        <span class="request-time">🕐 ${timestamp}</span>
                    </div>
                </div>
                <span class="request-status ${statusClass}">${statusLabel}</span>
            </div>
            <div class="request-card-body">
                <p class="request-condition">
                    <strong>Condition:</strong> ${escapeHtml(req.condition || req.message || 'No details provided')}
                </p>
            </div>
            <div class="request-card-actions">
                ${req.status === 'pending' ? `
                    <button class="btn btn-accept" onclick="acceptRequest('${req.id}')">✅ Accept</button>
                    <button class="btn btn-decline" onclick="declineRequest('${req.id}')">❌ Decline</button>
                ` : ''}
            </div>
        `;

        container.appendChild(card);
    });
}

// ── Update Stats ──
function updateStats(requests) {
    const totalEl = document.getElementById('stat-total-requests');
    const pendingEl = document.getElementById('stat-pending');
    const acceptedEl = document.getElementById('stat-accepted');

    const total = requests.length;
    const pending = requests.filter(r => r.status === 'pending').length;
    const accepted = requests.filter(r => r.status === 'accepted' || r.status === 'completed').length;

    if (totalEl) animateCounter(totalEl, total);
    if (pendingEl) animateCounter(pendingEl, pending);
    if (acceptedEl) animateCounter(acceptedEl, accepted);
}

// ── Notification Badge ──
function updateNotificationBadge(requests, badge) {
    const pending = requests.filter(r => r.status === 'pending').length;
    if (badge) {
        badge.textContent = pending;
        badge.style.display = pending > 0 ? 'flex' : 'none';
        if (pending > 0) {
            badge.classList.add('badge-pulse');
        } else {
            badge.classList.remove('badge-pulse');
        }
    }
}

function flashNotificationBell() {
    const bell = document.getElementById('notification-bell');
    if (bell) {
        bell.classList.add('bell-ring');
        setTimeout(() => bell.classList.remove('bell-ring'), 1000);
    }
}

// ── Accept / Decline Request Actions ──
async function acceptRequest(requestId) {
    try {
        await db.collection('patientRequests').doc(requestId).update({
            status: 'accepted',
            respondedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showDoctorToast('Request accepted!', 'success');
    } catch (error) {
        console.error('Error accepting request:', error);
        showDoctorToast('Failed to accept request.', 'error');
    }
}

async function declineRequest(requestId) {
    try {
        await db.collection('patientRequests').doc(requestId).update({
            status: 'declined',
            respondedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showDoctorToast('Request declined.', 'success');
    } catch (error) {
        console.error('Error declining request:', error);
        showDoctorToast('Failed to decline request.', 'error');
    }
}

// ── Utilities ──
function animateCounter(el, target) {
    const current = parseInt(el.textContent) || 0;
    if (current === target) return;

    let count = current;
    const step = target > current ? 1 : -1;
    const interval = setInterval(() => {
        count += step;
        el.textContent = count;
        if (count === target) clearInterval(interval);
    }, 60);
}

function formatTimestamp(ts) {
    if (!ts) return 'Just now';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Cleanup on page unload — set doctor offline
window.addEventListener('beforeunload', () => {
    if (unsubscribeRequests) unsubscribeRequests();
    if (unsubscribeAppointments) unsubscribeAppointments();

    // Clean up RTDB listener
    if (rtdbRequestListener) {
        rtdb.ref('doctorRequests').off('value', rtdbRequestListener);
    }

    // Set doctor status to offline on tab/browser close
    const doctorId = sessionStorage.getItem('doctorId');
    if (doctorId) {
        // Use sendBeacon for reliable delivery during page unload
        const url = `https://firestore.googleapis.com/v1/projects/aurasense-80841/databases/(default)/documents/doctors/${doctorId}?updateMask.fieldPaths=status`;
        const body = JSON.stringify({
            fields: { status: { stringValue: 'offline' } }
        });
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    }
});

// ============================================
// RTDB — Real-time Doctor Request Notifications
// ============================================

let rtdbRequestListener = null;
let currentNotificationKey = null;
let doctorIsOnline = true;

// Called from initDoctorDashboard
function listenForDoctorCallRequests(doctorId, doctorName) {
    console.log('[RTDB] Setting up doctor call request listener...');

    if (typeof rtdb === 'undefined' || !rtdb) {
        console.error('[RTDB] rtdb is not defined! Check firebase-config.js');
        return;
    }

    const requestsRef = rtdb.ref('doctorRequests');
    let knownKeys = new Set();
    let isFirstLoad = true;

    // Use 'value' event for full snapshot — most reliable
    rtdbRequestListener = requestsRef.on('value', (snapshot) => {
        console.log('[RTDB] Received value event, data exists:', snapshot.exists());

        if (!snapshot.exists()) {
            console.log('[RTDB] No doctor requests found.');
            isFirstLoad = false;
            return;
        }

        const allRequests = snapshot.val();
        console.log('[RTDB] All requests:', JSON.stringify(allRequests));

        // Find pending requests
        for (const [key, req] of Object.entries(allRequests)) {
            if (req.status === 'pending' && !knownKeys.has(key)) {
                console.log('[RTDB] New pending request found:', key, req);

                // On first load, mark as known but still show if pending
                knownKeys.add(key);

                // Only notify if doctor is online
                if (!doctorIsOnline) {
                    console.log('[RTDB] Doctor is offline, skipping notification.');
                    continue;
                }

                // Show notification modal
                showCallNotification(key, req, doctorId, doctorName);
            }

            // Check if a currently notified request was accepted by another doctor
            if (key === currentNotificationKey && req.status !== 'pending') {
                hideCallNotification();
                if (req.status === 'accepted' && req.doctorId !== doctorId) {
                    showDoctorToast('Request was accepted by another doctor.', 'success');
                }
            }
        }

        // Check if any tracked request was removed
        for (const trackedKey of knownKeys) {
            if (!allRequests[trackedKey]) {
                knownKeys.delete(trackedKey);
                if (trackedKey === currentNotificationKey) {
                    hideCallNotification();
                    showDoctorToast('Patient cancelled the request.', 'success');
                }
            }
        }

        isFirstLoad = false;

    }, (error) => {
        console.error('[RTDB] Error listening for doctor requests:', error);
        showDoctorToast('Error connecting to request system: ' + error.message, 'error');
    });

    console.log('[RTDB] Listener set up successfully.');
}

function showCallNotification(requestKey, requestData, doctorId, doctorName) {
    currentNotificationKey = requestKey;

    const overlay = document.getElementById('doctor-notification-overlay');
    const patientNameEl = document.getElementById('notif-patient-name');
    const requestTimeEl = document.getElementById('notif-request-time');
    const acceptBtn = document.getElementById('btn-accept-call');
    const ignoreBtn = document.getElementById('btn-ignore-call');

    if (patientNameEl) patientNameEl.textContent = requestData.patientName || 'Unknown Patient';
    if (requestTimeEl) {
        const ts = requestData.timestamp;
        requestTimeEl.textContent = ts ? formatTimestamp({ toDate: () => new Date(ts) }) : 'Just now';
    }

    if (overlay) {
        overlay.style.display = 'flex';
        // Trigger entrance animation
        requestAnimationFrame(() => overlay.classList.add('active'));
    }

    // Flash the notification bell
    flashNotificationBell();

    // Wire up accept button
    if (acceptBtn) {
        acceptBtn.onclick = () => handleAcceptCall(requestKey, doctorId, doctorName);
    }

    // Wire up ignore button
    if (ignoreBtn) {
        ignoreBtn.onclick = () => handleIgnoreCall();
    }
}

function hideCallNotification() {
    const overlay = document.getElementById('doctor-notification-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 300);
    }
    currentNotificationKey = null;
}

async function handleAcceptCall(requestKey, doctorId, doctorName) {
    const acceptBtn = document.getElementById('btn-accept-call');
    if (acceptBtn) {
        acceptBtn.disabled = true;
        acceptBtn.textContent = '⏳ Accepting...';
    }

    try {
        // Check if still pending
        const snapshot = await rtdb.ref('doctorRequests/' + requestKey).once('value');
        const data = snapshot.val();

        if (!data || data.status !== 'pending') {
            showDoctorToast('This request is no longer available.', 'error');
            hideCallNotification();
            return;
        }

        // Update request in RTDB (existing behavior)
        await rtdb.ref('doctorRequests/' + requestKey).update({
            status: 'accepted',
            doctorId: doctorId,
            doctorName: doctorName,
            acceptedAt: firebase.database.ServerValue.TIMESTAMP
        });

        // ── NEW: Update Firestore emergencyRequests + send consultation notification ──
        try {
            // Find the matching emergencyRequests doc by rtdbKey
            const emergencySnap = await db.collection('emergencyRequests')
                .where('rtdbKey', '==', requestKey)
                .where('status', '==', 'pending')
                .limit(1)
                .get();

            if (!emergencySnap.empty) {
                const emergencyDoc = emergencySnap.docs[0];

                // Update the emergency request
                await emergencyDoc.ref.update({
                    status: 'accepted',
                    assignedDoctorId: doctorId,
                    acceptedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                // Fetch doctor's Google Meet link
                let meetLink = '';
                try {
                    const doctorDoc = await db.collection('doctors').doc(doctorId).get();
                    if (doctorDoc.exists) {
                        meetLink = doctorDoc.data().gmeet || '';
                    }
                } catch (e) {
                    console.warn('Could not fetch doctor gmeet link:', e);
                }

                // Create patient notification with meet link
                const patientId = emergencyDoc.data().patientId;
                await db.collection('notifications').add({
                    patientId: patientId,
                    title: 'Doctor Ready for Consultation',
                    message: 'Your doctor is available now. Join consultation.',
                    meetLink: meetLink,
                    doctorName: doctorName,
                    type: 'emergency_consult',
                    status: 'pending',
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        } catch (e) {
            console.warn('Could not update Firestore emergency request or send notification:', e);
        }

        hideCallNotification();
        showDoctorToast('Request accepted! Patient has been notified.', 'success');

    } catch (error) {
        console.error('Error accepting call request:', error);
        showDoctorToast('Failed to accept request. Please try again.', 'error');
    } finally {
        if (acceptBtn) {
            acceptBtn.disabled = false;
            acceptBtn.textContent = '✅ Accept';
        }
    }
}

function handleIgnoreCall() {
    hideCallNotification();
    // No database update needed — other doctors can still accept
}

// Update the doctorIsOnline flag when status toggles
function updateDoctorOnlineFlag(isOnline) {
    doctorIsOnline = isOnline;
    if (!isOnline) {
        hideCallNotification();
    }
}

// ============================================
// Appointment Requests — Specialization Filtering
// ============================================

function listenForAppointments(doctorId, doctorName, doctorSpec) {
    const container = document.getElementById('appointments-container');
    const emptyState = document.getElementById('empty-appointments');
    if (!container) return;

    unsubscribeAppointments = db.collection('appointments')
        .where('specialization', '==', doctorSpec)
        .where('status', '==', 'pending')
        .orderBy('createdAt', 'desc')
        .onSnapshot((snapshot) => {
            // Remove existing appointment cards
            container.querySelectorAll('.appt-request-card').forEach(c => c.remove());

            if (snapshot.empty) {
                if (emptyState) emptyState.style.display = 'flex';
                return;
            }

            if (emptyState) emptyState.style.display = 'none';

            snapshot.forEach((doc) => {
                const appt = doc.data();
                renderAppointmentCard(doc.id, appt, doctorId, doctorName, container);
            });

            // Toast for new appointments
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added' && !change.doc.metadata.hasPendingWrites) {
                    const appt = change.doc.data();
                    showDoctorToast(`New appointment request from ${appt.patientName || 'a patient'}!`, 'success');
                    flashNotificationBell();
                }
            });
        }, (error) => {
            console.error('Error listening for appointments:', error);
            if (emptyState) emptyState.style.display = 'flex';
        });
}

function renderAppointmentCard(appointmentId, appt, doctorId, doctorName, container) {
    const card = document.createElement('div');
    card.className = 'appt-request-card request-card glass-card request-new';

    card.innerHTML = `
        <div class="request-card-header">
            <div class="request-patient-info">
                <div class="request-avatar">${(appt.patientName || 'P').charAt(0).toUpperCase()}</div>
                <div>
                    <h3 class="request-patient-name">${escapeHtml(appt.patientName || 'Unknown Patient')}</h3>
                    <span class="request-time">Age: ${escapeHtml(String(appt.age || 'N/A'))}</span>
                </div>
            </div>
            <span class="request-status status-pending">⏳ Pending</span>
        </div>
        <div class="request-card-body">
            <p class="request-condition">
                <strong>Purpose:</strong> ${escapeHtml(appt.purpose || 'No purpose provided')}
            </p>
            <p style="margin-top: 6px; font-size: 0.88rem; color: var(--color-text-muted);">
                📅 ${escapeHtml(appt.date || '')} &nbsp; 🕐 ${escapeHtml(appt.time || '')}
            </p>
        </div>
        <div class="request-card-actions">
            <button class="btn btn-accept" onclick="acceptAppointment('${appointmentId}', '${doctorId}', '${escapeHtml(doctorName)}')">✅ Accept</button>
            <button class="btn btn-decline" onclick="rejectAppointment('${appointmentId}')">❌ Reject</button>
        </div>
    `;

    container.appendChild(card);
}

async function acceptAppointment(appointmentId, doctorId, doctorName) {
    try {
        await db.collection('appointments').doc(appointmentId).update({
            status: 'accepted',
            doctorId: doctorId,
            doctorName: doctorName,
            respondedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showDoctorToast('Appointment accepted!', 'success');
    } catch (error) {
        console.error('Error accepting appointment:', error);
        showDoctorToast('Failed to accept appointment.', 'error');
    }
}

async function rejectAppointment(appointmentId) {
    try {
        await db.collection('appointments').doc(appointmentId).update({
            status: 'rejected',
            respondedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showDoctorToast('Appointment rejected.', 'success');
    } catch (error) {
        console.error('Error rejecting appointment:', error);
        showDoctorToast('Failed to reject appointment.', 'error');
    }
}
