document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const startSessionBtn = document.getElementById('startSessionBtn');
    const regenerateQRBtn = document.getElementById('regenerateQRBtn');
    const endSessionBtn = document.getElementById('endSessionBtn');
    const qrCodePlaceholder = document.getElementById('qrCodePlaceholder');
    const qrCode = document.getElementById('qrCode');
    const timerDisplay = document.getElementById('timer');
    const minutesDisplay = document.getElementById('minutes');
    const secondsDisplay = document.getElementById('seconds');
    const attendanceLog = document.getElementById('attendanceLog');
    const presentCount = document.getElementById('presentCount');
    const lateCount = document.getElementById('lateCount');
    const absentCount = document.getElementById('absentCount');
    
    // Session variables
    let sessionActive = false;
    let qrCodeExpiry = null;
    let timerInterval = null;
    let socket = null;
    let currentSessionId = null;
    let attendanceData = [];
    
    // Sample student data (in a real app, this would come from the server)
    const sampleStudents = [
        { id: 'S001', name: 'Alice Johnson', present: false, timestamp: null, status: 'absent' },
        { id: 'S002', name: 'Bob Smith', present: false, timestamp: null, status: 'absent' },
        { id: 'S003', name: 'Charlie Brown', present: false, timestamp: null, status: 'absent' },
        { id: 'S004', name: 'Diana Prince', present: false, timestamp: null, status: 'absent' },
        { id: 'S005', name: 'Ethan Hunt', present: false, timestamp: null, status: 'absent' },
    ];
    
    // Initialize the page
    function init() {
        setupEventListeners();
        updateAttendanceSummary();
    }
    
    // Set up event listeners
    function setupEventListeners() {
        // Start session button
        startSessionBtn.addEventListener('click', startSession);
        
        // Regenerate QR code button
        regenerateQRBtn.addEventListener('click', generateQRCode);
        
        // End session button
        endSessionBtn.addEventListener('click', endSession);
        
        // Initialize tooltips
        const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
        tooltipTriggerList.map(function (tooltipTriggerEl) {
            return new bootstrap.Tooltip(tooltipTriggerEl);
        });
    }
    
    // Start a new attendance session
    function startSession() {
        const subject = document.getElementById('subjectSelect').value;
        const classroom = document.getElementById('classroomSelect').value;
        const enableLocation = document.getElementById('enableLocation').checked;
        
        if (!subject || !classroom) {
            showAlert('Please select both subject and classroom', 'warning');
            return;
        }
        
        // Generate a unique session ID
        currentSessionId = 'SESS-' + Date.now().toString(36).toUpperCase();
        
        // Update UI
        startSessionBtn.disabled = true;
        regenerateQRBtn.disabled = false;
        endSessionBtn.disabled = false;
        sessionActive = true;
        
        // Generate initial QR code
        generateQRCode();
        
        // Connect to WebSocket
        connectWebSocket();
        
        // Show success message
        showAlert('Attendance session started successfully!', 'success');
    }
    
    // Generate a new QR code
    function generateQRCode() {
        if (!sessionActive) return;
        
        // Set expiry time (2 minutes from now)
        const expiryTime = new Date();
        expiryTime.setMinutes(expiryTime.getMinutes() + 2);
        qrCodeExpiry = expiryTime.getTime();
        
        // Create session data
        const sessionData = {
            sessionId: currentSessionId,
            subject: document.getElementById('subjectSelect').value,
            classroom: document.getElementById('classroomSelect').value,
            expiresAt: expiryTime.toISOString(),
            enableLocation: document.getElementById('enableLocation').checked
        };
        
        // Generate QR code
        QRCode.toCanvas(qrCode, JSON.stringify(sessionData), {
            width: 200,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        }, function(error) {
            if (error) {
                console.error('Error generating QR code:', error);
                showAlert('Failed to generate QR code', 'danger');
                return;
            }
            
            // Show the QR code and hide the placeholder
            qrCodePlaceholder.classList.add('d-none');
            qrCode.classList.remove('d-none');
            
            // Start the countdown timer
            startTimer();
        });
    }
    
    // Start the countdown timer
    function startTimer() {
        // Clear any existing timer
        if (timerInterval) {
            clearInterval(timerInterval);
        }
        
        // Update the timer every second
        timerInterval = setInterval(updateTimer, 1000);
        updateTimer(); // Initial call
    }
    
    // Update the countdown timer display
    function updateTimer() {
        if (!qrCodeExpiry) return;
        
        const now = new Date().getTime();
        const distance = qrCodeExpiry - now;
        
        // If the countdown is finished
        if (distance < 0) {
            clearInterval(timerInterval);
            timerDisplay.textContent = 'EXPIRED';
            timerDisplay.style.backgroundColor = '#6c757d';
            return;
        }
        
        // Calculate minutes and seconds
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);
        
        // Update the display
        minutesDisplay.textContent = minutes.toString().padStart(2, '0');
        secondsDisplay.textContent = seconds.toString().padStart(2, '0');
        
        // Change color when less than 30 seconds remaining
        if (distance < 30000) { // 30 seconds
            timerDisplay.style.backgroundColor = '#dc3545';
        } else {
            timerDisplay.style.backgroundColor = '#198754';
        }
    }
    
    // End the current session
    function endSession() {
        if (!confirm('Are you sure you want to end this session? This cannot be undone.')) {
            return;
        }
        
        // Update UI
        sessionActive = false;
        clearInterval(timerInterval);
        
        // Disable buttons
        startSessionBtn.disabled = false;
        regenerateQRBtn.disabled = true;
        endSessionBtn.disabled = true;
        
        // Hide QR code
        qrCode.classList.add('d-none');
        qrCodePlaceholder.classList.remove('d-none');
        
        // Show session summary
        showSessionSummary();
        
        // Disconnect WebSocket
        if (socket) {
            socket.disconnect();
            socket = null;
        }
        
        showAlert('Attendance session ended', 'info');
    }
    
    // Connect to WebSocket server
    function connectWebSocket() {
        // In a real app, you would connect to your WebSocket server here
        // For this example, we'll simulate WebSocket behavior with timeouts
        
        // Simulate student check-ins
        simulateStudentCheckIns();
    }
    
    // Simulate student check-ins (for demo purposes)
    function simulateStudentCheckIns() {
        if (!sessionActive) return;
        
        // Randomly select some students to check in
        const studentsToCheckIn = sampleStudents
            .filter(() => Math.random() > 0.3) // 70% chance of checking in
            .sort(() => Math.random() - 0.5); // Random order
        
        // Simulate check-ins with delays
        studentsToCheckIn.forEach((student, index) => {
            const delay = (index + 1) * (Math.random() * 3000 + 2000); // 2-5 seconds apart
            
            setTimeout(() => {
                if (!sessionActive) return;
                
                const now = new Date();
                const isLate = Math.random() > 0.7; // 30% chance of being late
                const status = isLate ? 'late' : 'present';
                
                // Update student data
                student.present = true;
                student.timestamp = now;
                student.status = status;
                
                // Add to attendance log
                addToAttendanceLog({
                    studentId: student.id,
                    name: student.name,
                    status: status,
                    timestamp: now.toISOString(),
                    location: isLate ? 'Nearby' : 'In class'
                });
                
                // Update summary
                updateAttendanceSummary();
                
            }, delay);
        });
    }
    
    // Add a new entry to the attendance log
    function addToAttendanceLog(data) {
        // Create a new row
        const row = document.createElement('tr');
        row.className = 'attendance-row';
        
        // Format the time
        const time = new Date(data.timestamp);
        const timeString = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Set status class
        const statusClass = data.status === 'present' ? 'status-present' : 'status-late';
        
        // Create the row HTML
        row.innerHTML = `
            <td>${data.studentId}</td>
            <td>${data.name}</td>
            <td><span class="status-badge ${statusClass}">${data.status.charAt(0).toUpperCase() + data.status.slice(1)}</span></td>
            <td>${timeString}</td>
            <td><i class="fas fa-map-marker-alt me-1"></i> ${data.location || 'Unknown'}</td>
        `;
        
        // Add the row to the top of the table
        const tbody = attendanceLog.querySelector('tbody');
        if (tbody.children.length > 1) {
            tbody.insertBefore(row, tbody.children[1]);
        } else {
            tbody.appendChild(row);
        }
        
        // If this is the first entry, remove the placeholder
        if (attendanceLog.querySelector('.text-muted')) {
            attendanceLog.innerHTML = '';
            const thead = document.createElement('thead');
            thead.innerHTML = `
                <tr>
                    <th>Student ID</th>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Time</th>
                    <th>Location</th>
                </tr>
            `;
            tbody.prepend(thead);
        }
    }
    
    // Update the attendance summary counters
    function updateAttendanceSummary() {
        const present = sampleStudents.filter(s => s.status === 'present').length;
        const late = sampleStudents.filter(s => s.status === 'late').length;
        const absent = sampleStudents.filter(s => s.status === 'absent').length;
        
        presentCount.textContent = present;
        lateCount.textContent = late;
        absentCount.textContent = absent;
    }
    
    // Show the session summary modal
    function showSessionSummary() {
        const present = sampleStudents.filter(s => s.status === 'present').length;
        const late = sampleStudents.filter(s => s.status === 'late').length;
        const absent = sampleStudents.filter(s => s.status === 'absent').length;
        const total = sampleStudents.length;
        
        // Update summary data
        document.getElementById('summarySubject').textContent = document.getElementById('subjectSelect').options[document.getElementById('subjectSelect').selectedIndex].text;
        document.getElementById('summaryClassroom').textContent = document.getElementById('classroomSelect').value;
        document.getElementById('summaryStartTime').textContent = new Date().toLocaleString();
        document.getElementById('summaryEndTime').textContent = new Date().toLocaleString();
        
        document.getElementById('summaryPresent').textContent = present;
        document.getElementById('summaryLate').textContent = late;
        document.getElementById('summaryAbsent').textContent = absent;
        document.getElementById('summaryTotal').textContent = total;
        
        // Populate attendance list
        const summaryList = document.getElementById('summaryAttendanceList');
        summaryList.innerHTML = '';
        
        sampleStudents.forEach(student => {
            const row = document.createElement('tr');
            const statusText = student.status.charAt(0).toUpperCase() + student.status.slice(1);
            const statusClass = student.status === 'present' ? 'status-present' : 
                              (student.status === 'late' ? 'status-late' : 'status-absent');
            const time = student.timestamp ? new Date(student.timestamp).toLocaleTimeString() : 'N/A';
            
            row.innerHTML = `
                <td>${student.id}</td>
                <td>${student.name}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>${time}</td>
            `;
            
            summaryList.appendChild(row);
        });
        
        // Show the modal
        const modal = new bootstrap.Modal(document.getElementById('sessionSummaryModal'));
        modal.show();
    }
    
    // Show an alert message
    function showAlert(message, type = 'info') {
        // In a real app, you might use a toast notification system
        console.log(`[${type.toUpperCase()}] ${message}`);
        alert(`[${type.toUpperCase()}] ${message}`);
    }
    
    // Initialize the page
    init();
});
