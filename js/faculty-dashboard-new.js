class FacultyDashboard {
    constructor() {
        this.socket = null;
        this.currentSessionId = null;
        this.qrTimer = null;
        this.attendanceData = [];
        this.initialize();
    }

    async initialize() {
        this.initializeUI();
        this.initializeSocket();
        this.attachEventListeners();
        this.loadInitialData();
    }

    initializeUI() {
        // Initialize any UI components here
        console.log('Initializing Faculty Dashboard UI');
    }

    initializeSocket() {
        if (typeof io !== 'undefined') {
            this.socket = io(window.SOCKET_URL || '/');
            
            this.socket.on('connect', () => {
                console.log('Connected to WebSocket server');
                this.showNotification('Connected to server', 'success');
                this.authenticateSocket();
            });

            this.socket.on('disconnect', () => {
                console.log('Disconnected from WebSocket server');
                this.showNotification('Disconnected from server', 'warning');
            });

            // Add other socket event listeners
            this.socket.on('attendance_update', this.handleAttendanceUpdate.bind(this));
            this.socket.on('session_ended', this.handleSessionEnded.bind(this));
        } else {
            console.error('Socket.IO not loaded');
        }
    }

    authenticateSocket() {
        const token = localStorage.getItem('authToken');
        if (token && this.socket) {
            this.socket.emit('authenticate', { token });
        }
    }

    attachEventListeners() {
        // QR Generation
        const qrBtn = document.getElementById('generateQR');
        if (qrBtn) {
            qrBtn.addEventListener('click', () => this.startNewSession());
        }

        // Logout
        const logoutBtn = document.querySelector('.btn-logout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', this.logout.bind(this));
        }

        // Add other event listeners as needed
    }

    async loadInitialData() {
        try {
            // Load any initial data needed for the dashboard
            console.log('Loading initial data...');
        } catch (error) {
            console.error('Error loading initial data:', error);
            this.showNotification('Failed to load initial data', 'error');
        }
    }

    async startNewSession() {
        try {
            const subject = document.getElementById('subjectSelect')?.value || 'Default Subject';
            const room = document.getElementById('roomInput')?.value || 'Default Room';
            
            // Show loading state
            const qrBtn = document.getElementById('generateQR');
            const originalText = qrBtn.innerHTML;
            qrBtn.disabled = true;
            qrBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting...';

            // Call your API to start a new session
            const response = await fetch('/api/sessions/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                },
                body: JSON.stringify({ subject, room })
            });

            if (!response.ok) throw new Error('Failed to start session');
            
            const data = await response.json();
            this.currentSessionId = data.sessionId;
            
            // Update UI with new QR code
            this.displayQRCode(data.qrCodeUrl, subject, room, data.expiresAt);
            this.showNotification('Session started successfully', 'success');
            
        } catch (error) {
            console.error('Error starting session:', error);
            this.showNotification(error.message || 'Failed to start session', 'error');
        } finally {
            // Reset button state
            const qrBtn = document.getElementById('generateQR');
            if (qrBtn) {
                qrBtn.disabled = false;
                qrBtn.innerHTML = 'Generate QR Code';
            }
        }
    }

    displayQRCode(qrCodeUrl, subject, room, expiresAt) {
        const qrDisplay = document.getElementById('qrDisplay');
        if (!qrDisplay) return;

        qrDisplay.innerHTML = `
            <img src="${qrCodeUrl}" alt="QR Code for ${subject}" class="qr-code">
            <div class="qr-info">
                <h3>${subject}</h3>
                <p>Room: ${room}</p>
                <p class="expiry">Expires in: <span id="qrTimer">05:00</span></p>
            </div>
        `;

        // Start countdown timer
        this.startQRCountdown(expiresAt);
    }

    startQRCountdown(expiresAt) {
        if (this.qrTimer) clearInterval(this.qrTimer);
        
        const updateTimer = () => {
            const now = new Date();
            const end = new Date(expiresAt);
            const diff = Math.max(0, end - now);
            
            if (diff <= 0) {
                clearInterval(this.qrTimer);
                document.getElementById('qrTimer').textContent = 'Expired';
                return;
            }
            
            const minutes = Math.floor(diff / 60000);
            const seconds = Math.floor((diff % 60000) / 1000);
            document.getElementById('qrTimer').textContent = 
                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        };
        
        updateTimer();
        this.qrTimer = setInterval(updateTimer, 1000);
    }

    handleAttendanceUpdate(data) {
        // Update UI with new attendance data
        console.log('Attendance update:', data);
        // Add your attendance update logic here
    }

    handleSessionEnded(data) {
        console.log('Session ended:', data);
        this.showNotification('Session has ended', 'info');
        this.currentSessionId = null;
        
        // Clear QR code display
        const qrDisplay = document.getElementById('qrDisplay');
        if (qrDisplay) {
            qrDisplay.innerHTML = '<p>No active session. Generate a QR code to start.</p>';
        }
        
        if (this.qrTimer) {
            clearInterval(this.qrTimer);
            this.qrTimer = null;
        }
    }

    showNotification(message, type = 'info') {
        // Implement your notification system here
        console.log(`[${type.toUpperCase()}] ${message}`);
        // Example: show a toast notification
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }

    logout() {
        localStorage.removeItem('authToken');
        localStorage.removeItem('userData');
        window.location.href = 'login.html';
    }
}

// Initialize the dashboard when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // Check if user is authenticated
    const token = localStorage.getItem('authToken');
    const userData = localStorage.getItem('userData');
    
    if (!token || !userData) {
        window.location.href = 'login.html';
        return;
    }
    
    // Initialize the dashboard
    window.facultyDashboard = new FacultyDashboard();
});
