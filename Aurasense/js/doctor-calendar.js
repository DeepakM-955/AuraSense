// ============================================
// AuraSense — Doctor Appointment Calendar
// ============================================

let currentYear, currentMonth;
let allAppointments = [];
let unsubscribeCalendar = null;

document.addEventListener('DOMContentLoaded', () => {
    requireDoctorAuth(initCalendar);
});

function initCalendar(doctorData) {
    const doctorId = doctorData.id || sessionStorage.getItem('doctorId');

    // Setup logout
    const logoutBtn = document.getElementById('doctor-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logoutDoctor);
    }

    // Close modal on overlay click
    const overlay = document.getElementById('cal-modal-overlay');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeCalModal();
        });
    }

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeCalModal();
    });

    // Initialize to current month
    const now = new Date();
    currentYear = now.getFullYear();
    currentMonth = now.getMonth();

    // Start real-time listener for accepted appointments
    listenForAcceptedAppointments(doctorId);
}

// ── Real-time listener for accepted appointments ──
function listenForAcceptedAppointments(doctorId) {
    if (unsubscribeCalendar) unsubscribeCalendar();

    unsubscribeCalendar = db.collection('appointments')
        .where('doctorId', '==', doctorId)
        .where('status', '==', 'accepted')
        .onSnapshot((snapshot) => {
            allAppointments = [];
            snapshot.forEach((doc) => {
                allAppointments.push({ id: doc.id, ...doc.data() });
            });

            // Re-render calendar with updated data
            renderCalendar();
            updateStats();
        }, (error) => {
            console.error('Error listening for calendar appointments:', error);
        });
}

// ── Render Calendar Grid ──
function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    const label = document.getElementById('calendar-month-label');
    if (!grid) return;

    const months = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    label.textContent = `${months[currentMonth]} ${currentYear}`;

    // Clear grid
    grid.innerHTML = '';

    // Day labels
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayNames.forEach(d => {
        const el = document.createElement('div');
        el.className = 'calendar-day-label';
        el.textContent = d;
        grid.appendChild(el);
    });

    // Calculate grid dates
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const startOffset = firstDay.getDay(); // 0 = Sunday
    const daysInMonth = lastDay.getDate();

    const today = new Date();
    const todayStr = formatDate(today);

    // Previous month trailing days
    const prevMonthLast = new Date(currentYear, currentMonth, 0).getDate();
    for (let i = startOffset - 1; i >= 0; i--) {
        const day = prevMonthLast - i;
        const cell = createDayCell(day, true);
        grid.appendChild(cell);
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isToday = dateStr === todayStr;
        const dayAppts = getAppointmentsForDate(dateStr);
        const cell = createDayCell(day, false, isToday, dayAppts, dateStr);
        grid.appendChild(cell);
    }

    // Next month leading days 
    const totalCells = startOffset + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= remaining; i++) {
        const cell = createDayCell(i, true);
        grid.appendChild(cell);
    }
}

function createDayCell(day, isOtherMonth, isToday = false, appointments = [], dateStr = '') {
    const cell = document.createElement('div');
    cell.className = 'calendar-cell';
    if (isOtherMonth) cell.classList.add('other-month');
    if (isToday) cell.classList.add('today');

    const dateLabel = document.createElement('div');
    dateLabel.className = 'calendar-date';
    dateLabel.textContent = day;
    cell.appendChild(dateLabel);

    if (!isOtherMonth && appointments.length > 0) {
        // Show up to 2 events, then "+X more"
        const maxVisible = 2;
        appointments.slice(0, maxVisible).forEach(appt => {
            const eventEl = document.createElement('div');
            eventEl.className = 'calendar-event';
            eventEl.textContent = `${appt.time || ''} ${appt.patientName || 'Patient'}`;
            eventEl.addEventListener('click', (e) => {
                e.stopPropagation();
                showAppointmentDetail(appt);
            });
            cell.appendChild(eventEl);
        });

        if (appointments.length > maxVisible) {
            const moreEl = document.createElement('div');
            moreEl.className = 'calendar-more';
            moreEl.textContent = `+${appointments.length - maxVisible} more`;
            cell.appendChild(moreEl);
        }

        // Click on cell to show all events for the day
        cell.addEventListener('click', () => showDayDetail(dateStr, appointments));
    }

    return cell;
}

