require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const os = require('os');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const XLSX = require('xlsx');
const { Parser } = require('@json2csv/plainjs');
const axios = require('axios');
const twilio = require('twilio');
const AILeaveAnalyzer = require('./ai-leave-analyzer');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname)
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files are allowed'));
    }
  }
});

// Configure multer for profile photo uploads (images only)
const imageUpload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

const app = express();
const server = http.createServer(app);

// Initialize AI analyzer
const aiAnalyzer = new AILeaveAnalyzer();
// Configure environment
const isProduction = process.env.NODE_ENV === 'production';
const isReplit = !!process.env.REPLIT_DB_URL;

// Dynamically detect local IP address for CORS
function getLocalIPAddress() {
  const networkInterfaces = os.networkInterfaces();
  for (const iface of Object.values(networkInterfaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return null;
}

const localIP = getLocalIPAddress();
console.log(`🔧 Detected local IP: ${localIP}`);

// Configure CORS with comprehensive origin checking
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin && !isProduction) {
      console.log('Allowing request with no origin in development');
      return callback(null, true);
    }

    // List of allowed origins
    const allowedOrigins = [
      // Local development
      /^https?:\/\/localhost(:\d+)?$/, // localhost with any port
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/, // 127.0.0.1 with any port
      
      // 1. Add the dynamically detected IP (Critical for mobile)
      localIP ? new RegExp(`^https?:\\/\\/${localIP.replace(/\./g, '\\.')}(:\\d+)?$`) : null,

      // 2. Allow ANY 192.168.x.x address (Broad fix for home WiFi)
      /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,
      
      // 3. Allow 10.x.x.x address (Common in University/Corporate WiFi)
      /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,

      // Replit environment
      isReplit && process.env.REPLIT_DEV_DOMAIN
        ? new RegExp(`^https?:\\/\\/${process.env.REPLIT_DEV_DOMAIN.replace(/\./g, '\\.')}$`)
        : null,

      // Additional origins from environment
      ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : [])
    ].filter(Boolean); // Remove any null/undefined values

    // Check if origin is allowed
    if (!origin || allowedOrigins.some(pattern =>
      typeof pattern === 'string'
        ? origin === pattern
        : pattern.test(origin)
    )) {
      console.log(`✅ Allowed CORS request from: ${origin || 'no origin'}`);
      return callback(null, true);
    }

    console.warn(`❌ Blocked CORS request from: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Length', 'X-Foo', 'X-Bar'],
  maxAge: 600, 
  optionsSuccessStatus: 204
};

// Enable CORS for all routes
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Enable pre-flight for all routes

// Log CORS errors for debugging
app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    console.warn('CORS violation attempt from:', req.headers.origin || 'unknown origin');
    return res.status(403).json({ error: 'Not allowed by CORS' });
  }
  next(err);
});

// Add Replit domain if in Replit environment
if (isReplit && process.env.REPLIT_DEV_DOMAIN) {
  console.log(`Replit domain detected: ${process.env.REPLIT_DEV_DOMAIN}`);
}

// Log additional allowed origins from environment
if (process.env.ALLOWED_ORIGINS) {
  console.log('Additional allowed origins:', process.env.ALLOWED_ORIGINS.split(','));
}

// Configure Socket.IO with CORS
const io = socketIo(server, {
  cors: {
    origin: function(origin, callback) {
      // Allow all origins in development
      if (!isProduction) {
        return callback(null, true);
      }
      
      // In production, only allow specific origins
      const allowedOrigins = [
        // Add your production domains here
        /^https?:\/\/yourdomain\.com$/,
        /^https?:\/\/www\.yourdomain\.com$/
      ];
      
      if (!origin || allowedOrigins.some(regex => regex.test(origin))) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 🔒 SECURITY: Secure static file serving - prevent database exposure
app.use((req, res, next) => {
  // Block access to sensitive files
  const blocked = ['.db', '.sqlite', '.sqlite3', 'package.json', 'package-lock.json', '.env'];
  if (blocked.some(ext => req.path.toLowerCase().endsWith(ext))) {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
});

// Serve static files from specific directories only
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/attached_assets', express.static(path.join(__dirname, 'attached_assets')));

// On-demand proxy/cache for face-api.js model weights under /js/weights/
app.get('/js/weights/:fileName', async (req, res) => {
  try {
    const { fileName } = req.params;
    const localDir = path.join(__dirname, 'js', 'weights');
    const localPath = path.join(localDir, fileName);
    const fs = require('fs');
    const fsp = fs.promises;

    // Serve from disk if present
    if (fs.existsSync(localPath)) {
      return res.sendFile(localPath);
    }

    // Fetch from CDN and cache (vladmandic version for consistency)
    const cdnBase = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model/';
    const url = cdnBase + encodeURIComponent(fileName);
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).json({ error: `Failed to fetch model: ${fileName}` });
    }
    const arrayBuf = await response.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    await fsp.mkdir(localDir, { recursive: true });
    await fsp.writeFile(localPath, buf);
    // Set type for json manifests
    if (fileName.endsWith('.json')) res.type('application/json');
    return res.send(buf);
  } catch (e) {
    console.error('Weights proxy error:', e);
    return res.status(500).json({ error: 'Weights proxy error' });
  }
});

// Serve HTML files individually for better control
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/faculty-dashboard.html', (req, res) => res.sendFile(path.join(__dirname, 'faculty-dashboard.html')));
app.get('/student-dashboard.html', (req, res) => res.sendFile(path.join(__dirname, 'student-dashboard.html')));
app.get('/student-checkin.html', (req, res) => res.sendFile(path.join(__dirname, 'student-checkin.html')));
app.get('/checkin.html', (req, res) => res.sendFile(path.join(__dirname, 'checkin.html')));
app.get('/face-registration.html', (req, res) => res.sendFile(path.join(__dirname, 'face-registration.html')));

// JWT Secret - SECURITY: Require strong secret in production
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === 'your-secret-key') {
  console.error('🔒 SECURITY ERROR: JWT_SECRET environment variable must be set with a strong value');
  console.error('Generate a strong secret: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  } else {
    console.warn('⚠️  WARNING: Using weak JWT secret in development mode');
  }
}

// SQLite Database Configuration
const db = new sqlite3.Database('attendiq.db', (err) => {
  if (err) {
    console.error('Error connecting to SQLite database:', err);
  } else {
    console.log('Connected to SQLite database');
    createTables();
    migrateExistingDatabase(); // Handle existing deployments
  }
});

// CRITICAL: Database migration for existing deployments
function migrateExistingDatabase() {
  console.log('🔄 Checking for required database migrations...');

  // Check if sessions table has geo columns
  db.all("PRAGMA table_info(sessions)", (err, columns) => {
    if (err) {
      console.error('Migration check error:', err);
      return;
    }

    const columnNames = columns.map(col => col.name);
    const requiredColumns = ['latitude', 'longitude', 'radius_meters', 'geo_required', 'ended_at'];

    // Define the queries to add columns
    const alterQueries = {
      latitude: 'ALTER TABLE sessions ADD COLUMN latitude REAL',
      longitude: 'ALTER TABLE sessions ADD COLUMN longitude REAL',
      radius_meters: 'ALTER TABLE sessions ADD COLUMN radius_meters INTEGER DEFAULT 100',
      geo_required: 'ALTER TABLE sessions ADD COLUMN geo_required BOOLEAN DEFAULT 1',
      ended_at: 'ALTER TABLE sessions ADD COLUMN ended_at DATETIME'
    };

    const missingColumns = requiredColumns.filter(col => !columnNames.includes(col));

    if (missingColumns.length > 0) {
      console.log(`🚧 Adding missing columns to sessions table: ${missingColumns.join(', ')}`);

      missingColumns.forEach(col => {
        db.run(alterQueries[col], (err) => {
          if (err && !err.message.includes('duplicate column name')) {
            console.error(`Error adding column ${col}:`, err);
          } else {
            console.log(`✅ Added column: ${col}`);
          }
        });
      });
    } else {
      console.log('✅ All required columns exist in sessions table');
    }
  });
}


// Create required tables
function createTables() {
  // Students table
  const studentsTable = `
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;

  // Faculty table
  const facultyTable = `
    CREATE TABLE IF NOT EXISTS faculty (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      faculty_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;

  // Sessions table for QR codes
  const sessionsTable = `
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT UNIQUE NOT NULL,
      faculty_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      room TEXT DEFAULT 'Classroom',
      qr_code_data TEXT,
      expires_at DATETIME NOT NULL,
      latitude REAL,
      longitude REAL,
      radius_meters INTEGER DEFAULT 100,
      geo_required BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;

  // Student subjects table (for assigning subjects to students)
  const studentSubjectsTable = `
    CREATE TABLE IF NOT EXISTS student_subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      faculty_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students (student_id),
      FOREIGN KEY (faculty_id) REFERENCES faculty (faculty_id),
      UNIQUE(student_id, subject)
    )
  `;

  // Attendance table
  const attendanceTable = `
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT CHECK(status IN ('present', 'late')) DEFAULT 'present'
    )
  `;

  // Profile photos table
  const profilePhotosTable = `
    CREATE TABLE IF NOT EXISTS profile_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT UNIQUE NOT NULL,
      photo_path TEXT NOT NULL,
      face_descriptor TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students (student_id) ON DELETE CASCADE
    )
  `;

  // Leave requests table
  const leaveRequestsTable = `
    CREATE TABLE IF NOT EXISTS leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,
      faculty_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      leave_date DATE NOT NULL,
      reason_category TEXT NOT NULL,
      reason_text TEXT NOT NULL,
      status TEXT CHECK(status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
      ai_score INTEGER DEFAULT NULL,
      ai_recommendation TEXT DEFAULT NULL,
      faculty_comments TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students (student_id),
      FOREIGN KEY (faculty_id) REFERENCES faculty (faculty_id)
    )
  `;

  // Create unique constraint for attendance
  const attendanceIndex = `
    CREATE UNIQUE INDEX IF NOT EXISTS unique_attendance
    ON attendance(session_id, student_id)
  `;

  db.run(studentsTable, (err) => {
    if (err) console.error('Error creating students table:', err);
  });

  db.run(facultyTable, (err) => {
    if (err) console.error('Error creating faculty table:', err);
  });

  db.run(studentSubjectsTable, (err) => {
    if (err) console.error('Error creating student_subjects table:', err);
  });

  db.run(sessionsTable, (err) => {
    if (err) console.error('Error creating sessions table:', err);
  });

  db.run(attendanceTable, (err) => {
    if (err) console.error('Error creating attendance table:', err);
    else console.log('Database tables created successfully');
  });

  db.run(profilePhotosTable, (err) => {
    if (err) console.error('Error creating profile_photos table:', err);
  });

  db.run(leaveRequestsTable, (err) => {
    if (err) console.error('Error creating leave_requests table:', err);
  });

  db.run(attendanceIndex, (err) => {
    if (err) console.error('Error creating attendance index:', err);
  });
}

