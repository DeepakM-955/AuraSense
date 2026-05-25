// ============================================
// AuraSense — Appointment Booking Module
// ============================================

// ── Book Appointment (Patient Side) ──
async function bookAppointment(e) {
    e.preventDefault();

    const btn = e.target.querySelector('button[type="submit"]');
    const specialization = document.getElementById('appt-specialization').value;
    const date = document.getElementById('appt-date').value;
    const time = document.getElementById('appt-time').value;
    const purpose = document.getElementById('appt-purpose').value.trim();

    hideAlert('appointment-alert');

    if (!specialization || !date || !time || !purpose) {
        showAlert('appointment-alert', 'Please fill in all appointment fields.');
        return;
    }

    const user = auth.currentUser;
    if (!user) {
        showAlert('appointment-alert', 'You must be logged in to book an appointment.');
        return;
    }

    setLoading(btn, true);

    try {
        // Get patient details from Firestore
        let patientName = user.displayName || 'Patient';
        let patientAge = '';
        try {
            const doc = await db.collection('users').doc(user.uid).get();
            if (doc.exists) {
                const data = doc.data();
                patientName = data.name || patientName;
                patientAge = data.age || '';
            }
        } catch (err) {
            console.warn('Could not fetch patient details:', err);
        }

        // Create appointment document in Firestore
        await db.collection('appointments').add({
            patientId: user.uid,
            patientName: patientName,
            age: patientAge,
            specialization: specialization,
            date: date,
            time: time,
            purpose: purpose,
            status: 'pending',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        showAlert('appointment-alert', 'Appointment booked successfully! You will be notified when a doctor responds.', 'success');

        // Reset form
        document.getElementById('appointment-form').reset();

    } catch (error) {
        console.error('Error booking appointment:', error);
        showAlert('appointment-alert', 'Failed to book appointment. Please try again.');
    } finally {
        setLoading(btn, false);
    }
}

// ── Listen for Patient's Own Appointments (Real-time) ──
function listenForMyAppointments(user) {
    const container = document.getElementById('my-appointments-container');
    const emptyState = document.getElementById('no-appointments');
    if (!container) return;

    db.collection('appointments')
        .where('patientId', '==', user.uid)
        .orderBy('createdAt', 'desc')
        .onSnapshot((snapshot) => {
            // Remove existing cards
            container.querySelectorAll('.appointment-card').forEach(c => c.remove());

            if (snapshot.empty) {
                if (emptyState) emptyState.style.display = 'block';
                return;
            }

            if (emptyState) emptyState.style.display = 'none';

            snapshot.forEach((doc) => {
                const appt = doc.data();
                const card = document.createElement('div');
                card.className = 'appointment-card glass-card';
                card.style.cssText = 'padding: 20px; margin-bottom: 12px; text-align: left;';

                const statusColor = appt.status === 'pending' ? 'var(--color-warning)'
                    : appt.status === 'accepted' ? 'var(--color-success)'
                        : 'var(--color-error)';
                const statusIcon = appt.status === 'pending' ? '⏳'
                    : appt.status === 'accepted' ? '✅'
                        : '❌';
                const statusLabel = appt.status.charAt(0).toUpperCase() + appt.status.slice(1);

                let doctorInfo = '';
                if (appt.status === 'accepted' && appt.doctorName) {
                    doctorInfo = `<div style="margin-top: 8px; padding: 8px 12px; background: rgba(0, 201, 167, 0.1); border-radius: 8px; font-size: 0.85rem; color: var(--color-success);">
                        🩺 Dr. ${escapeHtmlAppt(appt.doctorName)} accepted your appointment
                    </div>`;
                }
                if (appt.status === 'rejected') {
                    doctorInfo = `<div style="margin-top: 8px; padding: 8px 12px; background: rgba(255, 107, 107, 0.1); border-radius: 8px; font-size: 0.85rem; color: var(--color-error);">
                        Appointment was not accepted. Please try booking again.
                    </div>`;
                }

                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <div style="font-weight: 600; color: var(--color-text-heading); font-size: 1rem;">
                            🏥 ${escapeHtmlAppt(appt.specialization)}
                        </div>
                        <span style="padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 600;
                            background: ${statusColor}22; color: ${statusColor}; text-transform: uppercase;">
                            ${statusIcon} ${statusLabel}
                        </span>
                    </div>
                    <div style="font-size: 0.88rem; color: var(--color-text-muted); display: flex; gap: 16px; margin-bottom: 6px;">
                        <span>📅 ${appt.date}</span>
                        <span>🕐 ${appt.time}</span>
                    </div>
                    <div style="font-size: 0.9rem; color: var(--color-text);">
                        <strong>Purpose:</strong> ${escapeHtmlAppt(appt.purpose)}
                    </div>
                    ${doctorInfo}
                `;

                container.appendChild(card);
            });

            // Flash notification for status changes
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'modified') {
                    const appt = change.doc.data();
                    if (appt.status === 'accepted') {
                        showToast(`Your ${appt.specialization} appointment has been accepted!`, 'success');
                    } else if (appt.status === 'rejected') {
                        showToast(`Your ${appt.specialization} appointment was not accepted.`, 'error');
                    }
                }
            });
        }, (error) => {
            console.error('Error listening for appointments:', error);
        });
}

// ── Utility: Escape HTML ──
function escapeHtmlAppt(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

// ── Initialize appointment listener when dashboard loads ──
document.addEventListener('DOMContentLoaded', () => {
    auth.onAuthStateChanged((user) => {
        if (user) {
            listenForMyAppointments(user);
        }
    });
});