// ── Get appointments for a specific date ──
function getAppointmentsForDate(dateStr) {
    return allAppointments.filter(a => a.date === dateStr)
        .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
}

// ── Format date to YYYY-MM-DD ──
function formatDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// ── Nav: Previous / Next month ──
function navigateMonth(delta) {
    currentMonth += delta;
    if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
    } else if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
    }
    renderCalendar();
}

function goToToday() {
    const now = new Date();
    currentYear = now.getFullYear();
    currentMonth = now.getMonth();
    renderCalendar();
}

// ── Update Stats ──
function updateStats() {
    const now = new Date();
    const todayStr = formatDate(now);

    // This month
    const thisMonthCount = allAppointments.filter(a => {
        if (!a.date) return false;
        const [y, m] = a.date.split('-').map(Number);
        return y === now.getFullYear() && m === now.getMonth() + 1;
    }).length;

    // This week (Sunday to Saturday)
    const dayOfWeek = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const thisWeekCount = allAppointments.filter(a => {
        if (!a.date) return false;
        const d = new Date(a.date + 'T00:00:00');
        return d >= weekStart && d <= weekEnd;
    }).length;

    // Today
    const todayCount = allAppointments.filter(a => a.date === todayStr).length;

    const monthEl = document.getElementById('stat-this-month');
    const weekEl = document.getElementById('stat-this-week');
    const todayEl = document.getElementById('stat-today');
    if (monthEl) monthEl.textContent = thisMonthCount;
    if (weekEl) weekEl.textContent = thisWeekCount;
    if (todayEl) todayEl.textContent = todayCount;
}

// ── Show detail modal for a single appointment ──
function showAppointmentDetail(appt) {
    const overlay = document.getElementById('cal-modal-overlay');
    const title = document.getElementById('cal-modal-title');
    const body = document.getElementById('cal-modal-body');
    if (!overlay || !body) return;

    title.textContent = 'Appointment Details';

    // Fetch patient email from users collection
    let emailPromise = Promise.resolve('');
    if (appt.patientId) {
        emailPromise = db.collection('users').doc(appt.patientId).get()
            .then(doc => doc.exists ? (doc.data().email || '') : '')
            .catch(() => '');
    }

    emailPromise.then(patientEmail => {
        body.innerHTML = `
            <div class="cal-detail-row">
                <span class="cal-detail-label">👤 Patient</span>
                <span class="cal-detail-value">${escapeHtmlCal(appt.patientName || 'N/A')}</span>
            </div>
            <div class="cal-detail-row">
                <span class="cal-detail-label">📧 Email</span>
                <span class="cal-detail-value">${escapeHtmlCal(patientEmail || appt.patientEmail || 'N/A')}</span>
            </div>
            <div class="cal-detail-row">
                <span class="cal-detail-label">🎂 Age</span>
                <span class="cal-detail-value">${escapeHtmlCal(String(appt.age || 'N/A'))}</span>
            </div>
            <div class="cal-detail-row">
                <span class="cal-detail-label">🏥 Specialization</span>
                <span class="cal-detail-value">${escapeHtmlCal(appt.specialization || 'N/A')}</span>
            </div>
            <div class="cal-detail-row">
                <span class="cal-detail-label">📅 Date</span>
                <span class="cal-detail-value">${escapeHtmlCal(appt.date || 'N/A')}</span>
            </div>
            <div class="cal-detail-row">
                <span class="cal-detail-label">🕐 Time</span>
                <span class="cal-detail-value">${escapeHtmlCal(appt.time || 'N/A')}</span>
            </div>
            <div class="cal-detail-purpose">
                <span class="cal-detail-label">📝 Purpose of Visit</span>
                <div class="cal-detail-value">${escapeHtmlCal(appt.purpose || 'No purpose provided')}</div>
            </div>
            <div style="margin-top: 20px; display: flex; gap: 10px;">
                <button class="btn btn-save" id="btn-invite-consult" style="flex: 1; padding: 12px 16px;"
                    onclick="sendConsultationInvite(this)">📩 Invite</button>
                <button class="btn btn-save" id="btn-live-readings" style="flex: 1; padding: 12px 16px;
                    background: linear-gradient(135deg, #667eea, #764ba2);"
                    onclick="openLiveReadings(this)">📊 Live Readings</button>
            </div>
        `;

        // Store appointment data on buttons
        const inviteBtn = document.getElementById('btn-invite-consult');
        if (inviteBtn) inviteBtn._apptData = appt;
        const liveBtn = document.getElementById('btn-live-readings');
        if (liveBtn) liveBtn._apptData = appt;

        overlay.style.display = 'flex';
        requestAnimationFrame(() => overlay.classList.add('active'));
    });
}

