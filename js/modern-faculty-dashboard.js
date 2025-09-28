/**
 * Modern Faculty Dashboard JavaScript
 * Comprehensive attendance management with real-time features
 */

class ModernFacultyDashboard {
    constructor() {
        this.sessionActive = false;
        this.currentSessionId = null;
        this.timerInterval = null;
        this.autoRefreshInterval = null;
        this.qrExpiryTime = null;
        this.currentLocation = null;
        this.students = [];
        this.attendanceData = [];
        this.socket = null;
        this.qrColorIndex = 0;
        this.qrColors = [
            'linear-gradient(135deg, rgba(59,130,246,0.25), rgba(139,92,246,0.25))',
            'linear-gradient(135deg, rgba(16,185,129,0.25), rgba(59,130,246,0.25))',
            'linear-gradient(135deg, rgba(236,72,153,0.25), rgba(249,115,22,0.25))'
        ];
        
        this.init();
    }

    /**
     * Initialize the dashboard
     */
    init() {
        this.setupEventListeners();
        this.loadStudentRoster();
        this.setupWebSocket();
        this.updateUI();
        this.loadConfig();
    }

    /**
     * Load configuration and environment detection
     */
    loadConfig() {
        // Environment detection for API URLs
        const hostname = window.location.hostname;
        const port = window.location.port;
        
        if (hostname.includes('replit.dev')) {
            this.apiBaseUrl = `https://${hostname}`;
        } else {
            this.apiBaseUrl = `http://${hostname}:5000`;
        }
        
        console.log('🔧 Faculty Dashboard initialized with API:', this.apiBaseUrl);
    }

