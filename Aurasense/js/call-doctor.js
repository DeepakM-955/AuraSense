// ============================================
// AuraSense — Call a Doctor Module
// ============================================

(function () {
    let currentRequestRef = null;
    let statusListener = null;
    let currentEmergencyDocId = null;

    // Wait for auth to be ready, then initialize
    document.addEventListener('DOMContentLoaded', () => {
        auth.onAuthStateChanged((user) => {
            if (user) initCallDoctor(user);
        });
    });

    function initCallDoctor(user) {
        const callBtn = document.getElementById('btn-call-doctor');
        const cancelBtn = document.getElementById('btn-cancel-call');

        if (callBtn) {
            callBtn.addEventListener('click', () => handleCallDoctor(user));
        }
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => handleCancelCall());
        }

        // Check if there's already an active request from this patient
        checkExistingRequest(user);
    }

    // ── Check for an existing pending request ──
    async function checkExistingRequest(user) {
        try {
            const snapshot = await rtdb.ref('doctorRequests')
                .orderByChild('patientId')
                .equalTo(user.uid)
                .once('value');

            if (snapshot.exists()) {
                const requests = snapshot.val();
                for (const [key, req] of Object.entries(requests)) {
                    if (req.status === 'pending') {
                        // Resume listening to this request
                        currentRequestRef = rtdb.ref('doctorRequests/' + key);
                        showPendingState();
                        listenForStatusChange(user);
                        return;
                    }
                }
            }
        } catch (error) {
            console.error('Error checking existing requests:', error);
        }
    }

    // ── Handle Call a Doctor button click ──
    async function handleCallDoctor(user) {
        const callBtn = document.getElementById('btn-call-doctor');
        if (!callBtn || callBtn.disabled) return;

        // Disable button immediately
        callBtn.disabled = true;
        callBtn.classList.add('loading');

        try {
            // Verify RTDB is available
            if (typeof rtdb === 'undefined' || !rtdb) {
                throw new Error('Realtime Database not initialized. Check firebase-config.js');
            }

            // Get patient details from Firestore
            let patientName = user.displayName || 'Patient';
            let patientAge = '';
            try {
                const doc = await db.collection('users').doc(user.uid).get();
                if (doc.exists) {
                    const data = doc.data();
                    if (data.name) patientName = data.name;
                    if (data.age) patientAge = data.age;
                }
            } catch (e) {
                console.warn('Could not fetch patient details:', e);
            }

            // Snapshot current vitals from the DOM (if monitoring is active)
            const vitalsSnapshot = {};
            const heartEl = document.getElementById('vital-heart');
            const spo2El = document.getElementById('vital-spo2');
            const tempEl = document.getElementById('vital-temp');
            if (heartEl && heartEl.textContent !== '--' && !heartEl.textContent.startsWith('Waiting')) {
                vitalsSnapshot.bpm = heartEl.textContent.replace(/[^0-9.]/g, '');
            }
            if (spo2El && spo2El.textContent !== '--' && !spo2El.textContent.startsWith('Waiting')) {
                vitalsSnapshot.spo2 = spo2El.textContent.replace(/[^0-9.]/g, '');
            }
            if (tempEl && tempEl.textContent !== '--' && !tempEl.textContent.startsWith('Waiting')) {
                vitalsSnapshot.temp = tempEl.textContent.replace(/[^0-9.]/g, '');
            }

            // Create new request in RTDB (existing behavior)
            const newRequestRef = rtdb.ref('doctorRequests').push();
            await newRequestRef.set({
                patientId: user.uid,
                patientName: patientName,
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                status: 'pending'
            });

            currentRequestRef = newRequestRef;

            // Create Firestore emergencyRequests document
            try {
                const emergencyDoc = await db.collection('emergencyRequests').add({
                    patientId: user.uid,
                    patientName: patientName,
                    patientAge: patientAge,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                    requestType: 'emergency',
                    status: 'pending',
                    vitalsSnapshot: vitalsSnapshot,
                    assignedDoctorId: null,
                    rtdbKey: newRequestRef.key
                });
                currentEmergencyDocId = emergencyDoc.id;
            } catch (e) {
                console.warn('Could not create Firestore emergency request:', e);
            }

            // Show pending state
            showPendingState();

            // Listen for status changes
            listenForStatusChange(user);

            showToast('Request sent! Waiting for a doctor to respond...', 'success');

        } catch (error) {
            console.error('Error creating doctor request:', error);
            const errMsg = error.message || error.code || String(error);
            showToast('Error: ' + errMsg, 'error');
            callBtn.disabled = false;
            callBtn.classList.remove('loading');
        }
    }

    // ── Show pending / waiting state ──
    function showPendingState() {
        const callBtn = document.getElementById('btn-call-doctor');
        const statusEl = document.getElementById('call-status');
        const statusIcon = document.getElementById('call-status-icon');
        const statusText = document.getElementById('call-status-text');
        const cancelBtn = document.getElementById('btn-cancel-call');

        if (callBtn) {
            callBtn.disabled = true;
            callBtn.classList.add('disabled');
        }

        if (statusEl) {
            statusEl.style.display = 'flex';
            statusEl.className = 'call-status pending';
        }
        if (statusIcon) statusIcon.textContent = '⏳';
        if (statusText) statusText.textContent = 'Please wait, connecting you to an available doctor…';
        if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    }

    // ── Show accepted / connected state ──
    function showAcceptedState(doctorName) {
        const callBtn = document.getElementById('btn-call-doctor');
        const statusEl = document.getElementById('call-status');
        const statusIcon = document.getElementById('call-status-icon');
        const statusText = document.getElementById('call-status-text');
        const cancelBtn = document.getElementById('btn-cancel-call');

        if (statusEl) {
            statusEl.className = 'call-status accepted';
        }
        if (statusIcon) statusIcon.textContent = '✅';
        if (statusText) {
            statusText.textContent = doctorName
                ? `Doctor ${doctorName} is connected!`
                : 'Doctor connected!';
        }
        if (cancelBtn) cancelBtn.style.display = 'none';

        showToast('A doctor has accepted your request!', 'success');

        // Re-enable "Call a Doctor" button after 30 seconds
        setTimeout(() => resetCallButton(), 30000);
    }

    // ── Listen for status changes on the request ──
    function listenForStatusChange(user) {
        if (!currentRequestRef) return;

        // Remove any existing listener
        if (statusListener) {
            currentRequestRef.off('value', statusListener);
        }

        statusListener = currentRequestRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (!data) {
                // Request was deleted
                resetCallButton();
                return;
            }

            if (data.status === 'accepted') {
                showAcceptedState(data.doctorName || null);
                // Stop listening after acceptance
                currentRequestRef.off('value', statusListener);
                statusListener = null;
            }
        });
    }

    // ── Cancel an existing request ──
    async function handleCancelCall() {
        if (!currentRequestRef) return;

        try {
            await currentRequestRef.remove();

            // Also delete the Firestore emergency request
            if (currentEmergencyDocId) {
                try {
                    await db.collection('emergencyRequests').doc(currentEmergencyDocId).delete();
                } catch (e) {
                    console.warn('Could not delete Firestore emergency request:', e);
                }
                currentEmergencyDocId = null;
            }

            resetCallButton();
            showToast('Request cancelled.', 'success');
        } catch (error) {
            console.error('Error cancelling request:', error);
            showToast('Failed to cancel request.', 'error');
        }
    }

    // ── Reset button to default state ──
    function resetCallButton() {
        const callBtn = document.getElementById('btn-call-doctor');
        const statusEl = document.getElementById('call-status');
        const cancelBtn = document.getElementById('btn-cancel-call');

        if (callBtn) {
            callBtn.disabled = false;
            callBtn.classList.remove('loading', 'disabled');
        }
        if (statusEl) {
            statusEl.style.display = 'none';
            statusEl.className = 'call-status';
        }
        if (cancelBtn) cancelBtn.style.display = 'none';

        // Clean up listener
        if (currentRequestRef && statusListener) {
            currentRequestRef.off('value', statusListener);
        }
        statusListener = null;
        currentRequestRef = null;
        currentEmergencyDocId = null;
    }

    // ── Cleanup on page unload ──
    window.addEventListener('beforeunload', () => {
        if (currentRequestRef && statusListener) {
            currentRequestRef.off('value', statusListener);
        }
    });
})();