// ── Show all appointments for a day ──
function showDayDetail(dateStr, appointments) {
    const overlay = document.getElementById('cal-modal-overlay');
    const title = document.getElementById('cal-modal-title');
    const body = document.getElementById('cal-modal-body');
    if (!overlay || !body) return;

    // Format date nicely
    const d = new Date(dateStr + 'T00:00:00');
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    title.textContent = d.toLocaleDateString('en-US', options);

    if (appointments.length === 0) {
        body.innerHTML = '<p style="color: var(--color-text-muted); text-align: center; padding: 20px;">No appointments on this day.</p>';
    } else {
        let html = '<div class="cal-day-events">';
        appointments.forEach(appt => {
            html += `
                <div class="cal-day-event-card" onclick='showAppointmentDetail(${JSON.stringify(appt).replace(/'/g, "&#39;")})'>
                    <div class="cal-day-event-time">🕐 ${escapeHtmlCal(appt.time || 'No time')}</div>
                    <div class="cal-day-event-name">👤 ${escapeHtmlCal(appt.patientName || 'Unknown Patient')}</div>
                    <div class="cal-day-event-purpose">${escapeHtmlCal(appt.purpose || 'No purpose')}</div>
                </div>
            `;
        });
        html += '</div>';
        body.innerHTML = html;
    }

    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('active'));
}

// ── Close modal ──
function closeCalModal() {
    const overlay = document.getElementById('cal-modal-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        setTimeout(() => { overlay.style.display = 'none'; }, 300);
    }
}

// ── Escape HTML ──
function escapeHtmlCal(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

// ── Open Live Readings ──
function openLiveReadings(btn) {
    const appt = btn._apptData;
    if (!appt || !appt.patientId) {
        showDoctorToast('Patient data not found for this appointment.', 'error');
        return;
    }
    const patientName = encodeURIComponent(appt.patientName || 'Patient');
    const patientId = encodeURIComponent(appt.patientId);
    window.open(`doctor-live-vitals.html?patientId=${patientId}&patientName=${patientName}`, '_blank');
}

// ── Send Consultation Invite ──
async function sendConsultationInvite(btn) {
    const appt = btn._apptData;
    if (!appt) {
        showDoctorToast('No appointment data found.', 'error');
        return;
    }

    const doctorId = sessionStorage.getItem('doctorId');
    if (!doctorId) {
        showDoctorToast('Doctor session not found. Please log in again.', 'error');
        return;
    }

    // Disable button immediately to prevent duplicates
    btn.disabled = true;
    btn.textContent = '⏳ Sending...';

    try {
        // Fetch doctor's gmeet link
        const doctorDoc = await db.collection('doctors').doc(doctorId).get();
        if (!doctorDoc.exists) {
            showDoctorToast('Doctor record not found.', 'error');
            btn.disabled = false;
            btn.textContent = '📩 Invite to Consultation';
            return;
        }

        const doctorData = doctorDoc.data();
        const meetLink = doctorData.gmeet || '';
        if (!meetLink) {
            showDoctorToast('No Google Meet link configured. Please add one in your profile.', 'error');
            btn.disabled = false;
            btn.textContent = '📩 Invite to Consultation';
            return;
        }

        // Create notification for the patient
        await db.collection('notifications').add({
            patientId: appt.patientId,
            appointmentId: appt.id || '',
            doctorId: doctorId,
            doctorName: doctorData.name || sessionStorage.getItem('doctorName') || 'Doctor',
            title: 'Consultation Invitation',
            message: 'Your doctor has invited you to join the consultation',
            meetLink: meetLink,
            status: 'pending',
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        btn.textContent = '✅ Invite Sent';
        showDoctorToast('Consultation invite sent to patient!', 'success');
    } catch (error) {
        console.error('Error sending consultation invite:', error);
        showDoctorToast('Failed to send invite. Please try again.', 'error');
        btn.disabled = false;
        btn.textContent = '📩 Invite to Consultation';
    }
}

// ── Cleanup on page unload ──
window.addEventListener('beforeunload', () => {
    if (unsubscribeCalendar) unsubscribeCalendar();
});