// In-memory storage for active QR codes (for 2-minute expiration)
const activeQRCodes = new Map();

// Haversine distance calculation function (returns distance in meters)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// Clean up expired QR codes every minute
setInterval(() => {
  const now = new Date();
  for (const [sessionId, sessionData] of activeQRCodes) {
    if (now > sessionData.expiresAt) {
      activeQRCodes.delete(sessionId);
    }
  }
}, 60000);

// Public endpoint to fetch session metadata for clients (no auth)
app.get('/api/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = activeQRCodes.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  res.json({
    success: true,
    sessionId,
    subject: session.subject,
    room: session.room,
    expiresAt: session.expiresAt instanceof Date ? session.expiresAt.toISOString() : session.expiresAt,
    geoRequired: !!session.geoRequired,
    location: session.location || null
  });
});

// Save face descriptor for authenticated student
app.post('/api/student/register-face', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') {
    return res.status(403).json({ error: 'Student access required' });
  }

  const studentId = req.user.userId;
  const { faceDescriptor } = req.body; // Expect an array of numbers length ~128

  if (!Array.isArray(faceDescriptor) || faceDescriptor.length === 0) {
    return res.status(400).json({ error: 'Valid face descriptor is required' });
  }

  // Ensure profile photo record exists first (schema requires photo_path NOT NULL)
  db.get('SELECT 1 FROM profile_photos WHERE student_id = ?', [studentId], (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Profile photo not found. Upload profile photo first.' });
    }

    db.run(
      'UPDATE profile_photos SET face_descriptor = ?, uploaded_at = CURRENT_TIMESTAMP WHERE student_id = ?',
      [JSON.stringify(faceDescriptor), studentId],
      function (updateErr) {
        if (updateErr) {
          console.error('Database update error:', updateErr);
          return res.status(500).json({ error: 'Failed to save face descriptor' });
        }
        return res.json({ success: true, message: 'Face descriptor saved' });
      }
    );
  });
});

// Get face descriptor for authenticated student
app.get('/api/student/face-descriptor', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') {
    return res.status(403).json({ error: 'Student access required' });
  }
  const studentId = req.user.userId;
  db.get('SELECT face_descriptor FROM profile_photos WHERE student_id = ?', [studentId], (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    if (!row || !row.face_descriptor) {
      return res.status(404).json({ error: 'No face descriptor found' });
    }
    try {
      const desc = JSON.parse(row.face_descriptor);
      return res.json({ success: true, faceDescriptor: desc });
    } catch (e) {
      return res.status(500).json({ error: 'Stored face descriptor invalid' });
    }
  });
});

// Clear face descriptor for authenticated student
app.delete('/api/student/clear-face', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') {
    return res.status(403).json({ error: 'Student access required' });
  }
  
  const studentId = req.user.userId;
  
  db.run(
    'UPDATE profile_photos SET face_descriptor = NULL WHERE student_id = ?',
    [studentId],
    function(err) {
      if (err) {
        console.error('Database error clearing face:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'No profile found' });
      }
      
      console.log(`✅ Face data cleared for student: ${studentId}`);
      return res.json({ success: true, message: 'Face data cleared successfully' });
    }
  );
});

// 🔒 SECURITY: JWT Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.error('JWT verification error:', err);
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// 🔒 SECURITY: Faculty-only middleware
function requireFaculty(req, res, next) {
  if (req.user.type !== 'faculty') {
    return res.status(403).json({ error: 'Faculty access required' });
  }
  next();
}

// 🔒 SECURITY: Authorization middleware for faculty endpoints
function authorizeOwnResource(req, res, next) {
  const requestedFacultyId = req.params.facultyId || req.body.facultyId;

  if (requestedFacultyId && requestedFacultyId !== req.user.userId) {
    return res.status(403).json({ error: 'Access denied: You can only access your own data' });
  }
  next();
}

// Routes

// Student login
app.post('/api/student/login', (req, res) => {
  const { studentId, email, password } = req.body;

  // Accept either studentId or email
  const loginField = studentId || email;

  if (!loginField || !password) {
    return res.status(400).json({ error: 'Student ID/email and password are required' });
  }

  // Search by email first, then by student_id if no email match
  const query = loginField.includes('@') ?
    'SELECT * FROM students WHERE email = ?' :
    'SELECT * FROM students WHERE student_id = ?';

  db.get(query, [loginField], (err, student) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!student) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Use bcrypt.compare with callback instead of async/await
    bcrypt.compare(password, student.password_hash, (bcryptErr, isValidPassword) => {
      if (bcryptErr) {
        console.error('Bcrypt error:', bcryptErr);
        return res.status(500).json({ error: 'Authentication error' });
      }

      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign({
        userId: student.student_id,
        type: 'student'
      }, JWT_SECRET, { expiresIn: '30d' }); // 30 days instead of 365

      res.json({
        success: true,
        token,
        student: {
          id: student.student_id,
          name: student.name,
          email: student.email
        }
      });
    });
  });
});

// Faculty login
app.post('/api/faculty/login', (req, res) => {
  const { facultyId, email, password } = req.body;

  // Accept either facultyId or email
  const loginField = facultyId || email;

  if (!loginField || !password) {
    return res.status(400).json({ error: 'Faculty ID/email and password are required' });
  }

  // Search by email first, then by faculty_id if no email match
  const query = loginField.includes('@') ?
    'SELECT * FROM faculty WHERE email = ?' :
    'SELECT * FROM faculty WHERE faculty_id = ?';

  db.get(query, [loginField], (err, faculty) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!faculty) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Use bcrypt.compare with callback instead of async/await
    bcrypt.compare(password, faculty.password_hash, (bcryptErr, isValidPassword) => {
      if (bcryptErr) {
        console.error('Bcrypt error:', bcryptErr);
        return res.status(500).json({ error: 'Authentication error' });
      }

      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign({
        userId: faculty.faculty_id,
        type: 'faculty'
      }, JWT_SECRET, { expiresIn: '365d' });

      res.json({
        success: true,
        token,
        faculty: {
          id: faculty.faculty_id,
          name: faculty.name,
          email: faculty.email
        }
      });
    });
  });
});

// Upload Excel file with student credentials
app.post('/api/faculty/upload-students', authenticateToken, requireFaculty, upload.single('excel'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Excel file is required' });
  }

  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const students = XLSX.utils.sheet_to_json(worksheet);

    if (students.length === 0) {
      return res.status(400).json({ error: 'Excel file is empty' });
    }

    let processedCount = 0;
    const errors = [];

    students.forEach(async (studentData, index) => {
      const { student_id, name, email, password } = studentData;

      if (!student_id || !name || !email || !password) {
        errors.push(`Row ${index + 2}: Missing required fields`);
        return;
      }

      try {
        const passwordHash = await bcrypt.hash(password, 10);

        db.run(
          'INSERT OR REPLACE INTO students (student_id, name, email, password_hash) VALUES (?, ?, ?, ?)',
          [student_id, name, email, passwordHash],
          function (err) {
            if (err) {
              errors.push(`Row ${index + 2}: ${err.message}`);
            } else {
              processedCount++;
            }

            // Check if all students are processed
            if (processedCount + errors.length === students.length) {
              res.json({
                success: true,
                message: `Processed ${processedCount} students`,
                errors: errors.length > 0 ? errors : undefined
              });
            }
          }
        );
      } catch (error) {
        errors.push(`Row ${index + 2}: ${error.message}`);
      }
    });

    // Clean up uploaded file
    require('fs').unlink(req.file.path, (err) => {
      if (err) console.error('Error deleting uploaded file:', err);
    });

  } catch (error) {
    res.status(500).json({ error: 'Error processing Excel file: ' + error.message });
  }
});

