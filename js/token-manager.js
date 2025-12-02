// Token Management System
class TokenManager {
    constructor() {
        this.refreshTimer = null;
        this.isRefreshing = false;
    }

    // Check if token is expired or will expire soon
    isTokenExpiringSoon(token) {
        if (!token) return true;
        
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const now = Date.now() / 1000;
            const timeUntilExpiry = payload.exp - now;
            
            // Refresh if token expires in next 5 minutes
            return timeUntilExpiry < 300;
        } catch (error) {
            console.error('Token parsing error:', error);
            return true;
        }
    }

    // Refresh token automatically
    async refreshToken() {
        if (this.isRefreshing) return null;
        
        this.isRefreshing = true;
        const currentToken = localStorage.getItem('authToken');
        
        if (!currentToken) {
            this.isRefreshing = false;
            return null;
        }

        try {
            const response = await fetch('/api/refresh-token', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${currentToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                localStorage.setItem('authToken', data.token);
                console.log('✅ Token refreshed successfully');
                this.isRefreshing = false;
                return data.token;
            } else {
                console.error('Token refresh failed:', response.status);
                this.handleTokenExpiry();
                return null;
            }
        } catch (error) {
            console.error('Token refresh error:', error);
            this.handleTokenExpiry();
            return null;
        } finally {
            this.isRefreshing = false;
        }
    }

    // Handle token expiry
    handleTokenExpiry() {
        localStorage.removeItem('authToken');
        localStorage.removeItem('userType');
        
        // Show user-friendly message
        if (typeof showNotification === 'function') {
            showNotification('Session expired. Please login again.', 'warning');
        } else {
            alert('Session expired. Please login again.');
        }
        
        // Redirect to login after short delay
        setTimeout(() => {
            window.location.href = '/login.html';
        }, 2000);
    }

    // Start automatic token refresh
    startAutoRefresh() {
        // Check every 2 minutes
        this.refreshTimer = setInterval(async () => {
            const token = localStorage.getItem('authToken');
            
            if (this.isTokenExpiringSoon(token)) {
                console.log('🔄 Token expiring soon, refreshing...');
                await this.refreshToken();
            }
        }, 120000); // 2 minutes
    }

    // Stop automatic refresh
    stopAutoRefresh() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    // Enhanced fetch with automatic token refresh
    async fetchWithAuth(url, options = {}) {
        let token = localStorage.getItem('authToken');
        
        // Check if token needs refresh
        if (this.isTokenExpiringSoon(token)) {
            console.log('🔄 Refreshing token before request...');
            token = await this.refreshToken();
            
            if (!token) {
                throw new Error('Authentication failed');
            }
        }

        // Add auth header
        const authOptions = {
            ...options,
            headers: {
                ...options.headers,
                'Authorization': `Bearer ${token}`
            }
        };

        try {
            const response = await fetch(url, authOptions);
            
            // If 401/403, try to refresh token once
            if ((response.status === 401 || response.status === 403) && !this.isRefreshing) {
                console.log('🔄 Got 401/403, attempting token refresh...');
                const newToken = await this.refreshToken();
                
                if (newToken) {
                    // Retry with new token
                    authOptions.headers['Authorization'] = `Bearer ${newToken}`;
                    return await fetch(url, authOptions);
                }
            }
            
            return response;
        } catch (error) {
            console.error('Fetch with auth error:', error);
            throw error;
        }
    }
}

// Global token manager instance
window.tokenManager = new TokenManager();

// Auto-start token refresh when page loads
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('authToken');
    if (token) {
        window.tokenManager.startAutoRefresh();
        console.log('🔄 Auto token refresh started');
    }
});

// Stop refresh when page unloads
window.addEventListener('beforeunload', () => {
    if (window.tokenManager) {
        window.tokenManager.stopAutoRefresh();
    }
});