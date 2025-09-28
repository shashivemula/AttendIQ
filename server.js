require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql2/promise');
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

const app = express();
const server = http.createServer(app);
// Configure environment
const isProduction = process.env.NODE_ENV === 'production';
const isReplit = !!process.env.REPLIT_DB_URL;

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
      /^https?:\/\/localhost(:\d+)?$/,  // localhost with any port
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/,  // 127.0.0.1 with any port
      /^https?:\/\/192\.168\.0\.105(:\d+)?$/,  // Your local IP with any port

      // Replit environment
      isReplit && process.env.REPLIT_DEV_DOMAIN
        ? new RegExp(`^https?:\/\/${process.env.REPLIT_DEV_DOMAIN.replace(/\./g, '\\\\.')}$`)
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
  maxAge: 600, // Cache preflight request for 10 minutes
  optionsSuccessStatus: 204 // Return 204 No Content for preflight requests
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
    origin: function (origin, callback) {
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

// Apply CORS middleware
app.use(cors(corsOptions));
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

// Serve HTML files individually for better control
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/faculty-dashboard.html', (req, res) => res.sendFile(path.join(__dirname, 'faculty-dashboard.html')));
app.get('/student-dashboard.html', (req, res) => res.sendFile(path.join(__dirname, 'student-dashboard.html')));
app.get('/student-checkin.html', (req, res) => res.sendFile(path.join(__dirname, 'student-checkin.html')));
app.get('/checkin.html', (req, res) => res.sendFile(path.join(__dirname, 'checkin.html')));

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
    const requiredColumns = ['latitude', 'longitude', 'radius_meters', 'geo_required'];
    const missingColumns = requiredColumns.filter(col => !columnNames.includes(col));

    if (missingColumns.length > 0) {
      console.log(`🚧 Adding missing columns to sessions table: ${missingColumns.join(', ')}`);

      // Add missing columns one by one
      const alterQueries = [
        'ALTER TABLE sessions ADD COLUMN latitude REAL',
        'ALTER TABLE sessions ADD COLUMN longitude REAL',
        'ALTER TABLE sessions ADD COLUMN radius_meters INTEGER DEFAULT 100',
        'ALTER TABLE sessions ADD COLUMN geo_required BOOLEAN DEFAULT 1'
      ];

      missingColumns.forEach((col, index) => {
        db.run(alterQueries[requiredColumns.indexOf(col)], (err) => {
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

  db.run(sessionsTable, (err) => {
    if (err) console.error('Error creating sessions table:', err);
  });

  db.run(attendanceTable, (err) => {
    if (err) console.error('Error creating attendance table:', err);
    else console.log('Database tables created successfully');
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
      }, JWT_SECRET, { expiresIn: '24h' });

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

      // Create a consistent token payload using the 'faculty' object
      const token = jwt.sign(
        {
          userId: faculty.faculty_id, // Use faculty's unique ID
          type: 'faculty'             // Specify the user type
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

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
      } else if (process.env.NODE_ENV === 'development') {
        // For local development - use computer's IP for mobile access
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
      } else {
        // For production
        checkinUrl = `${req.protocol}://${req.get('host')}/checkin.html?session=${sessionId}&subject=${encodeURIComponent(subject)}&room=${encodeURIComponent(room || 'Classroom')}`;
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

        console.log(`✅ QR Code generated: ${subject} - ${sessionId.slice(0, 8)}... (expires in 2 minutes)`);
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

    // Generate new expiration time (extend by 2 minutes from now)
    const newExpiresAt = new Date(now.getTime() + 2 * 60 * 1000);
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
        } else if (process.env.NODE_ENV === 'development') {
          // For local development - use computer's IP for mobile access
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
        } else {
          checkinUrl = `${req.protocol}://${req.get('host')}/checkin.html?session=${sessionId}&subject=${encodeURIComponent(session.subject)}&room=${encodeURIComponent(session.room || 'Classroom')}`;
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
  const { sessionId, location } = req.body;
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
    return res.status(400).json({ error: 'QR code has expired (2 minutes limit)' });
  }

  // Validate geolocation if required (with development bypass and corrected radius/coords)
  if (session.geoRequired) {
    const devBypassGeo = !isProduction && process.env.DEV_GEOFENCE_OPTIONAL !== '0';

    if (devBypassGeo) {
      console.warn('⚠️  Development mode: bypassing geofence validation (set DEV_GEOFENCE_OPTIONAL=0 to enforce).');
    } else {
      if (!location || !location.latitude || !location.longitude) {
        return res.status(400).json({
          error: 'Location access is required for this session. Please enable location services and try again.'
        });
      }

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
    }
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
        }
      );
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
        return res.status(404).json({ error: 'No attendance data found for this session' });
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

  // 🔒 SECURITY FIX: Only export students who actually attended this faculty's sessions
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
      return res.status(404).json({ error: 'No attendance data found for this faculty' });
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

      const opts = {
        fields,
        delimiter: ',',
        header: true,
        encoding: 'utf8'
      };

      const parser = new Parser(opts);
      const csv = parser.parse(results);

      // 🔒 SECURITY: Sanitize filename to prevent directory traversal
      const sanitizedFacultyId = facultyId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const sanitizedDate = new Date().toISOString().slice(0, 10).replace(/[^0-9]/g, '');
      const filename = `all_attendance_faculty_${sanitizedFacultyId}_${sanitizedDate}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      res.send(csv);

      console.log(`📊 Secure All Sessions CSV Export completed: ${results.length} records exported for faculty ${facultyId} by authenticated user ${req.user.userId}`);

    } catch (parseError) {
      console.error('All Sessions CSV Parse Error:', parseError);
      return res.status(500).json({ error: 'Failed to generate CSV file' });
    }
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

  // Handle faculty leaving dashboard
  socket.on('leave_faculty_dashboard', (facultyId) => {
    if (facultyId) {
      const sanitizedFacultyId = facultyId.replace(/[^a-zA-Z0-9_-]/g, '');
      const roomName = `faculty_${sanitizedFacultyId}`;
      socket.leave(roomName);
      console.log(`Faculty ${sanitizedFacultyId} left dashboard room: ${roomName}`);
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
              ${attendance.status === 'present' ? 'You\'re on time!' : 'You\'re marked as late.'}
            </p>

            <a href="/student-dashboard.html" class="btn-home">
              Back to Dashboard
            </a>
          </div>
        </div>
      </body>
      </html>
    `);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

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
          console.log(`Student creation error for ${email}:`, err.message);
        } else if (this.changes > 0) {
          console.log(`✅ Default student created: ${email} / student123`);
        }
      }
    );
  });

  setTimeout(() => {
    console.log('\n🎯 LOGIN CREDENTIALS:');
    console.log('👨‍🏫 Faculty: faculty@test.com / password123');
    console.log('👩‍🎓 Student: alice@test.com / student123 (or bob@test.com, carol@test.com, etc.)');
    console.log('📚 Ready to generate QR codes and track attendance!\n');
  }, 1000);
}

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
  setTimeout(createDefaultUsers, 1000);
});