// Generate QR code for attendance session
app.post('/api/faculty/generate-qr', authenticateToken, requireFaculty, (req, res) => {
  const { facultyId, subject, room, geoRequired, location } = req.body;

  if (!facultyId || !subject) {
    return res.status(400).json({ error: 'Faculty ID and subject are required' });
  }

  // Validate geolocation parameters if geo is required
  const useGeolocation = !!geoRequired && location && location.latitude && location.longitude;
  
  if (useGeolocation && (!location.latitude || !location.longitude)) {
    return res.status(400).json({ 
      error: 'Latitude and longitude are required for geo-fenced sessions' 
    });
  }

  const sessionId = uuidv4();
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes from now
  
  const serverUrl = isReplit ? `https://${process.env.REPLIT_DEV_DOMAIN}` : `http://${localIP}:5000`;

  const sessionData = {
    sessionId,
    facultyId,
    subject,
    room: room || 'Classroom',
    timestamp: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
    location: useGeolocation ? {
      latitude: parseFloat(location.latitude),
      longitude: parseFloat(location.longitude),
      maxDistance: parseInt(location.maxDistance) || 100
    } : null
  };

  // Store in database
  db.run(
    `INSERT INTO sessions (
      session_id, faculty_id, subject, room, 
      qr_code_data, expires_at, 
      latitude, longitude, radius_meters, geo_required
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      facultyId,
      subject,
      room || 'Classroom',
      JSON.stringify(sessionData),
      expiresAt.toISOString(),
      useGeolocation ? parseFloat(location.latitude) : null,
      useGeolocation ? parseFloat(location.longitude) : null,
      useGeolocation ? (parseInt(location.maxDistance) || 100) : null,
      useGeolocation ? 1 : 0
    ],
    function (err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Failed to create session', details: err.message });
      }

      // Generate QR code with dynamic URL based on environment
      let checkinUrl;
      const isReplit = !!process.env.REPLIT_DEV_DOMAIN;

      // Smart environment detection for QR code URLs
      if (isReplit) {
        // For Replit deployment
        checkinUrl = `https://${process.env.REPLIT_DEV_DOMAIN}/checkin.html?session=${sessionId}&subject=${encodeURIComponent(subject)}&room=${encodeURIComponent(room || 'Classroom')}`;
      } else {
        // For any non-Replit environment (development/local/production on LAN), use machine's LAN IP
        const os = require('os');
        const networkInterfaces = os.networkInterfaces();
        let localIp = 'localhost';

        // Find the first non-internal IPv4 address
        Object.keys(networkInterfaces).forEach(iface => {
          networkInterfaces[iface].forEach(addr => {
            if (addr.family === 'IPv4' && !addr.internal) {
              localIp = addr.address;
            }
          });
        });

        // Serve check-in page directly from backend (port 5000) to ensure mobile access without Live Server
        checkinUrl = `http://${localIp}:5000/checkin.html?session=${sessionId}&subject=${encodeURIComponent(subject)}&room=${encodeURIComponent(room || 'Classroom')}`;
        console.log(`📱 Mobile check-in URL: ${checkinUrl}`);
      }

      // Generate QR code with optimized settings
      QRCode.toDataURL(checkinUrl, {
        errorCorrectionLevel: 'H',
        margin: 2,
        width: 400,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      }, (err, qrCodeURL) => {
        if (err) {
          console.error('QR Code generation error:', err);
          return res.status(500).json({
            success: false,
            error: 'Failed to generate QR code',
            details: err.message
          });
        }

        // Store in memory for quick access
        const sessionInfo = {
          facultyId,
          subject,
          room: room || 'Classroom',
          expiresAt,
          qrData: sessionData,
          checkInURL: checkinUrl,
          location: useGeolocation ? {
            latitude: parseFloat(location.latitude),
            longitude: parseFloat(location.longitude),
            maxDistance: parseInt(location.maxDistance) || 100
          } : null,
          geoRequired: useGeolocation
        };

        activeQRCodes.set(sessionId, sessionInfo);

        // Prepare response
        const response = {
          success: true,
          sessionId,
          qrCode: qrCodeURL,
          expiresAt: expiresAt.toISOString(),
          subject,
          room: room || 'Classroom',
          checkInURL: checkinUrl,
          geoRequired: useGeolocation,
          location: sessionInfo.location
        };

        // Send response
        res.json(response);

        // Emit to faculty dashboard for real-time updates
        io.emit('qr_generated', {
          sessionId,
          facultyId,
          subject,
          room: room || 'Classroom',
          expiresAt: expiresAt.toISOString(),
          checkInURL: checkinUrl
        });

        // 🚀 REAL-TIME: Notify enrolled students about new QR code
        db.all('SELECT student_id FROM student_subjects WHERE subject = ? AND faculty_id = ?', [subject, facultyId], (err, enrolledStudents) => {
          if (err) {
            console.error('Error fetching enrolled students for notifications:', err);
          } else if (enrolledStudents && enrolledStudents.length > 0) {
            // Prepare notification data for students
            const studentNotification = {
              sessionId,
              subject,
              room: room || 'Classroom',
              facultyId,
              expiresAt: expiresAt.toISOString(),
              checkInURL: checkinUrl,
              geoRequired: useGeolocation,
              location: sessionInfo.location,
              message: `New QR code available for ${subject}`,
              timestamp: new Date().toISOString()
            };

            // Emit to each enrolled student's room
            enrolledStudents.forEach(student => {
              const studentRoom = `student_${student.student_id}`;
              io.to(studentRoom).emit('qr_available', studentNotification);
              console.log(`📡 Notified student ${student.student_id} about new QR code for ${subject}`);
            });

            console.log(`✅ Notified ${enrolledStudents.length} enrolled students about new QR code`);
          }
        });

        console.log(`✅ QR Code generated: ${subject} - ${sessionId.slice(0, 8)}... (expires in 10 minutes)`);
      });
    }
  );
});

// Regenerate QR code for existing session
app.post('/api/faculty/regenerate-qr/:sessionId', authenticateToken, requireFaculty, (req, res) => {
  const { sessionId } = req.params;
  const { facultyId } = req.user;

  // Verify session exists and belongs to faculty
  db.get('SELECT * FROM sessions WHERE session_id = ? AND faculty_id = ?', [sessionId, facultyId], (err, session) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({
        success: false,
        error: 'Database error',
        details: err.message
      });
    }

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found or unauthorized'
      });
    }

    // Check if session is not expired
    const now = new Date();
    const expiresAt = new Date(session.expires_at);
    if (now > expiresAt) {
      return res.status(400).json({
        success: false,
        error: 'Cannot regenerate QR for expired session'
      });
    }

    // Generate new expiration time (extend by 10 minutes from now)
    const newExpiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    const sessionData = JSON.parse(session.qr_code_data);

    // Update session data with new expiration
    sessionData.expiresAt = newExpiresAt.toISOString();

    // Update session in database
    db.run(
      'UPDATE sessions SET expires_at = ?, qr_code_data = ? WHERE session_id = ?',
      [newExpiresAt.toISOString(), JSON.stringify(sessionData), sessionId],
      function (err) {
        if (err) {
          console.error('Database update error:', err);
          return res.status(500).json({
            success: false,
            error: 'Failed to update session',
            details: err.message
          });
        }

        // Generate new QR code URL with dynamic IP detection
        let checkinUrl;
        const isReplit = !!process.env.REPLIT_DEV_DOMAIN;

        if (isReplit) {
          checkinUrl = `https://${process.env.REPLIT_DEV_DOMAIN}/checkin.html?session=${sessionId}`;
        } else {
          // Always use LAN IP for non-Replit environments
          const os = require('os');
          const networkInterfaces = os.networkInterfaces();
          let localIp = 'localhost';

          // Find the first non-internal IPv4 address
          Object.keys(networkInterfaces).forEach(iface => {
            networkInterfaces[iface].forEach(addr => {
              if (addr.family === 'IPv4' && !addr.internal) {
                localIp = addr.address;
              }
            });
          });

          checkinUrl = `http://${localIp}:5000/checkin.html?session=${sessionId}&subject=${encodeURIComponent(session.subject)}&room=${encodeURIComponent(session.room || 'Classroom')}`;
          console.log(`🔄 Regenerated mobile check-in URL: ${checkinUrl}`);
        }

        // Generate new QR code
        QRCode.toDataURL(checkinUrl, {
          errorCorrectionLevel: 'H',
          margin: 2,
          width: 400,
          color: {
            dark: '#000000',
            light: '#ffffff'
          }
        }, (err, qrCodeURL) => {
          if (err) {
            console.error('QR generation error:', err);
            return res.status(500).json({
              success: false,
              error: 'Failed to generate QR code',
              details: err.message
            });
          }

          // Update in-memory storage
          const existingSession = activeQRCodes.get(sessionId);
          if (existingSession) {
            existingSession.expiresAt = newExpiresAt;
            existingSession.checkInURL = checkinUrl;
            existingSession.qrData = sessionData;
          } else {
            // If session not in memory, add it
            activeQRCodes.set(sessionId, {
              facultyId: session.faculty_id,
              subject: session.subject,
              room: session.room,
              expiresAt: newExpiresAt,
              qrData: sessionData,
              checkInURL: checkinUrl,
              location: session.latitude && session.longitude ? {
                latitude: parseFloat(session.latitude),
                longitude: parseFloat(session.longitude),
                maxDistance: parseInt(session.radius_meters) || 100
              } : null,
              geoRequired: session.geo_required === 1
            });
          }

          // Prepare response
          const response = {
            success: true,
            sessionId,
            qrCode: qrCodeURL,
            expiresAt: newExpiresAt.toISOString(),
            subject: session.subject,
            room: session.room || 'Classroom',
            checkInURL: checkinUrl,
            geoRequired: session.geo_required === 1,
            location: session.latitude && session.longitude ? {
              latitude: parseFloat(session.latitude),
              longitude: parseFloat(session.longitude),
              maxDistance: parseInt(session.radius_meters) || 100
            } : null
          };

          // Send response
          res.json(response);

          // Emit to faculty dashboard for real-time updates
          io.emit('qr_regenerated', {
            sessionId,
            facultyId: session.faculty_id,
            subject: session.subject,
            room: session.room || 'Classroom',
            expiresAt: newExpiresAt.toISOString(),
            checkInURL: checkinUrl
          });

          console.log(`🔄 QR Code regenerated: ${session.subject} - ${sessionId.slice(0, 8)}... (new expiry: ${newExpiresAt.toISOString()})`);
        });
      }
    );
  });
});

