// FANG-LEVEL BULLETPROOF QR GENERATION SYSTEM
// This completely replaces the buggy QR system

window.BulletproofQR = {
    currentModal: null,
    currentSession: null,
    
    async generateBulletproofQR() {
        try {
            console.log('🚀 Starting FANG-level QR generation...');
            
            // Get subject and room
            const subject = prompt('Enter subject name for attendance:');
            if (!subject) return;
            
            const room = prompt('Enter room/location:') || 'Classroom';
            
            // Ask for geolocation settings
            const geoRequired = confirm('Do you want to enable location-based attendance validation?');
            let latitude = null, longitude = null, radius = 100;
            
            if (geoRequired) {
                // Try to get current location
                if (navigator.geolocation) {
                    try {
                        const position = await new Promise((resolve, reject) => {
                            navigator.geolocation.getCurrentPosition(resolve, reject, {
                                enableHighAccuracy: true,
                                timeout: 10000,
                                maximumAge: 60000
                            });
                        });
                        latitude = position.coords.latitude;
                        longitude = position.coords.longitude;
                        this.showNotification('📍 Location captured automatically', 'success');
                    } catch (error) {
                        console.log('Auto-location failed, asking for manual input');
                        latitude = parseFloat(prompt('Enter latitude (decimal degrees):'));
                        longitude = parseFloat(prompt('Enter longitude (decimal degrees):'));
                    }
                } else {
                    latitude = parseFloat(prompt('Enter latitude (decimal degrees):'));
                    longitude = parseFloat(prompt('Enter longitude (decimal degrees):'));
                }
                
                radius = parseInt(prompt('Enter attendance radius in meters (default: 100):') || '100');
                
                if (!latitude || !longitude || isNaN(latitude) || isNaN(longitude)) {
                    this.showNotification('❌ Invalid coordinates provided', 'error');
                    return;
                }
                
                if (radius < 10 || radius > 1000) {
                    this.showNotification('❌ Radius must be between 10-1000 meters', 'error');
                    return;
                }
            }
            
            // Show loading notification
            this.showNotification('🔄 Generating bulletproof QR code...', 'info');
            
            // Get current user
            const userData = localStorage.getItem('userData');
            if (!userData) {
                this.showNotification('❌ Please login first', 'error');
                return;
            }
            
            const currentUser = JSON.parse(userData);
            
            // Make API call
            const response = await fetch(window.API_BASE_URL + '/api/faculty/generate-qr', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                },
                body: JSON.stringify({
                    facultyId: currentUser.id,
                    subject: subject,
                    room: room,
                    latitude: latitude,
                    longitude: longitude,
                    radius: radius,
                    geoRequired: geoRequired
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.currentSession = data.sessionId;
                this.displayBulletproofQR(data);
                this.showNotification('✅ QR Code generated successfully!', 'success');
                console.log('✅ QR generated:', data.sessionId);
            } else {
                this.showNotification('❌ Error: ' + data.error, 'error');
            }
            
        } catch (error) {
            console.error('QR Generation Error:', error);
            this.showNotification('❌ Connection error. Check console.', 'error');
        }
    },
    
    displayBulletproofQR(data) {
        // Remove any existing modal
        if (this.currentModal) {
            this.currentModal.remove();
        }
        
        // Store session data for regeneration
        this.currentSessionData = {
            sessionId: data.sessionId,
            subject: data.subject,
            room: data.room,
            hasGeoFencing: data.latitude && data.longitude
        };
        
        // Create bulletproof modal
        const modal = document.createElement('div');
        modal.id = 'bulletproof-qr-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            backdrop-filter: blur(10px);
            overflow-y: auto;
        `;
        
        const geoInfo = data.latitude && data.longitude ? 
            `<p style="color: #10b981; margin: 5px 0; font-size: 0.8rem;">📍 Geo-fenced (${data.radius || 100}m radius)</p>` : 
            `<p style="color: #fbbf24; margin: 5px 0; font-size: 0.8rem;">🌐 Location validation disabled</p>`;
        
        modal.innerHTML = `
            <div style="
                background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
                border-radius: 20px;
                padding: 30px;
                max-width: 500px;
                width: 90%;
                max-height: 90vh;
                overflow-y: auto;
                text-align: center;
                border: 2px solid #10b981;
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
            ">
                <div style="margin-bottom: 20px;">
                    <h2 style="color: #10b981; margin: 0; font-size: 1.5rem;">
                        🎯 FANG-Level QR Code
                    </h2>
                    <p style="color: #64748b; margin: 10px 0 0 0;">Enterprise-Grade Security</p>
                </div>
                
                <div style="background: rgba(0, 0, 0, 0.3); border-radius: 15px; padding: 20px; margin: 20px 0;">
                    <h3 style="color: #fff; margin: 0 0 10px 0;">📚 ${data.subject}</h3>
                    <p style="color: #94a3b8; margin: 0;">📍 ${data.room}</p>
                    ${geoInfo}
                    <p style="color: #fbbf24; margin: 10px 0 0 0; font-size: 0.9rem;">
                        ⏰ Expires: ${new Date(data.expiresAt).toLocaleTimeString()}
                    </p>
                </div>
                
                <div style="background: white; border-radius: 15px; padding: 20px; margin: 20px 0;">
                    <img id="qr-code-image" src="${data.qrCode}" alt="QR Code" style="
                        width: 200px;
                        height: 200px;
                        display: block;
                        margin: 0 auto;
                        border-radius: 10px;
                    ">
                </div>
                
                <div style="display: flex; gap: 10px; justify-content: center; margin-top: 20px; flex-wrap: wrap;">
                    <button onclick="window.BulletproofQR.regenerateQR()" style="
                        background: linear-gradient(135deg, #3b82f6, #2563eb);
                        color: white;
                        border: none;
                        padding: 12px 20px;
                        border-radius: 10px;
                        cursor: pointer;
                        font-weight: 600;
                    ">🔄 Regenerate</button>
                    
                    <button onclick="window.BulletproofQR.generateBulletproofQR()" style="
                        background: linear-gradient(135deg, #10b981, #059669);
                        color: white;
                        border: none;
                        padding: 12px 20px;
                        border-radius: 10px;
                        cursor: pointer;
                        font-weight: 600;
                    ">➕ New QR</button>
                    
                    <button onclick="window.BulletproofQR.closeQR()" style="
                        background: linear-gradient(135deg, #ef4444, #dc2626);
                        color: white;
                        border: none;
                        padding: 12px 20px;
                        border-radius: 10px;
                        cursor: pointer;
                        font-weight: 600;
                    ">❌ Close</button>
                </div>
                
                <div style="margin-top: 20px; padding: 15px; background: rgba(16, 185, 129, 0.1); border-radius: 10px;">
                    <p style="color: #10b981; margin: 0; font-size: 0.9rem;">
                        📱 Students scan this QR code to mark attendance
                    </p>
                    ${data.latitude && data.longitude ? 
                        `<p style="color: #fbbf24; margin: 5px 0 0 0; font-size: 0.8rem;">🛡️ Location verification enabled</p>` : 
                        `<p style="color: #94a3b8; margin: 5px 0 0 0; font-size: 0.8rem;">⚡ Quick scan mode (no location check)</p>`
                    }
                </div>
            </div>
        `;
        
        // Add to body
        document.body.appendChild(modal);
        this.currentModal = modal;
        
        // Prevent modal from closing accidentally
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                // Don't close on backdrop click
                e.preventDefault();
                e.stopPropagation();
            }
        });
        
        console.log('✅ Bulletproof QR modal created and displayed');
    },
    
    async regenerateQR() {
        if (!this.currentSessionData) {
            this.showNotification('❌ No active session to regenerate', 'error');
            return;
        }
        
        try {
            this.showNotification('🔄 Regenerating QR code...', 'info');
            
            const response = await fetch(window.API_BASE_URL + `/api/faculty/regenerate-qr/${this.currentSessionData.sessionId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Update the QR code image in the current modal
                const qrImage = document.getElementById('qr-code-image');
                if (qrImage) {
                    qrImage.src = data.qrCode;
                }
                
                // Update expiry time display
                const expiryElements = document.querySelectorAll('#bulletproof-qr-modal p');
                expiryElements.forEach(p => {
                    if (p.textContent.includes('Expires:')) {
                        p.innerHTML = `⏰ Expires: ${new Date(data.expiresAt).toLocaleTimeString()}`;
                    }
                });
                
                this.showNotification('✅ QR code regenerated successfully!', 'success');
                console.log('🔄 QR regenerated:', this.currentSessionData.sessionId);
            } else {
                this.showNotification('❌ Error: ' + data.error, 'error');
            }
        } catch (error) {
            console.error('Regenerate Error:', error);
            this.showNotification('❌ Failed to regenerate QR code', 'error');
        }
    },
    
    closeQR() {
        if (this.currentModal) {
            this.currentModal.remove();
            this.currentModal = null;
            console.log('✅ QR modal closed');
        }
    },
    
    showNotification(message, type) {
        // Remove existing notifications
        const existing = document.querySelectorAll('.bulletproof-notification');
        existing.forEach(n => n.remove());
        
        const notification = document.createElement('div');
        notification.className = 'bulletproof-notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
            color: white;
            padding: 15px 20px;
            border-radius: 10px;
            z-index: 10001;
            font-weight: 600;
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
            animation: slideIn 0.3s ease;
        `;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 4000);
    }
};

// Add CSS animation
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
`;
document.head.appendChild(style);

console.log('🚀 Bulletproof QR system loaded and ready!');
console.log("DEBUG: Testing if BulletproofQR exists:", typeof window.BulletproofQR);
