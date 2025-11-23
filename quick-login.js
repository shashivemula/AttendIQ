// Quick re-login without leaving page
window.quickLogin = async function() {
    const userData = localStorage.getItem('userData');
    if (!userData) {
        window.location.href = 'login.html';
        return;
    }
    
    const user = JSON.parse(userData);
    const password = prompt(`Quick login for ${user.name}:\nEnter your password:`);
    
    if (!password) return;
    
    try {
        const response = await fetch(window.API_BASE_URL + '/api/student/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: user.email,
                password: password
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('userData', JSON.stringify(data.student));
            localStorage.setItem('userType', 'student');
            
            // Show success and continue
            if (typeof showStatus === 'function') {
                showStatus('success', 'Logged in! Continuing...');
            }
            
            // Continue with attendance if function exists
            if (typeof performCheckin === 'function') {
                setTimeout(() => performCheckin(), 1000);
            }
            
            return true;
        } else {
            alert('Login failed: ' + (data.error || 'Invalid password'));
            return false;
        }
    } catch (error) {
        alert('Login error: ' + error.message);
        return false;
    }
};

// Auto-extend session every 10 minutes
setInterval(async () => {
    const token = localStorage.getItem('authToken');
    if (token && window.API_BASE_URL) {
        try {
            await fetch(window.API_BASE_URL + '/api/student/profile', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            console.log('Session extended automatically');
        } catch (e) {
            console.log('Session extension failed:', e);
        }
    }
}, 10 * 60 * 1000); // 10 minutes