// SECURITY: Rate limiting per student+session to prevent DoS
const attendanceAttempts = new Map(); // studentId+sessionId -> { count, lastAttempt }
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_ATTEMPTS_PER_STUDENT = 5; // Max 5 attempts per minute per student per session

function checkRateLimit(studentId, sessionId, res) {
  const now = Date.now();
  const limitKey = `${studentId}-${sessionId}`; // Per-student, per-session
  const attempts = attendanceAttempts.get(limitKey) || { count: 0, lastAttempt: 0 };

  // Reset if window expired
  if (now - attempts.lastAttempt > RATE_LIMIT_WINDOW) {
    attempts.count = 0;
  }

  attempts.count++;
  attempts.lastAttempt = now;
  attendanceAttempts.set(limitKey, attempts);

  if (attempts.count > MAX_ATTEMPTS_PER_STUDENT) {
    res.status(429).json({
      error: 'Too many attendance attempts. Please wait before trying again.',
      retryAfter: RATE_LIMIT_WINDOW / 1000
    });
    return false;
  }
  return true;
}

// Cleanup old rate limit entries periodically to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of attendanceAttempts.entries()) {
    if (now - data.lastAttempt > RATE_LIMIT_WINDOW * 2) {
      attendanceAttempts.delete(key);
    }
  }
}, RATE_LIMIT_WINDOW); // Cleanup every minute

// Real QR code scanning endpoint - FANG Level with Authentication & Rate Limiting
app.post('/api/student/mark-attendance', authenticateToken, (req, res) => {
  const { sessionId, location, faceVerified, faceDistance } = req.body;
  const studentUserId = req.user.userId; // Get from authenticated token
  const serverTimestamp = new Date().toISOString(); // Use server time, never trust client

  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required' });
  }

  // Verify the user is actually a student
  if (req.user.type !== 'student') {
    return res.status(403).json({ error: 'Only students can mark attendance' });
  }

  // Apply rate limiting per student (prevents DoS)
  if (!checkRateLimit(studentUserId, sessionId, res)) {
    return; // Response already sent by checkRateLimit
  }

  // Check if session exists and is not expired
  const session = activeQRCodes.get(sessionId);
  if (!session) {
    return res.status(400).json({ error: 'Invalid or expired QR code' });
  }

  if (new Date() > session.expiresAt) {
    activeQRCodes.delete(sessionId);
    return res.status(400).json({ error: 'QR code has expired (10 minutes limit)' });
  }

  // Face verification enforcement (~60-65% similarity ~ distance <= 0.45, more lenient)
  const FACE_DISTANCE_THRESHOLD = 0.45;
  if (typeof faceVerified === 'boolean') {
    if (!faceVerified) {
      return res.status(403).json({ error: 'Face verification failed or not completed' });
    }
    if (typeof faceDistance === 'number' && !(faceDistance <= FACE_DISTANCE_THRESHOLD)) {
      return res.status(403).json({ error: 'Face match below required threshold' });
    }
  } else {
    // If client did not send face verification flag, block marking
    return res.status(403).json({ error: 'Face verification required' });
  }

  // Validate geolocation if required and location is provided (graceful handling)
  if (session.geoRequired && location && location.latitude && location.longitude) {
    // Prefer in-memory session.location (from QR data); fall back to DB columns if present
    const centerLat = session.location && session.location.latitude != null ? session.location.latitude : session.latitude;
    const centerLon = session.location && session.location.longitude != null ? session.location.longitude : session.longitude;
    const requiredRadius = (session.location && session.location.maxDistance) || session.radius_meters || session.radius || 100;

    const distance = calculateDistance(
      parseFloat(centerLat),
      parseFloat(centerLon),
      parseFloat(location.latitude),
      parseFloat(location.longitude)
    );

    if (distance > requiredRadius) {
      return res.status(403).json({
        error: `You are ${Math.round(distance)}m away from the class location. You must be within ${requiredRadius}m to mark attendance.`,
        distance: Math.round(distance),
        requiredRadius: requiredRadius,
        userLocation: location,
        sessionLocation: { latitude: centerLat, longitude: centerLon }
      });
    }

    console.log(`✅ Geolocation validated: Student is ${Math.round(distance)}m away (allowed: ${requiredRadius}m)`);
  } else if (session.geoRequired && (!location || !location.latitude || !location.longitude)) {
    console.log(`⚠️ Geolocation required but not provided - allowing check-in anyway for compatibility`);
  }

  // Get student details by student_id (matches JWT userId)
  db.get('SELECT * FROM students WHERE student_id = ?', [studentUserId], (err, student) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Idempotency: check if already marked for this session, avoid duplicate emits
    db.get('SELECT status, timestamp FROM attendance WHERE session_id = ? AND student_id = ?', [sessionId, student.student_id], (checkErr, existing) => {
      if (checkErr) {
        return res.status(500).json({ error: 'Database error during check' });
      }

      if (existing) {
        // Already recorded; return existing status without emitting again
        return res.json({
          success: true,
          alreadyMarked: true,
          message: 'Attendance already recorded',
          studentName: student.name,
          subject: session.subject,
          status: existing.status,
          timestamp: existing.timestamp,
          sessionId: sessionId
        });
      }

      // Determine attendance status based on SERVER time (security fix)
      const scanTime = new Date(); // Always use server time
      const sessionStart = new Date(session.expiresAt.getTime() - 2 * 60 * 1000); // 2 minutes before expiry
      const timeDiff = (scanTime - sessionStart) / 1000; // seconds
      const status = timeDiff <= 60 ? 'present' : 'late'; // First minute = present, after = late

      console.log(`🔒 Server-side status calculation: ${status} (${Math.round(timeDiff)}s after session start)`);

      // Record attendance with server timestamp
      db.run(
        'INSERT OR REPLACE INTO attendance (session_id, student_id, status, timestamp) VALUES (?, ?, ?, ?)',
        [sessionId, student.student_id, status, serverTimestamp],
        function (err) {
          if (err) {
            return res.status(500).json({ error: 'Failed to record attendance' });
          }

          res.json({
            success: true,
            message: 'Attendance marked successfully',
            studentName: student.name,
            subject: session.subject,
            status: status,
            timestamp: serverTimestamp, // Use server timestamp in response
            sessionId: sessionId
          });

          // 🚀 ENHANCED Real-time update to faculty dashboard
          const realTimeData = {
            sessionId: sessionId,
            studentId: student.student_id,
            studentName: student.name,
            studentEmail: student.email,
            subject: session.subject,
            status: status,
            timestamp: serverTimestamp,
            location: location,
            // Additional data for enhanced UI updates
            scanTime: new Date().toLocaleTimeString(),
            timeDifference: timeDiff
          };


          // Emit to all connected faculty dashboards
          io.emit('attendance_marked', realTimeData);


          // 🔒 FIXED: Emit to specific faculty room using consistent facultyId format
          io.to(`faculty_${session.facultyId}`).emit('attendance_update', realTimeData);

          console.log(`📡 Real-time update sent: ${student.name} marked ${status}`);

          console.log(`✅ Attendance marked: ${student.name} (${student.email}) - ${status} in ${session.subject}`);
          
          // Also check for other students who might have missed this session
          setTimeout(() => {
            checkConsecutiveAbsences(1);
          }, 5000);
        }
      );
    });
  });
});

// End session
app.post('/api/faculty/end-session/:sessionId', authenticateToken, requireFaculty, (req, res) => {
  const { sessionId } = req.params;
  const facultyId = req.user.userId;

  // Verify session exists and belongs to faculty
  db.get('SELECT * FROM sessions WHERE session_id = ? AND faculty_id = ?', [sessionId, facultyId], (err, session) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!session) {
      return res.status(404).json({ error: 'Session not found or unauthorized' });
    }

    if (session.ended_at) {
      return res.status(400).json({ error: 'Session already ended' });
    }

    // Remove from activeQRCodes
    activeQRCodes.delete(sessionId);

    // Update DB with ended_at
    db.run('UPDATE sessions SET ended_at = CURRENT_TIMESTAMP WHERE session_id = ?', [sessionId], function (err) {
      if (err) {
        console.error('Database update error:', err);
        return res.status(500).json({ error: 'Failed to end session' });
      }

      // Emit socket event for real-time updates
      io.emit('session_ended', {
        sessionId,
        facultyId,
        subject: session.subject,
        room: session.room
      });

      console.log(`✅ Session ended: ${session.subject} - ${sessionId.slice(0, 8)}... by faculty ${facultyId}`);
      
      // Check for absent students immediately after session ends
      console.log('🔍 Checking absent students for ended session...');
      setTimeout(() => {
        checkAbsentStudents(sessionId);
      }, 2000); // Wait 2 seconds for any last-minute attendance
      
      res.json({ success: true, message: 'Session ended successfully' });
    });
  });
});

