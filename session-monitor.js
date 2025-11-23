// Session Monitor - Checks for token expiration during check-in process
class SessionMonitor {
    constructor() {
        this.checkInterval = null;
        this.isChecking = false;
    }

    // Validate session before critical operations
    async validateSession() {
        const token = localStorage.getItem('authToken');
        const userData = localStorage.getItem('userData');
        const userType = localStorage.getItem('userType');

        if (!token || !userData || userType !== 'student') {
            this.handleSessionExpired('Session data missing');
            return false;
        }

        // Verify token with server
        try {
            const response = await fetch(window.API_BASE_URL + '/api/verify-token', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                this.handleSessionExpired('Token validation failed');
                return false;
            }

            const data = await response.json();
            if (!data.valid) {
                this.handleSessionExpired('Token expired');
                return false;
            }

            return true;
        } catch (error) {
            console.error('Session validation error:', error);
            return false;
        }
    }

    // Handle session expiration
    handleSessionExpired(reason) {
        console.warn('Session expired:', reason);
        
        // Stop any ongoing processes
        if (window.stopFaceVerification) {
            window.stopFaceVerification();
        }
        
        // Show expiration message
        if (window.showStatus) {
            window.showStatus('error', 
                '⏰ Session expired. Please login again. ' +
                '<button onclick="window.location.href=\'login.html\'" ' +
                'style="margin-left:10px;padding:5px 10px;background:#3b82f6;color:white;border:none;border-radius:4px;cursor:pointer;">' +
                'Login Now</button>'
            );
        }
        
        // Clear session data
        localStorage.removeItem('authToken');
        
        // Redirect after delay
        setTimeout(() => {
            sessionStorage.setItem('redirectAfterLogin', window.location.href);
            window.location.href = 'login.html';
        }, 3000);
    }

    // Start monitoring session during check-in
    startMonitoring() {
        if (this.isChecking) return;
        
        this.isChecking = true;
        console.log('🔍 Session monitoring started');
        
        // Check every 30 seconds during check-in process
        this.checkInterval = setInterval(async () => {
            const isValid = await this.validateSession();
            if (!isValid) {
                this.stopMonitoring();
            }
        }, 30000);
    }

    // Stop monitoring
    stopMonitoring() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        this.isChecking = false;
        console.log('🛑 Session monitoring stopped');
    }
}

// Export for use in checkin.html
window.SessionMonitor = SessionMonitor;
