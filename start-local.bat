@echo off
echo Starting AttendIQ Server in Development Mode...
set NODE_ENV=development
set PORT=5000
set JWT_SECRET=your-strong-secret-key-here
set ALLOWED_ORIGINS=http://localhost:5500,http://127.0.0.1:5500

node server.js
