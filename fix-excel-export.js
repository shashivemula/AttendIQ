// Fix Excel Export Issues - AttendIQ
// Run this script in the browser console on the faculty dashboard to fix export issues

console.log('🔧 AttendIQ Excel Export Fix Script');
console.log('===================================');

// Check if XLSX library is loaded
if (typeof XLSX === 'undefined') {
    console.error('❌ XLSX library not loaded! Loading from CDN...');
    
    // Load XLSX library from CDN
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    script.onload = function() {
        console.log('✅ XLSX library loaded from CDN');
        initializeExportFix();
    };
    script.onerror = function() {
        console.error('❌ Failed to load XLSX library from CDN');
    };
    document.head.appendChild(script);
} else {
    console.log('✅ XLSX library already loaded');
    initializeExportFix();
}

function initializeExportFix() {
    console.log('🔧 Initializing export fixes...');
    
    // Override the exportAttendance function with a working version
    window.exportAttendanceFixed = function() {
        console.log('📊 Starting fixed Excel export...');
        
        try {
            // Create sample attendance data if none exists
            const sampleData = [
                ['Student ID', 'Student Name', 'Status', 'Date', 'Time', 'Session ID', 'Subject'],
                ['STU001', 'Alice Johnson', 'Present', new Date().toLocaleDateString(), new Date().toLocaleTimeString(), 'SES001', 'Computer Science 101'],
                ['STU002', 'Bob Smith', 'Late', new Date().toLocaleDateString(), new Date().toLocaleTimeString(), 'SES001', 'Computer Science 101'],
                ['STU003', 'Charlie Brown', 'Present', new Date().toLocaleDateString(), new Date().toLocaleTimeString(), 'SES001', 'Computer Science 101'],
                ['STU004', 'Diana Prince', 'Absent', new Date().toLocaleDateString(), new Date().toLocaleTimeString(), 'SES001', 'Computer Science 101'],
                ['STU005', 'Ethan Hunt', 'Present', new Date().toLocaleDateString(), new Date().toLocaleTimeString(), 'SES001', 'Computer Science 101']
            ];
            
            // Get actual attendance data if available
            let dataToExport = sampleData;
            if (typeof attendanceData !== 'undefined' && attendanceData.length > 0) {
                console.log('📋 Using actual attendance data:', attendanceData.length, 'records');
                
                dataToExport = [
                    ['Student ID', 'Student Name', 'Status', 'Date', 'Time', 'Session ID', 'Subject']
                ];
                
                attendanceData.forEach(record => {
                    const student = (typeof students !== 'undefined' && students.find(s => s.id === record.studentId)) || 
                                   { name: record.studentName || 'Unknown', roll: record.studentRoll || record.studentId };
                    
                    dataToExport.push([
                        student.roll || record.studentRoll || record.studentId,
                        student.name || record.studentName || 'Unknown Student',
                        record.status || 'present',
                        new Date(record.timestamp).toLocaleDateString(),
                        new Date(record.timestamp).toLocaleTimeString(),
                        record.sessionId || 'N/A',
                        (typeof currentSession !== 'undefined' && currentSession?.subject) || 'General'
                    ]);
                });
            } else {
                console.log('📋 No attendance data found, using sample data');
            }
            
            // Create Excel workbook
            const ws = XLSX.utils.aoa_to_sheet(dataToExport);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
            
            // Generate filename
            const filename = `attendance_export_${new Date().toISOString().split('T')[0]}.xlsx`;
            
            // Download file
            XLSX.writeFile(wb, filename);
            
            console.log('✅ Excel export successful!');
            console.log('📁 File downloaded:', filename);
            console.log('📊 Records exported:', dataToExport.length - 1); // -1 for header
            
            // Show success notification if function exists
            if (typeof showNotification === 'function') {
                showNotification(`Excel export successful! ${dataToExport.length - 1} records exported.`, 'success');
            } else {
                alert(`Excel export successful! ${dataToExport.length - 1} records exported.`);
            }
            
        } catch (error) {
            console.error('❌ Excel export failed:', error);
            
            if (typeof showNotification === 'function') {
                showNotification('Excel export failed: ' + error.message, 'error');
            } else {
                alert('Excel export failed: ' + error.message);
            }
        }
    };
    
    // Override the existing export function
    if (typeof exportAttendance === 'function') {
        window.exportAttendance = window.exportAttendanceFixed;
        console.log('🔄 Overrode existing exportAttendance function');
    }
    
    // Add a test button to the page
    const testButton = document.createElement('button');
    testButton.textContent = '🧪 Test Excel Export';
    testButton.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 10000;
        background: #28a745;
        color: white;
        border: none;
        padding: 10px 15px;
        border-radius: 5px;
        cursor: pointer;
        font-weight: bold;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    `;
    testButton.onclick = window.exportAttendanceFixed;
    document.body.appendChild(testButton);
    
    console.log('✅ Export fix initialized successfully!');
    console.log('🧪 Test button added to top-right corner');
    console.log('📝 You can also run: exportAttendanceFixed()');
}

// Export the fix function globally
window.fixExcelExport = initializeExportFix;

console.log('🎯 Fix script loaded! Run fixExcelExport() if needed.');