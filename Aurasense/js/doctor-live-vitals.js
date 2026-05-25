// ============================================
// AuraSense — Doctor Live Vitals Module
// ============================================

(function () {
    let vitalListener = null;

    document.addEventListener('DOMContentLoaded', () => {
        // Verify doctor session
        const doctorId = sessionStorage.getItem('doctorId');
        if (!doctorId) {
            window.location.href = 'doctor-login.html';
            return;
        }

        // Get patient info from URL params
        const params = new URLSearchParams(window.location.search);
        const patientId = params.get('patientId');
        const patientName = params.get('patientName') || 'Patient';

        if (!patientId) {
            showLVToast('No patient specified.', 'error');
            return;
        }

        // Display patient info
        const nameEl = document.getElementById('lv-patient-name');
        const idEl = document.getElementById('lv-patient-id');
        if (nameEl) nameEl.textContent = '👤 ' + decodeURIComponent(patientName);
        if (idEl) idEl.textContent = 'ID: ' + patientId;

        // Fetch patient name from Firestore to map to RTDB node
        initLiveVitals(patientId, decodeURIComponent(patientName));
    });

    async function initLiveVitals(patientId, fallbackName) {
        try {
            // Try to get patient name from Firestore first
            let patientName = fallbackName;
            const userDoc = await db.collection('users').doc(patientId).get();
            if (userDoc.exists) {
                patientName = userDoc.data().name || fallbackName;
            }

            // Start RTDB listener
            startVitalListener(patientName);
        } catch (error) {
            console.error('Error initializing live vitals:', error);
            // Fall back to using the name from URL
            startVitalListener(fallbackName);
        }
    }

    function startVitalListener(patientName) {
        const patientRef = rtdb.ref('Patients/' + patientName);

        // Show live indicator
        const liveIndicator = document.getElementById('lv-live-indicator');
        if (liveIndicator) liveIndicator.style.display = 'flex';

        showLVToast('Connected! Monitoring ' + patientName + '\'s vitals.', 'success');

        vitalListener = patientRef.on('value', (snapshot) => {
            const data = snapshot.val();

            if (!data) {
                showWaiting();
                return;
            }

            // ── Heart Rate ──
            const bpm = data.bpm;
            const heartEl = document.getElementById('lv-heart');
            if (heartEl) {
                heartEl.textContent = (bpm !== undefined && bpm !== null) ? bpm + ' bpm' : 'Waiting…';
            }
            setStatus('lv-heart-status', evaluateHeartRate(bpm));

            // ── SpO2 ──
            const spo2 = data.spo2;
            const spo2El = document.getElementById('lv-spo2');
            if (spo2El) {
                spo2El.textContent = (spo2 !== undefined && spo2 !== null) ? spo2 + '%' : 'Waiting…';
            }
            setStatus('lv-spo2-status', evaluateSpO2(spo2));

            // ── Temperature ──
            const temp = data.temp;
            const tempEl = document.getElementById('lv-temp');
            if (tempEl) {
                tempEl.textContent = (temp !== undefined && temp !== null) ? temp + '°C' : 'Waiting…';
            }
            setStatus('lv-temp-status', evaluateTemp(temp));

            // ── Location ──
            const locEl = document.getElementById('lv-location');
            if (locEl) {
                locEl.textContent = data.location || 'Unknown';
            }
            const locStatus = document.getElementById('lv-location-status');
            if (locStatus) locStatus.textContent = data.status || '--';

            // ── Map Link ──
            const mapLink = document.getElementById('lv-map-link');
            if (mapLink) {
                if (data.map) {
                    mapLink.href = data.map;
                    mapLink.style.display = 'inline-flex';
                } else {
                    mapLink.style.display = 'none';
                }
            }

            // ── Alert Banner ──
            updateAlertBanner(data.alert);

        }, (error) => {
            console.error('RTDB listener error:', error);
            showWaiting();
        });
    }

    function showWaiting() {
        const ids = ['lv-heart', 'lv-spo2', 'lv-temp', 'lv-location'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = 'Waiting for device…';
        });
    }

    // ── Vital Status Evaluation ──
    function evaluateHeartRate(bpm) {
        if (bpm === undefined || bpm === null) return { label: '--', level: 'normal' };
        const v = Number(bpm);
        if (v < 40 || v > 130) return { label: 'Critical', level: 'critical' };
        if (v < 60 || v > 100) return { label: 'Abnormal', level: 'warning' };
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

    function setStatus(elementId, status) {
        const el = document.getElementById(elementId);
        if (!el) return;
        el.textContent = status.label;
        el.className = 'card-status ' + status.level;
    }

    function updateAlertBanner(alert) {
        const banner = document.getElementById('lv-alert-banner');
        if (!banner) return;

        if (!alert || alert === 'normal' || alert === 'NORMAL') {
            banner.className = 'alert-banner normal active';
            banner.textContent = '✅ All vitals are within normal range';
        } else if (alert === 'warning' || alert === 'WARNING' || alert === 'abnormal' || alert === 'ABNORMAL') {
            banner.className = 'alert-banner warning active';
            banner.textContent = '⚠️ Some vitals are outside normal range';
        } else if (alert === 'critical' || alert === 'CRITICAL') {
            banner.className = 'alert-banner critical active';
            banner.textContent = '🚨 CRITICAL — Immediate attention required!';
        } else {
            // Use alert value as-is
            banner.className = 'alert-banner warning active';
            banner.textContent = '⚠️ Alert: ' + alert;
        }
    }

    // ── Toast ──
    function showLVToast(message, type) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'toast ' + (type || 'success');
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ── Cleanup ──
    window.addEventListener('beforeunload', () => {
        if (vitalListener) {
            rtdb.ref().off();
        }
    });
})();