// Get attendance data for faculty dashboard
app.get('/api/faculty/attendance/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  const query = `
    SELECT 
      a.student_id,
      s.name as student_name,
      a.status,
      a.timestamp
    FROM attendance a
    JOIN students s ON a.student_id = s.student_id
    WHERE a.session_id = ?
    ORDER BY a.timestamp ASC
  `;

  db.all(query, [sessionId], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    res.json({
      success: true,
      attendance: results
    });
  });
});

// 🚀 CSV Export Attendance Data
app.get('/api/faculty/export-attendance/:sessionId', authenticateToken, requireFaculty, (req, res) => {
  const { sessionId } = req.params;

  // 🔒 SECURITY: First verify that the faculty owns this session
  db.get('SELECT faculty_id FROM sessions WHERE session_id = ?', [sessionId], (err, session) => {
    if (err) {
      console.error('Session verification error:', err);
      return res.status(500).json({ error: 'Database error during authorization' });
    }

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.faculty_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied: You can only export your own sessions' });
    }

    // 🔒 SECURITY FIX: Only export students who actually attended this session
    const query = `
      SELECT 
        s.student_id as "Student ID",
        s.name as "Name", 
        s.email as "Email",
        sess.subject as "Class/Subject",
        CASE 
          WHEN a.status = 'present' THEN 'Present' 
          WHEN a.status = 'late' THEN 'Late'
          ELSE 'Absent'
        END as "Status",
        COALESCE(
          datetime(a.timestamp, 'localtime'), 
          'Not Recorded'
        ) as "Timestamp",
        sess.room as "Room",
        datetime(sess.created_at, 'localtime') as "Session Date"
      FROM attendance a
      JOIN students s ON a.student_id = s.student_id
      JOIN sessions sess ON a.session_id = sess.session_id
      WHERE sess.session_id = ?
      ORDER BY 
        a.timestamp ASC, 
        s.name ASC
    `;

    db.all(query, [sessionId], (err, results) => {
      if (err) {
        console.error('CSV Export Error:', err);
        return res.status(500).json({ error: 'Database error during export' });
      }

      if (results.length === 0) {
        // If no data found, create a sample CSV with headers
        const sampleCSV = 'Student ID,Name,Email,Class/Subject,Status,Timestamp,Room,Session Date\n' +
                         'No data,No attendance records found for this session,,,,,,';
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="no_data_found.csv"');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        
        return res.send(sampleCSV);
      }

      try {
        // Configure CSV parser with custom options
        const fields = [
          'Student ID',
          'Name',
          'Email',
          'Class/Subject',
          'Status',
          'Timestamp',
          'Room',
          'Session Date'
        ];

        const opts = {
          fields,
          delimiter: ',',
          header: true,
          encoding: 'utf8'
        };

        const parser = new Parser(opts);
        const csv = parser.parse(results);

        // 🔒 SECURITY: Sanitize filename to prevent directory traversal
        const sessionInfo = results[0];
        const sanitizedSubject = sessionInfo['Class/Subject'].replace(/[^a-zA-Z0-9_-]/g, '_');
        const sanitizedDate = sessionInfo['Session Date'].replace(/[^0-9]/g, '');
        const filename = `attendance_${sanitizedSubject}_${sanitizedDate}.csv`;

        // Set headers for file download
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        // Send CSV data
        res.send(csv);

        console.log(`📊 Secure CSV Export completed: ${results.length} records exported for session ${sessionId} by faculty ${req.user.userId}`);

      } catch (parseError) {
        console.error('CSV Parse Error:', parseError);
        return res.status(500).json({ error: 'Failed to generate CSV file' });
      }
    });
  });
});

// Export all sessions attendance data for faculty
app.get('/api/faculty/export-all-attendance/:facultyId', authenticateToken, requireFaculty, authorizeOwnResource, (req, res) => {
  const { facultyId } = req.params;

  const query = `
    SELECT
      s.student_id as "Student ID",
      s.name as "Name",
      s.email as "Email",
      sess.subject as "Class/Subject",
      CASE
        WHEN a.status = 'present' THEN 'Present'
        WHEN a.status = 'late' THEN 'Late'
        ELSE 'Absent'
      END as "Status",
      COALESCE(
        datetime(a.timestamp, 'localtime'),
        'Not Recorded'
      ) as "Timestamp",
      sess.room as "Room",
      datetime(sess.created_at, 'localtime') as "Session Date"
    FROM attendance a
    JOIN students s ON a.student_id = s.student_id
    JOIN sessions sess ON a.session_id = sess.session_id
    WHERE sess.faculty_id = ?
    ORDER BY
      sess.created_at DESC,
      a.timestamp ASC,
      s.name ASC
  `;

  db.all(query, [facultyId], (err, results) => {
    if (err) {
      console.error('All Sessions CSV Export Error:', err);
      return res.status(500).json({ error: 'Database error during export' });
    }

    if (results.length === 0) {
      // If no data found, create a sample CSV with headers
      const sampleCSV = 'Student ID,Name,Email,Class/Subject,Status,Timestamp,Room,Session Date\n' +
                       'No data,No attendance records found for this faculty,,,,,,';
      
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="no_faculty_data_found.csv"');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      
      return res.send(sampleCSV);
    }

    try {
      const fields = [
        'Student ID',
        'Name',
        'Email',
        'Class/Subject',
        'Status',
        'Timestamp',
        'Room',
        'Session Date'
      ];

      const opts = { fields, delimiter: ',', header: true, encoding: 'utf8' };
      const parser = new Parser(opts);
      const csv = parser.parse(results);

      const sanitizedFacultyId = facultyId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const sanitizedDate = new Date().toISOString().slice(0, 10).replace(/[^0-9]/g, '');
      const filename = `all_attendance_faculty_${sanitizedFacultyId}_${sanitizedDate}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      res.send(csv);
      console.log(`📊 Secure All Sessions CSV Export completed: ${results.length} records exported for faculty ${facultyId}`);

    } catch (parseError) {
      console.error('All Sessions CSV Parse Error:', parseError);
      return res.status(500).json({ error: 'Failed to generate CSV file' });
    }
  });
});

// Token refresh endpoint - allows refreshing expired tokens
app.post('/api/refresh-token', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    // Verify token but ignore expiration to allow refresh of expired tokens
    const decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });

    // Generate new token with full expiration
    const newToken = jwt.sign({
      userId: decoded.userId,
      type: decoded.type
    }, JWT_SECRET, { expiresIn: '365d' });

    res.json({
      success: true,
      token: newToken,
      message: 'Token refreshed successfully'
    });
  } catch (e) {
    console.error('Token refresh verification error:', e);
    return res.status(403).json({ error: 'Invalid token' });
  }
});

// Student Profile API
app.get('/api/student/profile', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') {
    return res.status(403).json({ error: 'Student access required' });
  }

  const studentId = req.user.userId;

  db.get('SELECT student_id, name, email, created_at FROM students WHERE student_id = ?', [studentId], (err, student) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({
      success: true,
      profile: {
        studentId: student.student_id,
        name: student.name,
        email: student.email,
        joinedDate: student.created_at
      }
    });
  });
});

// Student Courses API
app.get('/api/student/courses', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') {
    return res.status(403).json({ error: 'Student access required' });
  }

  const studentId = req.user.userId;

  const query = `
    SELECT
      ss.subject,
      f.name as faculty_name,
      f.faculty_id,
      ss.created_at as assigned_date
    FROM student_subjects ss
    JOIN faculty f ON ss.faculty_id = f.faculty_id
    WHERE ss.student_id = ?
    ORDER BY ss.subject ASC
  `;

  db.all(query, [studentId], (err, courses) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.json({
      success: true,
      courses: courses || []
    });
  });
});

// Student Attendance History API
app.get('/api/student/attendance-history', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') {
    return res.status(403).json({ error: 'Student access required' });
  }

  const studentId = req.user.userId;

  const query = `
    SELECT
      a.session_id,
      s.subject,
      s.room,
      f.name as faculty_name,
      a.status,
      a.timestamp,
      s.created_at as session_date
    FROM attendance a
    JOIN sessions s ON a.session_id = s.session_id
    JOIN faculty f ON s.faculty_id = f.faculty_id
    WHERE a.student_id = ?
    ORDER BY a.timestamp DESC
  `;

  db.all(query, [studentId], (err, history) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    // Calculate attendance statistics
    const totalSessions = history.length;
    const presentCount = history.filter(h => h.status === 'present').length;
    const lateCount = history.filter(h => h.status === 'late').length;
    const attendanceRate = totalSessions > 0 ? Math.round(((presentCount + lateCount) / totalSessions) * 100) : 0;

    // Calculate current streak
    let currentStreak = 0;
    const sortedHistory = history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    for (const record of sortedHistory) {
      if (record.status === 'present' || record.status === 'late') {
        currentStreak++;
      } else {
        break;
      }
    }

    res.json({
      success: true,
      history: history || [],
      stats: {
        totalSessions,
        presentCount,
        lateCount,
        attendanceRate,
        currentStreak
      }
    });
  });
});


// Assign subjects to students (Faculty only)
app.post('/api/faculty/assign-subjects', authenticateToken, requireFaculty, (req, res) => {
  const { studentIds, subjects } = req.body;
  const facultyId = req.user.userId;

  if (!Array.isArray(studentIds) || !Array.isArray(subjects) || studentIds.length === 0 || subjects.length === 0) {
    return res.status(400).json({ error: 'studentIds and subjects arrays are required' });
  }

  let processed = 0;
  let errors = [];

  // For each student-subject combination
  studentIds.forEach(studentId => {
    subjects.forEach(subject => {
      db.run(
        'INSERT OR IGNORE INTO student_subjects (student_id, subject, faculty_id) VALUES (?, ?, ?)',
        [studentId, subject, facultyId],
        function (err) {
          if (err) {
            errors.push(`Failed to assign ${subject} to ${studentId}: ${err.message}`);
          }
          processed++;

          // Check if all assignments are done
          if (processed === studentIds.length * subjects.length) {
            res.json({
              success: true,
              message: `Assigned ${subjects.length} subjects to ${studentIds.length} students`,
              errors: errors.length > 0 ? errors : undefined
            });
          }
        }
      );
    });
  });
});