    /**
     * Setup all event listeners
     */
    setupEventListeners() {
        // QR Code Generation
        document.getElementById('generateQRBtn')?.addEventListener('click', () => this.generateQRCode());
        document.getElementById('regenerateQRBtn')?.addEventListener('click', () => this.regenerateQR());
        document.getElementById('endSessionBtn')?.addEventListener('click', () => this.endSession());

        // Geolocation
        document.getElementById('enableGeolocation')?.addEventListener('change', (e) => this.toggleGeolocation(e.target.checked));
        document.getElementById('setLocationBtn')?.addEventListener('click', () => this.setCurrentLocation());

        // Student Management
        document.getElementById('addStudentBtn')?.addEventListener('click', () => this.addStudent());
        document.getElementById('importExcelBtn')?.addEventListener('click', () => this.importExcel());
        document.getElementById('downloadTemplateBtn')?.addEventListener('click', () => this.downloadTemplate());
        document.getElementById('excelFileInput')?.addEventListener('change', (e) => this.handleFileImport(e));

        // Feed Controls
        document.getElementById('downloadReportBtn')?.addEventListener('click', () => this.downloadReport());
        document.getElementById('exportExcelBtn')?.addEventListener('click', () => this.exportExcel());
        document.getElementById('refreshFeedBtn')?.addEventListener('click', () => this.refreshFeed());
        document.getElementById('autoRefreshInterval')?.addEventListener('change', (e) => this.setAutoRefresh(e.target.value));

        // Search and Filter
        document.getElementById('studentSearchInput')?.addEventListener('input', (e) => this.filterStudents(e.target.value));
        document.getElementById('statusFilterSelect')?.addEventListener('change', (e) => this.filterByStatus(e.target.value));

        // Modal Controls
        document.getElementById('closeSummaryModal')?.addEventListener('click', () => this.closeSummaryModal());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));
    }

    /**
     * Generate QR Code for attendance session
     */
    async generateQRCode() {
        const subject = document.getElementById('subjectSelect')?.value;
        const room = document.getElementById('roomInput')?.value;
        const enableGeo = document.getElementById('enableGeolocation')?.checked;

        if (!subject) {
            this.showNotification('Please select a subject', 'warning');
            return;
        }

        try {
            this.setUILoading(true);

            const maxDistance = document.getElementById('maxDistance')?.value || 50;
            const requestData = {
                facultyId: this.getCurrentFacultyId(),
                subject: subject,
                room: room || 'Classroom',
                geoRequired: enableGeo,
                location: enableGeo ? {
                    ...this.currentLocation,
                    maxDistance: parseInt(maxDistance)
                } : null
            };

            const response = await fetch(`${this.apiBaseUrl}/api/faculty/generate-qr`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify(requestData)
            });

            const data = await response.json();

            if (data.success) {
                this.currentSessionId = data.sessionId;
                this.qrExpiryTime = new Date(data.expiresAt);
                
                await this.displayQRCode(data.qrCodeData || data.qrCode);
                this.startSession();
                this.startTimer();
                
                this.showNotification('QR Code generated successfully!', 'success');
                console.log('📱 QR Code session started:', this.currentSessionId);
            } else {
                throw new Error(data.error || 'Failed to generate QR code');
            }
        } catch (error) {
            console.error('Error generating QR code:', error);
            this.showNotification('Failed to generate QR code: ' + error.message, 'error');
        } finally {
            this.setUILoading(false);
        }
    }

    /**
     * Display QR code on canvas
     */
    async displayQRCode(qrData) {
        const canvas = document.getElementById('qrCanvas');
        const placeholder = document.getElementById('qrPlaceholder');
        const container = document.getElementById('qrCodeContainer');

        if (!canvas) return;

        try {
            // Generate QR code URL for scanning
            const scanUrl = `${this.apiBaseUrl}/checkin.html?session=${this.currentSessionId}`;
            
            // Use QRCode library to generate QR code
            await QRCode.toCanvas(canvas, scanUrl, {
                width: 250,
                margin: 2,
                color: {
                    dark: '#1e293b',
                    light: '#ffffff'
                },
                errorCorrectionLevel: 'M'
            });

            // Update UI
            placeholder?.classList.add('hidden');
            container?.classList.remove('hidden');

            // Update session info
            document.getElementById('sessionIdDisplay').textContent = this.currentSessionId;
            document.getElementById('expiresAtDisplay').textContent = this.qrExpiryTime.toLocaleTimeString();

        } catch (error) {
            console.error('Error displaying QR code:', error);
            this.showNotification('Error displaying QR code', 'error');
        }
    }

    /**
     * Start attendance session
     */
    startSession() {
        this.sessionActive = true;
        
        // Update UI elements
        document.getElementById('generateQRBtn')?.classList.add('hidden');
        document.getElementById('regenerateQRBtn')?.classList.remove('hidden');
        document.getElementById('endSessionBtn')?.classList.remove('hidden');

        // Update status indicator
        this.updateStatusIndicator('active', 'QR Code Active');
        
        // Update feed description
        document.getElementById('feedDescription').textContent = 'Real-time student check-ins will appear below';

        // Reset attendance data
        this.attendanceData = [];
        this.updateAttendanceStats();

        // Start auto-refresh if enabled
        const interval = document.getElementById('autoRefreshInterval')?.value;
        if (interval && parseInt(interval) > 0) {
            this.setAutoRefresh(interval);
        }
    }

    /**
     * Regenerate QR code (refresh current session)
     */
    async regenerateQR() {
        if (!this.sessionActive) return;
        
        await this.generateQRCode();
        this.showNotification('QR Code regenerated', 'info');
    }

    /**
     * End current session
     */
    async endSession() {
        if (!this.sessionActive) return;

        const confirmEnd = confirm('Are you sure you want to end this attendance session? This will generate a summary report.');
        if (!confirmEnd) return;

        try {
            this.sessionActive = false;
            
            // Stop timer and auto-refresh
            clearInterval(this.timerInterval);
            clearInterval(this.autoRefreshInterval);

            // Update UI
            document.getElementById('generateQRBtn')?.classList.remove('hidden');
            document.getElementById('regenerateQRBtn')?.classList.add('hidden');
            document.getElementById('endSessionBtn')?.classList.add('hidden');

            // Hide QR code
            document.getElementById('qrPlaceholder')?.classList.remove('hidden');
            document.getElementById('qrCodeContainer')?.classList.add('hidden');

            // Update status
            this.updateStatusIndicator('inactive', 'Session Ended');
            this.updateTimerDisplay('--:--', 'inactive');

            // Generate session summary
            this.generateSessionSummary();

            this.showNotification('Session ended successfully', 'success');
            console.log('🛑 Session ended:', this.currentSessionId);

        } catch (error) {
            console.error('Error ending session:', error);
            this.showNotification('Error ending session', 'error');
        }
    }

    /**
     * Update status indicator
     */
    updateStatusIndicator(status, text) {
        const statusLight = document.getElementById('statusLight');
        const statusText = document.getElementById('statusText');

        if (statusLight && statusText) {
            statusLight.className = `status-light ${status}`;
            statusText.textContent = text;
        }
    }

    /**
     * Start countdown timer
     */
    startTimer() {
        clearInterval(this.timerInterval);
        
        this.timerInterval = setInterval(() => {
            const now = new Date();
            const timeLeft = this.qrExpiryTime - now;

            if (timeLeft <= 0) {
                this.updateTimerDisplay('00:00', 'expired');
                this.updateStatusIndicator('expired', 'QR Code Expired');
                clearInterval(this.timerInterval);
                return;
            }

            const minutes = Math.floor(timeLeft / 60000);
            const seconds = Math.floor((timeLeft % 60000) / 1000);
            const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

            let timerClass = 'active';
            if (timeLeft < 30000) { // Less than 30 seconds
                timerClass = 'warning';
                this.updateStatusIndicator('expiring', 'QR Code Expiring Soon');
            }

            this.updateTimerDisplay(timeString, timerClass);
        }, 1000);
    }

    /**
     * Update timer display
     */
    updateTimerDisplay(timeString, className) {
        const timerDisplay = document.getElementById('qrTimerDisplay');
        const timerValue = document.getElementById('timerValue');

        if (timerDisplay && timerValue) {
            timerValue.textContent = timeString;
            timerDisplay.className = `qr-timer-display ${className}`;
        }
    }

    /**
     * Setup WebSocket connection for real-time updates
     */
    setupWebSocket() {
        try {
            // Try Socket.IO connection
            if (typeof io !== 'undefined') {
                this.socket = io(this.apiBaseUrl);
                
                this.socket.on('connect', () => {
                    console.log('✅ Connected to real-time server');
                    this.wsConnected = true;
                });

                this.socket.on('attendance_update', (data) => {
                    this.handleAttendanceUpdate(data);
                });

                this.socket.on('disconnect', () => {
                    console.log('❌ Disconnected from real-time server');
                    this.wsConnected = false;
                    // Fall back to polling if WebSocket disconnects
                    this.startPollingFallback();
                });

                this.socket.on('connect_error', () => {
                    console.warn('⚠️ WebSocket connection failed, using polling fallback');
                    this.wsConnected = false;
                    this.startPollingFallback();
                });
            } else {
                console.warn('⚠️ Socket.IO not available, using polling fallback');
                this.startPollingFallback();
            }
        } catch (error) {
            console.error('WebSocket setup error:', error);
            this.startPollingFallback();
        }
    }

    /**
     * Start polling fallback for real-time updates
     */
    startPollingFallback() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }
        
        // Poll every 3 seconds when session is active
        this.pollingInterval = setInterval(() => {
            if (this.sessionActive && !this.wsConnected) {
                this.pollAttendanceUpdates();
            }
        }, 3000);
    }

    /**
     * Poll for attendance updates
     */
    async pollAttendanceUpdates() {
        if (!this.currentSessionId) return;
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/faculty/session/${this.currentSessionId}/attendance`, {
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.attendance) {
                    // Check for new attendance records
                    data.attendance.forEach(record => {
                        const exists = this.attendanceData.find(a => 
                            a.studentId === record.studentId && 
                            a.timestamp === record.timestamp
                        );
                        if (!exists) {
                            this.handleAttendanceUpdate(record);
                        }
                    });
                }
            }
        } catch (error) {
            console.error('Polling error:', error);
        }
    }

    /**
     * Handle real-time attendance updates
     */
    handleAttendanceUpdate(data) {
        if (data.sessionId !== this.currentSessionId) return;

        // Add to attendance data
        this.attendanceData.push(data);

        // Update live feed
        this.addToLiveFeed(data);
        
        // Update statistics
        this.updateAttendanceStats();

        // Show notification
        this.showNotification(`${data.studentName} marked ${data.status}`, 'info');
    }

    /**
     * Add entry to live attendance feed
     */
    addToLiveFeed(data) {
        const tableBody = document.getElementById('attendanceTableBody');
        if (!tableBody) return;

        // Remove "no data" row if it exists
        const noDataRow = tableBody.querySelector('.no-data-row');
        if (noDataRow) {
            noDataRow.remove();
        }

        // Create new row
        const row = document.createElement('tr');
        row.className = 'attendance-row slide-in';
        
        const checkInTime = new Date(data.timestamp).toLocaleTimeString();
        const locationVerified = data.locationVerified ? '✅ Verified' : '❌ Not Required';
        
        row.innerHTML = `
            <td>${checkInTime}</td>
            <td>${data.studentId || data.rollNumber}</td>
            <td>${data.studentName}</td>
            <td><span class="status-badge status-${data.status}">${data.status}</span></td>
            <td>${locationVerified}</td>
            <td>
                <button class="btn btn-outline btn-sm" onclick="dashboard.viewStudentDetails('${data.studentId}')">
                    <i class="fas fa-eye"></i>
                </button>
            </td>
        `;

        // Insert at the top of the table
        tableBody.insertBefore(row, tableBody.firstChild);

        // Limit to 50 rows for performance
        while (tableBody.children.length > 50) {
            tableBody.removeChild(tableBody.lastChild);
        }
    }

    /**
     * Update attendance statistics
     */
    updateAttendanceStats() {
        const presentCount = this.attendanceData.filter(a => a.status === 'present').length;
        const lateCount = this.attendanceData.filter(a => a.status === 'late').length;
        const absentCount = this.students.length - presentCount - lateCount;

        document.getElementById('livePresentCount').textContent = presentCount;
        document.getElementById('liveLateCount').textContent = lateCount;
        document.getElementById('liveAbsentCount').textContent = absentCount;
    }

    /**
     * Toggle geolocation functionality
     */
    toggleGeolocation(enabled) {
        const geoControls = document.getElementById('geoControls');
        
        if (enabled) {
            geoControls?.classList.remove('hidden');
            if (!this.currentLocation) {
                this.showNotification('Please set your location for geofencing', 'info');
            }
        } else {
            geoControls?.classList.add('hidden');
        }
    }

    /**
     * Set current location for geofencing
     */
    setCurrentLocation() {
        if (!navigator.geolocation) {
            this.showNotification('Geolocation is not supported by this browser', 'error');
            return;
        }

        const setLocationBtn = document.getElementById('setLocationBtn');
        const locationStatus = document.getElementById('locationStatus');
        const locationText = document.getElementById('locationText');

        setLocationBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Getting Location...';
        setLocationBtn.disabled = true;

        navigator.geolocation.getCurrentPosition(
            (position) => {
                this.currentLocation = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy
                };

                locationText.textContent = `Location set (±${Math.round(position.coords.accuracy)}m)`;
                locationStatus.style.color = '#10b981';

                setLocationBtn.innerHTML = '<i class="fas fa-check"></i> Location Set';
                setLocationBtn.disabled = false;

                this.showNotification('Location set successfully', 'success');
                console.log('📍 Location set:', this.currentLocation);
            },
            (error) => {
                console.error('Geolocation error:', error);
                locationText.textContent = 'Failed to get location';
                locationStatus.style.color = '#ef4444';

                setLocationBtn.innerHTML = '<i class="fas fa-crosshairs"></i> Retry Location';
                setLocationBtn.disabled = false;

                this.showNotification('Failed to get location: ' + error.message, 'error');
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 300000 // 5 minutes
            }
        );
    }

    /**
     * Add student to roster
     */
    addStudent() {
        const rollNumber = document.getElementById('newStudentRoll')?.value.trim();
        const name = document.getElementById('newStudentName')?.value.trim();
        const email = document.getElementById('newStudentEmail')?.value.trim();

        if (!rollNumber || !name) {
            this.showNotification('Roll number and name are required', 'warning');
            return;
        }

        // Check for duplicate roll number
        if (this.students.find(s => s.rollNumber === rollNumber)) {
            this.showNotification('Student with this roll number already exists', 'warning');
            return;
        }

        const student = {
            id: Date.now().toString(),
            rollNumber,
            name,
            email: email || '',
            status: 'absent',
            attendancePercentage: 0,
            lastCheckIn: null
        };

        this.students.push(student);
        this.renderStudentTable();
        this.updateStudentCount();

        // Clear form
        document.getElementById('newStudentRoll').value = '';
        document.getElementById('newStudentName').value = '';
        document.getElementById('newStudentEmail').value = '';

        this.showNotification('Student added successfully', 'success');
    }

    /**
     * Import Excel/CSV file
     */
    importExcel() {
        document.getElementById('excelFileInput')?.click();
    }

    /**
     * Handle file import
     */
    async handleFileImport(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            this.setUILoading(true);
            
            // Check file type
            const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
            const isCSV = file.name.endsWith('.csv');
            
            if (!isExcel && !isCSV) {
                throw new Error('Only Excel (.xlsx, .xls) and CSV files are supported');
            }

            let students = [];

            if (isCSV) {
                // Parse CSV
                const text = await file.text();
                students = this.parseCSV(text);
            } else {
                // Parse Excel using XLSX library
                if (typeof XLSX === 'undefined') {
                    throw new Error('Excel library not loaded. Please refresh the page.');
                }
                
                const data = await file.arrayBuffer();
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);
                
                students = this.processImportedData(jsonData);
            }

            if (students.length === 0) {
                throw new Error('No valid student data found in file');
            }

            // Add students to roster
            let addedCount = 0;
            students.forEach(student => {
                if (!this.students.find(s => s.rollNumber === student.rollNumber)) {
                    this.students.push({
                        id: Date.now().toString() + Math.random(),
                        ...student,
                        status: 'absent',
                        attendancePercentage: 0,
                        lastCheckIn: null
                    });
                    addedCount++;
                }
            });

            this.renderStudentTable();
            this.updateStudentCount();
            this.showNotification(`Successfully imported ${addedCount} students`, 'success');

        } catch (error) {
            console.error('Import error:', error);
            this.showNotification('Import failed: ' + error.message, 'error');
        } finally {
            this.setUILoading(false);
            event.target.value = '';
        }
    }

    /**
     * Parse CSV data
     */
    parseCSV(text) {
        const lines = text.split('\n').filter(line => line.trim());
        if (lines.length < 2) return [];
        
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const students = [];
        
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
            if (values.length >= 2) {
                const student = {
                    rollNumber: values[0] || `STU${Date.now()}`,
                    name: values[1] || 'Unknown',
                    email: values[2] || ''
                };
                students.push(student);
            }
        }
        
        return students;
    }

    /**
     * Process imported data
     */
    processImportedData(data) {
        return data.map(row => ({
            rollNumber: row.student_id || row.roll_number || row.rollNumber || `STU${Date.now()}`,
            name: row.name || row.student_name || 'Unknown',
            email: row.email || row.student_email || ''
        })).filter(student => student.name !== 'Unknown');
    }

    /**
     * Download Excel template
     */
    downloadTemplate() {
        const csvContent = "student_id,name,email,password\nCS001,John Doe,john@example.com,student123\nCS002,Jane Smith,jane@example.com,student123\n";
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'student-template.csv';
        a.click();
        
        window.URL.revokeObjectURL(url);
        this.showNotification('Template downloaded', 'success');
    }

    /**
     * Load student roster from server
     */
    async loadStudentRoster() {
        try {
            // For now, use sample data. In real implementation, fetch from server
            this.students = [
                { id: '1', rollNumber: 'CS001', name: 'Alice Johnson', email: 'alice@test.com', status: 'absent', attendancePercentage: 85, lastCheckIn: null },
                { id: '2', rollNumber: 'CS002', name: 'Bob Smith', email: 'bob@test.com', status: 'absent', attendancePercentage: 92, lastCheckIn: null },
                { id: '3', rollNumber: 'CS003', name: 'Carol Brown', email: 'carol@test.com', status: 'absent', attendancePercentage: 78, lastCheckIn: null },
                { id: '4', rollNumber: 'CS004', name: 'David Wilson', email: 'david@test.com', status: 'absent', attendancePercentage: 95, lastCheckIn: null },
                { id: '5', rollNumber: 'CS005', name: 'Eva Martinez', email: 'eva@test.com', status: 'absent', attendancePercentage: 88, lastCheckIn: null }
            ];

            this.renderStudentTable();
            this.updateStudentCount();
        } catch (error) {
            console.error('Error loading student roster:', error);
            this.showNotification('Failed to load student roster', 'error');
        }
    }

    /**
     * Render student table
     */
    renderStudentTable() {
        const tableBody = document.getElementById('studentTableBody');
        if (!tableBody) return;

        if (this.students.length === 0) {
            tableBody.innerHTML = `
                <tr class="no-data-row">
                    <td colspan="7">
                        <div class="no-data">
                            <i class="fas fa-users"></i>
                            <p>No students in roster. Add students manually or import from Excel/CSV.</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = this.students.map(student => `
            <tr>
                <td>
                    <label class="checkbox">
                        <input type="checkbox" value="${student.id}" class="student-checkbox">
                        <span class="checkmark"></span>
                    </label>
                </td>
                <td>${student.rollNumber}</td>
                <td>${student.name}</td>
                <td>${student.email}</td>
                <td><span class="status-badge status-${student.status}">${student.status}</span></td>
                <td>${student.attendancePercentage}%</td>
                <td>
                    <button class="btn btn-outline btn-sm" onclick="dashboard.editStudent('${student.id}')" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="dashboard.deleteStudent('${student.id}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');

        // Update bulk delete button visibility
        this.updateBulkDeleteVisibility();
    }

    /**
     * Update student count
     */
    updateStudentCount() {
        document.getElementById('totalStudentsCount').textContent = this.students.length;
    }

    /**
     * Filter students by search term
     */
    filterStudents(searchTerm) {
        const rows = document.querySelectorAll('#studentTableBody tr:not(.no-data-row)');
        
        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            const matches = text.includes(searchTerm.toLowerCase());
            row.style.display = matches ? '' : 'none';
        });
    }

    /**
     * Filter students by status
     */
    filterByStatus(status) {
        const rows = document.querySelectorAll('#studentTableBody tr:not(.no-data-row)');
        
        rows.forEach(row => {
            if (status === 'all') {
                row.style.display = '';
            } else {
                const statusBadge = row.querySelector('.status-badge');
                const studentStatus = statusBadge?.textContent.toLowerCase().trim();
                row.style.display = studentStatus === status ? '' : 'none';
            }
        });
    }

    /**
     * Set auto-refresh interval
     */
    setAutoRefresh(interval) {
        clearInterval(this.autoRefreshInterval);
        
        const milliseconds = parseInt(interval);
        if (milliseconds > 0) {
            this.autoRefreshInterval = setInterval(() => {
                this.refreshFeed();
            }, milliseconds);
        }
    }

    /**
     * Refresh attendance feed
     */
    async refreshFeed() {
        if (!this.sessionActive) return;

        try {
            // In real implementation, fetch latest attendance data from server
            console.log('🔄 Refreshing attendance feed...');
            
            // Simulate refresh animation
            const refreshBtn = document.getElementById('refreshFeedBtn');
            if (refreshBtn) {
                refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Refreshing...</span>';
                setTimeout(() => {
                    refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> <span>Refresh</span>';
                }, 1000);
            }
        } catch (error) {
            console.error('Error refreshing feed:', error);
            this.showNotification('Failed to refresh feed', 'error');
        }
    }

    /**
     * Generate session summary
     */
    generateSessionSummary() {
        const presentCount = this.attendanceData.filter(a => a.status === 'present').length;
        const lateCount = this.attendanceData.filter(a => a.status === 'late').length;
        const totalStudents = this.students.length;
        const absentCount = totalStudents - presentCount - lateCount;
        const attendanceRate = totalStudents > 0 ? Math.round((presentCount + lateCount) / totalStudents * 100) : 0;

        // Update summary modal
        document.getElementById('summarySubject').textContent = document.getElementById('subjectSelect')?.value || '-';
        document.getElementById('summaryRoom').textContent = document.getElementById('roomInput')?.value || '-';
        document.getElementById('summaryDate').textContent = new Date().toLocaleDateString();
        document.getElementById('summaryDuration').textContent = this.getSessionDuration();

        document.getElementById('summaryPresentCount').textContent = presentCount;
        document.getElementById('summaryLateCount').textContent = lateCount;
        document.getElementById('summaryAbsentCount').textContent = absentCount;
        document.getElementById('summaryTotalCount').textContent = totalStudents;
        document.getElementById('attendancePercentage').textContent = `${attendanceRate}%`;

        // Generate detailed report
        this.generateDetailedReport();

        // Show modal
        this.showSummaryModal();
    }

    /**
     * Generate detailed report for summary
     */
    generateDetailedReport() {
        const reportTableBody = document.getElementById('summaryReportTableBody');
        if (!reportTableBody) return;

        const allStudents = this.students.map(student => {
            const attendance = this.attendanceData.find(a => a.studentId === student.id);
            return {
                rollNumber: student.rollNumber,
                name: student.name,
                status: attendance ? attendance.status : 'absent',
                checkInTime: attendance ? new Date(attendance.timestamp).toLocaleTimeString() : '-',
                locationVerified: attendance ? (attendance.locationVerified ? 'Yes' : 'No') : '-'
            };
        });

        reportTableBody.innerHTML = allStudents.map(student => `
            <tr>
                <td>${student.rollNumber}</td>
                <td>${student.name}</td>
                <td><span class="status-badge status-${student.status}">${student.status}</span></td>
                <td>${student.checkInTime}</td>
                <td>${student.locationVerified}</td>
            </tr>
        `).join('');
    }

    /**
     * Get session duration
     */
    getSessionDuration() {
        if (!this.sessionStartTime) return '-';
        
        const duration = Date.now() - this.sessionStartTime;
        const minutes = Math.floor(duration / 60000);
        const seconds = Math.floor((duration % 60000) / 1000);
        return `${minutes}m ${seconds}s`;
    }

    /**
     * Show session summary modal
     */
    showSummaryModal() {
        const modal = document.getElementById('sessionSummaryModal');
        if (modal) {
            modal.style.display = 'block';
            modal.classList.add('fade-in');
        }
    }

    /**
     * Close session summary modal
     */
    closeSummaryModal() {
        const modal = document.getElementById('sessionSummaryModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('fade-in');
        }
    }

    /**
     * Download report (PDF)
     */
    async downloadReport() {
        try {
            // In real implementation, generate PDF on server
            this.showNotification('PDF report functionality will be implemented', 'info');
        } catch (error) {
            console.error('Error downloading report:', error);
            this.showNotification('Failed to download report', 'error');
        }
    }

    /**
     * Export to Excel
     */
    exportExcel() {
        const data = this.attendanceData.map(record => ({
            'Roll Number': record.studentId,
            'Student Name': record.studentName,
            'Status': record.status,
            'Check-in Time': new Date(record.timestamp).toLocaleString(),
            'Location Verified': record.locationVerified ? 'Yes' : 'No'
        }));

        const csvContent = this.convertToCSV(data);
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `attendance-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        
        window.URL.revokeObjectURL(url);
        this.showNotification('Attendance exported to CSV', 'success');
    }

    /**
     * Convert data to CSV
     */
    convertToCSV(data) {
        if (data.length === 0) return '';
        
        const headers = Object.keys(data[0]);
        const csvContent = [
            headers.join(','),
            ...data.map(row => headers.map(header => `"${row[header]}"`).join(','))
        ].join('\n');
        
        return csvContent;
    }

    /**
     * Handle keyboard shortcuts
     */
    handleKeyboardShortcuts(event) {
        if (event.ctrlKey || event.metaKey) {
            switch (event.key) {
                case 'g':
                    event.preventDefault();
                    if (!this.sessionActive) {
                        this.generateQRCode();
                    }
                    break;
                case 'r':
                    event.preventDefault();
                    if (this.sessionActive) {
                        this.regenerateQR();
                    }
                    break;
                case 'e':
                    event.preventDefault();
                    if (this.sessionActive) {
                        this.endSession();
                    }
                    break;
            }
        }
    }

    /**
     * Utility Methods
     */
    getCurrentFacultyId() {
        // Get from localStorage or authentication token
        return localStorage.getItem('facultyId') || 'faculty_001';
    }

    getAuthToken() {
        return localStorage.getItem('authToken') || '';
    }

    setUILoading(loading) {
        const buttons = document.querySelectorAll('.btn');
        buttons.forEach(btn => {
            if (loading) {
                btn.classList.add('loading');
                btn.disabled = true;
            } else {
                btn.classList.remove('loading');
                btn.disabled = false;
            }
        });
    }

    updateUI() {
        // Update initial UI state
        this.updateStatusIndicator('inactive', 'QR Code Inactive');
        this.updateTimerDisplay('--:--', 'inactive');
    }

    /**
     * Show notification
     */
    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${this.getNotificationIcon(type)}"></i>
                <span>${message}</span>
            </div>
            <button class="notification-close">
                <i class="fas fa-times"></i>
            </button>
        `;

        // Add to page
        document.body.appendChild(notification);

        // Auto remove after 5 seconds
        const autoRemove = setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);

        // Manual close
        notification.querySelector('.notification-close').addEventListener('click', () => {
            clearTimeout(autoRemove);
            notification.remove();
        });

        // Add slide out animation
        notification.style.animation = 'slideInRight 0.3s ease-out';

        console.log(`[${type.toUpperCase()}] ${message}`);
    }

    /**
     * Handle API errors gracefully
     */
    async handleApiCall(url, options = {}) {
        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`,
                    ...options.headers
                }
            });

            if (!response.ok) {
                if (response.status === 401) {
                    this.showNotification('Authentication required. Please login again.', 'warning');
                    // Redirect to login after delay
                    setTimeout(() => {
                        window.location.href = '/login.html';
                    }, 2000);
                    return null;
                }
                
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            if (error.name === 'NetworkError' || !navigator.onLine) {
                this.showNotification('Network connection error. Please check your internet connection.', 'error');
            } else {
                console.error('API call failed:', error);
                this.showNotification(error.message || 'An unexpected error occurred', 'error');
            }
            return null;
        }
    }

    getNotificationIcon(type) {
        const icons = {
            success: 'check-circle',
            error: 'exclamation-circle',
            warning: 'exclamation-triangle',
            info: 'info-circle'
        };
        return icons[type] || 'info-circle';
    }

    /**
     * Student management methods
     */
    editStudent(studentId) {
        const student = this.students.find(s => s.id === studentId);
        if (!student) return;

        // Implementation for edit student modal/form
        this.showNotification(`Edit functionality for ${student.name} will be implemented`, 'info');
    }

    deleteStudent(studentId) {
        const student = this.students.find(s => s.id === studentId);
        if (!student) return;

        if (confirm(`Are you sure you want to delete ${student.name}?`)) {
            this.students = this.students.filter(s => s.id !== studentId);
            this.renderStudentTable();
            this.updateStudentCount();
            this.showNotification('Student deleted successfully', 'success');
        }
    }

    viewStudentDetails(studentId) {
        const student = this.students.find(s => s.id === studentId);
        if (!student) return;

        this.showNotification(`Student details for ${student.name} will be implemented`, 'info');
    }

    updateBulkDeleteVisibility() {
        const checkboxes = document.querySelectorAll('.student-checkbox:checked');
        const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
        
        if (bulkDeleteBtn) {
            bulkDeleteBtn.style.display = checkboxes.length > 0 ? 'block' : 'none';
        }
    }
}

