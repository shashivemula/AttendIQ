// ========================================
// 🚀 PORTABLE CONFIG - Works Everywhere!
// ========================================
// Automatically detects Replit vs Local environment
// No hardcoded URLs - works in VS Code, Replit, anywhere!

// Define API_BASE_URL and SOCKET_URL in global scope for backward compatibility
window.API_BASE_URL = '';
window.SOCKET_URL = '';

window.AttendIQConfig = {
    // Smart environment detection
    getEnvironment() {
        const hostname = window.location.hostname;
        const port = window.location.port;
        const isReplit = hostname.includes('replit.dev') || hostname.includes('replit.com');
        // Consider common private network ranges as local for LAN testing
        const isLanIp = /^192\.168\./.test(hostname) || /^10\./.test(hostname) || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);
        const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || isLanIp;
        
        // Set API base URL based on environment
        if (port === '5500') {
            // Served from Live Server (frontend) on 5500; backend is on 5000 using same host (works for LAN IP and localhost)
            window.API_BASE_URL = `http://${hostname}:5000`;
            window.SOCKET_URL = `http://${hostname}:5000`;
        } else if (isLocal) {
            // Non-5500 local serve (rare), try same host+port
            window.API_BASE_URL = `http://${hostname}:${port || '5000'}`;
            window.SOCKET_URL = `http://${hostname}:5000`;
        } else if (isReplit) {
            window.API_BASE_URL = `https://${hostname}`;
            // For Replit, use the same host for WebSocket
            window.SOCKET_URL = `wss://${hostname}`;
        } else {
            window.API_BASE_URL = window.location.protocol + '//' + window.location.host;
        }
        
        return {
            isReplit,
            isLocal,
            isDevelopment: isLocal,
            isProduction: isReplit,
            name: isReplit ? 'Replit Cloud ☁️' : isLocal ? 'Local Development 💻' : 'Custom Environment',
            apiBaseUrl: window.API_BASE_URL
        };
    },

    // Smart API base URL detection
    getApiBaseUrl() {
        const env = this.getEnvironment();
        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const port = window.location.port;
        
        if (env.isReplit) {
            // Replit environment - use current domain
            return `${protocol}//${hostname}`;
        } else if (port === '5500' || env.isLocal) {
            // Local development or LAN IP via Live Server - backend on port 5000
            return `${protocol}//${hostname}:5000`;
        } else {
            // Custom environment - assume same domain
            return `${protocol}//${hostname}`;
        }
    },

    // Smart Socket.io URL
    getSocketUrl() {
        return this.getApiBaseUrl();
    },

    // Camera scanner configuration
    getCameraConfig() {
        const env = this.getEnvironment();
        return {
            // Camera works on localhost (HTTP) and HTTPS environments
            allowHttp: env.isLocal,
            requireHttps: env.isReplit,
            facingMode: 'environment', // Back camera for QR scanning
            width: { ideal: 1280 },
            height: { ideal: 720 }
        };
    },

    // Debug info for troubleshooting
    getDebugInfo() {
        const env = this.getEnvironment();
        return {
            environment: env.name,
            hostname: window.location.hostname,
            protocol: window.location.protocol,
            port: window.location.port,
            apiUrl: this.getApiBaseUrl(),
            socketUrl: this.getSocketUrl(),
            userAgent: navigator.userAgent.substring(0, 50) + '...'
        };
    },

    // Initialize and log environment info
    init() {
        const debug = this.getDebugInfo();
        console.log('🔧 AttendIQ Environment Detection:', debug);
        
        // Store for easy access
        window.ATTENDIQ_API_URL = this.getApiBaseUrl();
        window.ATTENDIQ_SOCKET_URL = this.getSocketUrl();
        window.ATTENDIQ_ENV = this.getEnvironment();
        
        return this;
    }
};

// Auto-initialize when script loads
window.AttendIQConfig.init();

// Export for easy access
window.API_BASE_URL = window.ATTENDIQ_API_URL;
window.SOCKET_URL = window.ATTENDIQ_SOCKET_URL;

console.log('✅ Portable AttendIQ Config loaded successfully!');
console.log('📍 Current Environment:', window.ATTENDIQ_ENV.name);
console.log('🔗 API URL:', window.API_BASE_URL);