// Profile Photo Upload API
app.post('/api/student/upload-profile-photo', authenticateToken, imageUpload.single('profilePhoto'), (req, res) => {
  if (req.user.type !== 'student') {
    return res.status(403).json({ error: 'Student access required' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Profile photo is required' });
  }

  const studentId = req.user.userId;
  const photoPath = req.file.path;

  // Check if student already has a profile photo
  db.get('SELECT * FROM profile_photos WHERE student_id = ?', [studentId], (err, existing) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (existing) {
      // Update existing photo
      db.run(
        'UPDATE profile_photos SET photo_path = ?, uploaded_at = CURRENT_TIMESTAMP WHERE student_id = ?',
        [photoPath, studentId],
        function (err) {
          if (err) {
            console.error('Database update error:', err);
            return res.status(500).json({ error: 'Failed to update profile photo' });
          }

          res.json({
            success: true,
            message: 'Profile photo updated successfully',
            photoPath: photoPath,
            photoUrl: `/api/student/profile-photo/${studentId}`,
            studentId: studentId
          });
        }
      );
    } else {
      // Insert new photo
      db.run(
        'INSERT INTO profile_photos (student_id, photo_path) VALUES (?, ?)',
        [studentId, photoPath],
        function (err) {
          if (err) {
            console.error('Database insert error:', err);
            return res.status(500).json({ error: 'Failed to save profile photo' });
          }

          res.json({
            success: true,
            message: 'Profile photo uploaded successfully',
            photoPath: photoPath,
            photoUrl: `/api/student/profile-photo/${studentId}`,
            studentId: studentId
          });
        }
      );
    }
  });
});

// Get Profile Photo Info for authenticated user (returns JSON with photo URL)
app.get('/api/student/profile-photo', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') {
    return res.status(403).json({ error: 'Student access required' });
  }

  const studentId = req.user.userId;

  db.get('SELECT photo_path FROM profile_photos WHERE student_id = ?', [studentId], (err, photo) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!photo) {
      return res.json({ success: false, message: 'No profile photo uploaded' });
    }

    // Return JSON with photo URL
    res.json({
      success: true,
      photoUrl: `/api/student/profile-photo/${studentId}`,
      message: 'Profile photo found'
    });
  });
});

// Get Profile Photo File by student ID (returns actual image file)
app.get('/api/student/profile-photo/:studentId', (req, res) => {
  const { studentId } = req.params;

  db.get('SELECT photo_path FROM profile_photos WHERE student_id = ?', [studentId], (err, photo) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!photo) {
      return res.status(404).json({ error: 'Profile photo not found' });
    }

    // Send the photo file
    res.sendFile(path.resolve(photo.photo_path), (err) => {
      if (err) {
        console.error('File send error:', err);
        return res.status(500).json({ error: 'Failed to send profile photo' });
      }
    });
  });
});