// Initialize dashboard when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDashboard);
} else {
    // DOM already loaded
    initializeDashboard();
}

function initializeDashboard() {
    try {
        window.dashboard = new ModernFacultyDashboard();
        console.log('🚀 Modern Faculty Dashboard initialized successfully');
    } catch (error) {
        console.error('❌ Failed to initialize dashboard:', error);
        
        // Show user-friendly error
        const errorDiv = document.createElement('div');
        errorDiv.className = 'initialization-error';
        errorDiv.innerHTML = `
            <div class="error-content">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Dashboard Initialization Error</h3>
                <p>The faculty dashboard failed to load properly. Please refresh the page or contact support.</p>
                <button onclick="window.location.reload()" class="btn btn-primary">
                    <i class="fas fa-sync-alt"></i> Refresh Page
                </button>
            </div>
        `;
        document.body.appendChild(errorDiv);
    }
}

// Add notification styles if not already present
if (!document.querySelector('#notification-styles')) {
    const style = document.createElement('style');
    style.id = 'notification-styles';
    style.textContent = `
        .notification {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 1rem;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: white;
            font-weight: 500;
            min-width: 300px;
            max-width: 400px;
            animation: slideInRight 0.3s ease-out;
        }

        .notification-success {
            background: linear-gradient(135deg, #10b981, #059669);
        }

        .notification-error {
            background: linear-gradient(135deg, #ef4444, #dc2626);
        }

        .notification-warning {
            background: linear-gradient(135deg, #f59e0b, #d97706);
        }

        .notification-info {
            background: linear-gradient(135deg, #3b82f6, #2563eb);
        }

        .notification-content {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }

        .notification-close {
            background: none;
            border: none;
            color: white;
            cursor: pointer;
            padding: 0.25rem;
            border-radius: 4px;
            opacity: 0.8;
            transition: opacity 0.2s;
        }

        .notification-close:hover {
            opacity: 1;
            background: rgba(255, 255, 255, 0.1);
        }

        @keyframes slideInRight {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
    `;
    document.head.appendChild(style);
}