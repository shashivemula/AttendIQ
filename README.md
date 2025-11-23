# AttendIQ - Smart Attendance Management System

## Features
- QR Code based attendance
- Face verification
- Real-time updates
- Location tracking
- CSV export
- Mobile responsive

## Quick Start

### Local Development
```bash
npm install
npm start
```
Visit: http://localhost:5000

### Production Deployment

#### 1. Vercel (Recommended)
```bash
npm install -g vercel
vercel --prod
```

#### 2. Heroku
```bash
git init
heroku create your-app-name
git add .
git commit -m "Initial commit"
git push heroku main
```

#### 3. Railway
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

#### 4. Docker
```bash
docker build -t attendiq .
docker run -p 5000:5000 attendiq
```

## Environment Variables
Copy `.env.example` to `.env` and update:
- `JWT_SECRET`: Generate with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
- `ALLOWED_ORIGINS`: Your production domain

## Default Credentials
- Faculty: faculty@test.com / password123
- Student: alice@test.com / student123