// Face Comparison API
app.post('/api/student/compare-faces', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') {
    return res.status(403).json({ error: 'Student access required' });
  }

  const { livePhotoData } = req.body; // Base64 encoded image data
  const studentId = req.user.userId;

  if (!livePhotoData) {
    return res.status(400).json({ error: 'Live photo data is required' });
  }

  // Get student's profile photo
  db.get('SELECT photo_path, face_descriptor FROM profile_photos WHERE student_id = ?', [studentId], (err, profile) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!profile) {
      return res.status(404).json({ error: 'Profile photo not found. Please upload a profile photo first.' });
    }

    // For now, return a mock response since face-api.js server-side implementation
    // would require additional setup. In production, this would use face-api.js
    // to compare the live photo with the stored profile photo.
    res.json({
      success: true,
      match: true, // Mock: assume match for now
      confidence: 0.95, // Mock confidence score
      message: 'Face verification successful'
    });

    // TODO: Implement actual face comparison using face-api.js
    // This would involve:
    // 1. Loading face-api.js models on server
    // 2. Detecting faces in both images
    // 3. Computing face descriptors
    // 4. Comparing descriptors with a threshold
  });
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Helper to join a faculty-specific room safely
  function joinFacultyRoom(socket, facultyId, isAuthenticated) {
    // Sanitize facultyId to prevent room injection attacks
    const sanitizedFacultyId = facultyId.replace(/[^a-zA-Z0-9_-]/g, '');
    const roomName = `faculty_${sanitizedFacultyId}`;
    socket.join(roomName);
    console.log(`✅ Faculty ${sanitizedFacultyId} joined dashboard room: ${roomName} (Auth: ${isAuthenticated ? 'JWT' : 'Legacy'})`);
    // Confirm successful room join to client
    socket.emit('room_joined', {
      roomName,
      facultyId: sanitizedFacultyId,
      authenticated: isAuthenticated,
      message: 'Successfully joined real-time updates'
    });
  }

  // Helper to join a student-specific room safely
  function joinStudentRoom(socket, studentId, isAuthenticated) {
    // Sanitize studentId to prevent room injection attacks
    const sanitizedStudentId = studentId.replace(/[^a-zA-Z0-9_-]/g, '');
    const roomName = `student_${sanitizedStudentId}`;
    socket.join(roomName);
    console.log(`✅ Student ${sanitizedStudentId} joined dashboard room: ${roomName} (Auth: ${isAuthenticated ? 'JWT' : 'Legacy'})`);
    // Confirm successful room join to client
    socket.emit('room_joined', {
      roomName,
      studentId: sanitizedStudentId,
      authenticated: isAuthenticated,
      message: 'Successfully joined real-time updates'
    });
  }

  // 🔒 SECURITY: Enhanced room join with JWT authentication
  socket.on('join_faculty_dashboard', (data) => {
    const { facultyId, authToken } = data || {};

    // 🔒 PRODUCTION-GRADE: Verify JWT token for Socket.IO connections
    if (authToken) {
      jwt.verify(authToken, JWT_SECRET, (err, user) => {
        if (err) {
          console.error('Socket.IO JWT verification failed:', err);
          socket.emit('error', { message: 'Authentication failed' });
          return;
        }

        // If facultyId missing, derive from JWT
        const effectiveFacultyId = (typeof facultyId === 'string' && facultyId) ? facultyId : user.userId;

        // Verify the user is faculty and matches the requested/derived facultyId
        if (user.type !== 'faculty' || user.userId !== effectiveFacultyId) {
          console.error('Socket.IO authorization failed: User type or ID mismatch');
          socket.emit('error', { message: 'Authorization failed' });
          return;
        }

        // Join the room for this faculty
        joinFacultyRoom(socket, effectiveFacultyId, true);
      });
    } else {
      // Fallback for existing implementations without token (deprecated)
      if (!facultyId || typeof facultyId !== 'string') {
        console.error('Invalid facultyId provided for room join:', facultyId);
        socket.emit('error', { message: 'Invalid faculty ID' });
        return;
      }
      joinFacultyRoom(socket, facultyId, false);
    }
  });

  // 🔒 SECURITY: Student dashboard room join with JWT authentication
  socket.on('join_student_dashboard', (data) => {
    const { studentId, authToken } = data || {};

    // 🔒 PRODUCTION-GRADE: Verify JWT token for Socket.IO connections
    if (authToken) {
      jwt.verify(authToken, JWT_SECRET, (err, user) => {
        if (err) {
          console.error('Socket.IO JWT verification failed:', err);
          socket.emit('error', { message: 'Authentication failed' });
          return;
        }

        // If studentId missing, derive from JWT
        const effectiveStudentId = (typeof studentId === 'string' && studentId) ? studentId : user.userId;

        // Verify the user is student and matches the requested/derived studentId
        if (user.type !== 'student' || user.userId !== effectiveStudentId) {
          console.error('Socket.IO authorization failed: User type or ID mismatch');
          socket.emit('error', { message: 'Authorization failed' });
          return;
        }

        // Join the room for this student
        joinStudentRoom(socket, effectiveStudentId, true);
      });
    } else {
      // Fallback for existing implementations without token (deprecated)
      if (!studentId || typeof studentId !== 'string') {
        console.error('Invalid studentId provided for room join:', studentId);
        socket.emit('error', { message: 'Invalid student ID' });
        return;
      }
      joinStudentRoom(socket, studentId, false);
    }
  });

  // Handle faculty leaving dashboard
  socket.on('leave_faculty_dashboard', (facultyId) => {
    if (facultyId) {
      const sanitizedFacultyId = facultyId.replace(/[^a-zA-Z0-9_-]/g, '');
      const roomName = `faculty_${sanitizedFacultyId}`;
      socket.leave(roomName);
      console.log(`Faculty ${sanitizedFacultyId} left dashboard room: ${roomName}`);
    }
  });

  // Handle student leaving dashboard
  socket.on('leave_student_dashboard', (studentId) => {
    if (studentId) {
      const sanitizedStudentId = studentId.replace(/[^a-zA-Z0-9_-]/g, '');
      const roomName = `student_${sanitizedStudentId}`;
      socket.leave(roomName);
      console.log(`Student ${sanitizedStudentId} left dashboard room: ${roomName}`);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Serve check-in success page
app.get('/checkin-success/:sessionId/:studentId', (req, res) => {
  const { sessionId, studentId } = req.params;

  // Get attendance details
  const query = `
    SELECT 
      a.*,
      s.name as student_name,
      sess.subject
    FROM attendance a
    JOIN students s ON a.student_id = s.student_id
    JOIN sessions sess ON a.session_id = sess.session_id
    WHERE a.session_id = ? AND a.student_id = ?
  `;

  db.get(query, [sessionId, studentId], (err, attendance) => {
    if (err || !attendance) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Check-in Error</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <link href="css/style.css" rel="stylesheet">
        </head>
        <body>
          <div class="checkin-container error">
            <h1>❌ Check-in Error</h1>
            <p>Attendance record not found.</p>
            <a href="/student-dashboard.html" class="btn btn-primary">Back to Dashboard</a>
          </div>
        </body>
        </html>
      `);
    }

    const statusIcon = attendance.status === 'present' ? '✅' : '⏰';
    const statusText = attendance.status === 'present' ? 'Present' : 'Late';
    const statusClass = attendance.status;

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Check-in Success - AttendIQ</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="/css/style.css" rel="stylesheet">
        <style>
          .checkin-container {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, var(--dark-bg) 0%, #1e293b 50%, var(--dark-bg) 100%);
            padding: 2rem;
            text-align: center;
          }
          .success-card {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 1rem;
            padding: 2rem;
            max-width: 500px;
            border: 1px solid rgba(255, 255, 255, 0.2);
          }
          .success-icon {
            font-size: 4rem;
            margin-bottom: 1rem;
          }
          .success-title {
            color: #22c55e;
            font-size: 2rem;
            margin-bottom: 1rem;
          }
          .attendance-details {
            background: rgba(0, 0, 0, 0.2);
            border-radius: 0.5rem;
            padding: 1.5rem;
            margin: 1.5rem 0;
          }
          .detail-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 0.5rem;
            padding: 0.25rem 0;
          }
          .detail-label {
            font-weight: 600;
            opacity: 0.8;
          }
          .detail-value {
            color: var(--light-text);
          }
          .status-badge.present {
            background-color: rgba(34, 197, 94, 0.2);
            color: #22c55e;
            padding: 0.25rem 0.75rem;
            border-radius: 1rem;
            font-size: 0.9rem;
            font-weight: 600;
          }
          .status-badge.late {
            background-color: rgba(249, 115, 22, 0.2);
            color: #f97316;
            padding: 0.25rem 0.75rem;
            border-radius: 1rem;
            font-size: 0.9rem;
            font-weight: 600;
          }
          .btn-home {
            margin-top: 1.5rem;
            background: var(--gradient-primary);
            border: none;
            color: white;
            padding: 0.75rem 1.5rem;
            border-radius: 0.5rem;
            text-decoration: none;
            display: inline-block;
            transition: transform 0.2s;
          }
          .btn-home:hover {
            transform: translateY(-2px);
          }
        </style>
      </head>
      <body>
        <div class="checkin-container">
          <div class="success-card">
            <div class="success-icon">${statusIcon}</div>
            <h1 class="success-title">Check-in Successful!</h1>
            
            <div class="attendance-details">
              <div class="detail-row">
                <span class="detail-label">Student:</span>
                <span class="detail-value">${attendance.student_name}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Subject:</span>
                <span class="detail-value">${attendance.subject}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Status:</span>
                <span class="status-badge ${statusClass}">${statusText}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Time:</span>
                <span class="detail-value">${new Date(attendance.timestamp).toLocaleString()}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Session ID:</span>
                <span class="detail-value">${sessionId.slice(0, 8)}...</span>
              </div>
            </div>

            <p style="opacity: 0.8; margin-bottom: 1rem;">
              Your attendance has been recorded successfully. 
              ${attendance.status === 'present' ? "You're on time!":"You're marked as late."}
            </p >

    <a href="/student-dashboard.html" class="btn-home">
      Back to Dashboard
    </a>
          </div >
        </div >
      </body >
      </html >
    `);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Twilio WhatsApp Notification System
const twilioClient = twilio(
  process.env.TWILIO_SID || 'AC_YOUR_TWILIO_SID',
  process.env.TWILIO_TOKEN || 'YOUR_TWILIO_TOKEN'
);

async function sendWhatsAppNotification(phoneNumber, message) {
  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: 'whatsapp:+14155238886', // Twilio sandbox number
      to: `whatsapp:+91${phoneNumber}`
    });
    
    console.log(`📱 WhatsApp sent to ${phoneNumber}: ${message}`);
    console.log(`✅ Message SID: ${result.sid}`);
    return true;
  } catch (error) {
    console.error('❌ Twilio WhatsApp failed:', error.message);
    
    // Fallback to WhatsApp web link
    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/91${phoneNumber}?text=${encodedMessage}`;
    console.log(`🔗 Fallback WhatsApp Link: ${whatsappUrl}`);
    return false;
  }
}

// Enhanced absence check for specific session
function checkAbsentStudents(sessionId) {
  console.log(`🔍 Checking absent students for session: ${sessionId}`);
  
  // Get session details
  db.get('SELECT * FROM sessions WHERE session_id = ?', [sessionId], (err, session) => {
    if (err || !session) {
      console.error('Session not found:', sessionId);
      return;
    }
    
    console.log(`📚 Session found: ${session.subject} by faculty ${session.faculty_id}`);
    
    // Find all students enrolled in this subject who didn't attend
    db.all(`
      SELECT s.name, s.phone, s.student_id, s.email
      FROM students s
      JOIN student_subjects ss ON s.student_id = ss.student_id
      LEFT JOIN attendance a ON s.student_id = a.student_id AND a.session_id = ?
      WHERE ss.subject = ? AND ss.faculty_id = ?
      AND a.student_id IS NULL
    `, [sessionId, session.subject, session.faculty_id], async (err, absentStudents) => {
      if (err) {
        console.error('Error finding absent students:', err);
        return;
      }
      
      console.log(`📊 Found ${absentStudents.length} absent students:`);
      absentStudents.forEach(s => console.log(`- ${s.name} (${s.email}) - Phone: ${s.phone || 'No phone'}`));
      
      // Send notifications to all absent students
      for (const student of absentStudents) {
        if (student.phone) {
          const message = `⚠️ Hi ${student.name}, you missed the ${session.subject} session. Please attend the next class!`;
          try {
            const result = await sendWhatsAppNotification(student.phone, message);
            console.log(`📨 WhatsApp sent to ${student.name} (${student.phone}): ${result ? 'Success' : 'Failed'}`);
          } catch (error) {
            console.error(`❌ WhatsApp failed for ${student.name}:`, error.message);
          }
        } else {
          console.log(`⚠️ No phone number for ${student.name}`);
        }
      }
    });
  });
}

// Create default test users on startup
function createDefaultUsers() {
  console.log('\n🔧 Creating default test users...');


  // Create test faculty user
  const facultyPassword = bcrypt.hashSync('password123', 10);
  db.run(
    'INSERT OR IGNORE INTO faculty (faculty_id, name, email, password_hash) VALUES (?, ?, ?, ?)',
    ['faculty001', 'Dr. John Smith', 'faculty@test.com', facultyPassword],
    function (err) {
      if (err) {
        console.log('Faculty user creation error:', err.message);
      } else if (this.changes > 0) {
        console.log('✅ Default faculty user created: faculty@test.com / password123');
      } else {
        console.log('ℹ️  Faculty user already exists: faculty@test.com');
      }
    }
  );

  // Create test student users - FANG level students
  const studentPassword = bcrypt.hashSync('student123', 10);
  const testStudents = [
    ['STU001', 'Alice Johnson', 'alice@test.com'],
    ['STU002', 'Smith Kumar', 'smith@test.com'],
    ['STU003', 'Krishnaraj Patel', 'krishnaraj@test.com'],
    ['STU004', 'Pratik Sharma', 'pratik@test.com'],
    ['STU005', 'Bob Wilson', 'bob@test.com'],
    ['STU006', 'Carol Davis', 'carol@test.com'],
    ['STU007', 'David Brown', 'david@test.com'],
    ['STU008', 'Eva Singh', 'eva@test.com']
  ];

  testStudents.forEach(([studentId, name, email]) => {
    db.run(
      'INSERT OR IGNORE INTO students (student_id, name, email, password_hash) VALUES (?, ?, ?, ?)',
      [studentId, name, email, studentPassword],
      function (err) {
        if (err) {
          console.log(`Student creation error for ${ email }: `, err.message);
        } else if (this.changes > 0) {
          console.log(`✅ Default student created: ${ email } / student123`);
        }
      }
    );
  });

// Assign default subjects to students
setTimeout(() => {
  const defaultSubjects = ['Computer Science 101', 'Mathematics 201', 'Physics 301', 'Chemistry 101', 'Biology 201'];

  testStudents.forEach(([studentId, name, email]) => {
    // Assign 2-3 random subjects to each student
    const assignedSubjects = defaultSubjects.sort(() => 0.5 - Math.random()).slice(0, Math.floor(Math.random() * 2) + 2);

    assignedSubjects.forEach(subject => {
      db.run(
        'INSERT OR IGNORE INTO student_subjects (student_id, subject, faculty_id) VALUES (?, ?, ?)',
        [studentId, subject, 'faculty001'],
        function (err) {
          if (err) {
            console.log(`Subject assignment error for ${studentId}:`, err.message);
          }
        }
      );
    });
  });

  console.log('✅ Default subjects assigned to students');
}, 500);

setTimeout(() => {
  console.log('\n🎯 LOGIN CREDENTIALS:');
  console.log('👨‍🏫 Faculty: faculty@test.com / password123');
  console.log('👩‍🎓 Student: alice@test.com / student123 (or bob@test.com, carol@test.com, etc.)');
  console.log('📚 Ready to generate QR codes and track attendance!\n');
}, 1000);
}



// Test WhatsApp notification endpoint
app.post('/api/test-whatsapp', (req, res) => {
  const { phone, message } = req.body;
  
  if (!phone || !message) {
    return res.status(400).json({ error: 'Phone and message required' });
  }
  
  sendWhatsAppNotification(phone, message);
  res.json({ success: true, message: 'WhatsApp notification sent' });
});

// Manual absence check (no auth required for testing)
app.get('/api/manual-check-absences', (req, res) => {
  console.log('🔍 Manual absence check triggered...');
  // Get latest session and check absences
  db.get('SELECT session_id FROM sessions ORDER BY created_at DESC LIMIT 1', [], (err, session) => {
    if (session) {
      checkAbsentStudents(session.session_id);
    }
  });
  res.json({ success: true, message: 'Absence check triggered manually' });
});

// Force test notification to Krishnaraj
app.get('/api/test-krishnaraj', async (req, res) => {
  console.log('📨 Sending test notification to Krishnaraj...');
  const message = '⚠️ Hi Krishnaraj, this is a test notification from AttendIQ! You missed Computer Science class.';
  const result = await sendWhatsAppNotification('9699588803', message);
  res.json({ 
    success: true, 
    message: 'Test notification sent to Krishnaraj',
    twilioResult: result
  });
});

// Test WhatsApp for any student
app.post('/api/test-whatsapp-student', async (req, res) => {
  const { studentId } = req.body;
  
  if (!studentId) {
    return res.status(400).json({ error: 'Student ID required' });
  }
  
  // Get student details
  db.get('SELECT name, phone FROM students WHERE student_id = ?', [studentId], async (err, student) => {
    if (err || !student) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    if (!student.phone) {
      return res.status(400).json({ error: 'No phone number for student' });
    }
    
    const message = `⚠️ Hi ${student.name}, this is a test WhatsApp notification from AttendIQ!`;
    const result = await sendWhatsAppNotification(student.phone, message);
    
    res.json({
      success: true,
      message: `Test notification sent to ${student.name}`,
      phone: student.phone,
      twilioResult: result
    });
  });
});

// Leave Management APIs

// Submit leave request (Student) with AI Analysis
app.post('/api/student/leave-request', authenticateToken, async (req, res) => {
  if (req.user.type !== 'student') {
    return res.status(403).json({ error: 'Student access required' });
  }

  const { facultyId, subject, leaveDate, reasonCategory, reasonText } = req.body;
  const studentId = req.user.userId;

  if (!facultyId || !subject || !leaveDate || !reasonCategory || !reasonText) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    // Get student's leave history for AI analysis
    const studentHistory = await new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM leave_requests WHERE student_id = ? ORDER BY created_at DESC',
        [studentId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // Prepare request data for AI analysis
    const requestData = {
      studentId,
      facultyId,
      subject,
      leaveDate,
      reasonCategory,
      reasonText
    };

    // Run AI analysis
    const aiAnalysis = await aiAnalyzer.analyzeLeaveRequest(requestData, studentHistory);
    
    console.log(`🤖 AI Analysis for ${studentId}: Score ${aiAnalysis.credibilityScore}, Risk ${aiAnalysis.riskLevel}`);

    // Insert leave request with AI analysis
    db.run(
      'INSERT INTO leave_requests (student_id, faculty_id, subject, leave_date, reason_category, reason_text, ai_score, ai_recommendation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [studentId, facultyId, subject, leaveDate, reasonCategory, reasonText, aiAnalysis.credibilityScore, JSON.stringify(aiAnalysis)],
      function(err) {
        if (err) {
          console.error('Leave request error:', err);
          return res.status(500).json({ error: 'Failed to submit leave request' });
        }

        res.json({
          success: true,
          message: 'Leave request submitted successfully',
          requestId: this.lastID,
          aiAnalysis: {
            credibilityScore: aiAnalysis.credibilityScore,
            riskLevel: aiAnalysis.riskLevel,
            flags: aiAnalysis.flags.filter(f => f.type === 'info')
          }
        });
      }
    );
  } catch (error) {
    console.error('AI analysis error:', error);
    // Fallback: submit without AI analysis
    db.run(
      'INSERT INTO leave_requests (student_id, faculty_id, subject, leave_date, reason_category, reason_text) VALUES (?, ?, ?, ?, ?, ?)',
      [studentId, facultyId, subject, leaveDate, reasonCategory, reasonText],
      function(err) {
        if (err) {
          console.error('Leave request error:', err);
          return res.status(500).json({ error: 'Failed to submit leave request' });
        }

        res.json({
          success: true,
          message: 'Leave request submitted successfully (AI analysis unavailable)',
          requestId: this.lastID
        });
      }
    );
  }
});

// Get leave requests for faculty
app.get('/api/faculty/leave-requests', authenticateToken, requireFaculty, (req, res) => {
  const facultyId = req.user.userId;

  const query = `
    SELECT 
      lr.*,
      s.name as student_name,
      s.email as student_email
    FROM leave_requests lr
    JOIN students s ON lr.student_id = s.student_id
    WHERE lr.faculty_id = ?
    ORDER BY lr.created_at DESC
  `;

  db.all(query, [facultyId], (err, requests) => {
    if (err) {
      console.error('Get leave requests error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.json({
      success: true,
      requests: requests || []
    });
  });
});

// Update leave request status (Faculty)
app.put('/api/faculty/leave-request/:id', authenticateToken, requireFaculty, (req, res) => {
  const { id } = req.params;
  const { status, comments } = req.body;
  const facultyId = req.user.userId;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  db.run(
    'UPDATE leave_requests SET status = ?, faculty_comments = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND faculty_id = ?',
    [status, comments || '', id, facultyId],
    function(err) {
      if (err) {
        console.error('Update leave request error:', err);
        return res.status(500).json({ error: 'Failed to update leave request' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Leave request not found' });
      }

      res.json({
        success: true,
        message: `Leave request ${status} successfully`
      });
    }
  );
});

// Get student's leave requests
app.get('/api/student/leave-requests', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') {
    return res.status(403).json({ error: 'Student access required' });
  }

  const studentId = req.user.userId;

  const query = `
    SELECT 
      lr.*,
      f.name as faculty_name
    FROM leave_requests lr
    JOIN faculty f ON lr.faculty_id = f.faculty_id
    WHERE lr.student_id = ?
    ORDER BY lr.created_at DESC
  `;

  db.all(query, [studentId], (err, requests) => {
    if (err) {
      console.error('Get student leave requests error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.json({
      success: true,
      requests: requests || []
    });
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  // Enhanced environment detection for VS Code + Replit compatibility
  const isReplit = !!process.env.REPLIT_DEV_DOMAIN;
  const isLocal = !isReplit;

  let domain, protocol;
  if (isReplit) {
    domain = process.env.REPLIT_DEV_DOMAIN;
    protocol = 'https';
  } else {
    // Local development - works with VS Code Live Server and local fetch
    domain = `localhost:${PORT}`;
    protocol = 'http';
  }

  console.log(`✅ AttendIQ Server running on port ${PORT}`);
  console.log(`🌐 Environment: ${isReplit ? 'Replit Cloud ☁️' : 'Local Development 💻'}`);
  console.log(`📱 Mobile access: ${protocol}://${domain}`);
  console.log(`📊 Faculty Dashboard: ${protocol}://${domain}/faculty-dashboard.html`);
  console.log(`🎓 Student Dashboard: ${protocol}://${domain}/student-dashboard.html`);

  if (isLocal) {
    console.log(`\n🔧 VS Code Local Setup:`);
    console.log(`1. Run "npm start" to start this backend server (port ${PORT})`);
    console.log(`2. Use Live Server extension for frontend (port 5500)`);
    console.log(`3. Camera scanner works perfectly on localhost!`);
    console.log(`4. For mobile testing, use your computer's IP: http://[YOUR-IP]:${PORT}`);
  }

  console.log('\n🔑 Test Credentials:');
  console.log('Faculty: faculty@test.com / password123');
  console.log('Students: alice@test.com / student123\n');

  // Create default users after server starts
  setTimeout(() => {
    createDefaultUsers();
    
    // Add phone numbers to students
    setTimeout(() => {
      const studentPhones = [
        ['alice@test.com', '9876543210'],
        ['smith@test.com', '9876543211'], 
        ['krishnaraj@test.com', '9699588803'], // Your actual number
        ['pratik@test.com', '9876543213'],
        ['bob@test.com', '9876543214'],
        ['carol@test.com', '9876543215'],
        ['david@test.com', '9876543216'],
        ['eva@test.com', '9876543217']
      ];

      // Add phone column if not exists
      db.run(`ALTER TABLE students ADD COLUMN phone TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.log('Phone column already exists or error:', err.message);
        }
        
        // Update phone numbers
        studentPhones.forEach(([email, phone]) => {
          db.run(`UPDATE students SET phone = ? WHERE email = ?`, [phone, email], (updateErr) => {
            if (!updateErr) {
              console.log(`📱 Phone ${phone} added for ${email}`);
            }
          });
        });
      });
      
      console.log('📱 WhatsApp notifications enabled for consecutive absences!');
      
      // Force enroll Krishnaraj in ALL subjects
      const allSubjects = ['Computer Science 101', 'Mathematics 201', 'Physics 301', 'Chemistry 101', 'Biology 201'];
      allSubjects.forEach(subject => {
        db.run(
          'INSERT OR IGNORE INTO student_subjects (student_id, subject, faculty_id) VALUES (?, ?, ?)',
          ['STU003', subject, 'faculty001'],
          function(err) {
            if (!err && this.changes > 0) {
              console.log(`📚 Krishnaraj enrolled in ${subject}`);
            }
          }
        );
      });
    }, 2000);
  }, 1000);
  

});
