# 🚀 AttendIQ Render Deployment Guide

## Quick Deploy (5 Minutes)

Your code is **ready to deploy** on Render with both frontend & backend working!

### Step 1: Sign Up on Render
1. Go to: https://render.com
2. Click **"Get Started for Free"**
3. Sign up with your **GitHub account**

### Step 2: Deploy AttendIQ
1. After signing in, click **"New +"** → **"Web Service"**
2. Click **"Connect GitHub"** and authorize Render
3. Find and select: **Krishnaraj-06/AttendIQ**
4. Click **"Connect"**

### Step 3: Configure (Auto-filled from render.yaml)
Render will automatically detect `render.yaml` and configure:
- ✅ **Name:** attendiq
- ✅ **Build Command:** `npm install`
- ✅ **Start Command:** `npm start`
- ✅ **Environment:** Node
- ✅ **Plan:** Free

Just click **"Create Web Service"**

### Step 4: Wait for Deployment (3-5 minutes)
- Render will install dependencies and start your app
- You'll see build logs in real-time
- Once done, you'll get a live URL like: `https://attendiq.onrender.com`

### Step 5: Access Your App
```
🌐 Live URL: https://attendiq-XXXX.onrender.com
📊 Faculty Dashboard: https://attendiq-XXXX.onrender.com/faculty-dashboard.html
👨‍🎓 Student Portal: https://attendiq-XXXX.onrender.com/student-dashboard.html
```

## ✅ What Works on Render

- ✅ **Login/Authentication** (Faculty & Students)
- ✅ **QR Code Generation** (Real-time attendance)
- ✅ **Face Recognition** (Registration & Verification)
- ✅ **Attendance Tracking** (All features)
- ✅ **Socket.io** (Real-time updates)
- ✅ **Database** (SQLite with persistent disk)
- ✅ **File Uploads** (Face images, exports)
- ✅ **Both Frontend & Backend** (Full-stack working)

## 📱 Mobile Access

Once deployed, you can access AttendIQ from **any device**:
- Use the Render URL on phones/tablets
- No local server needed
- Works globally with internet connection

## 🔑 Default Test Credentials

**Faculty Login:**
- Username: `admin` or `faculty1`
- Password: Check your database or create new account

**Student Login:**
- Roll Number: As registered in system
- Password: Set during registration

## ⚡ Free Tier Limits

- **Sleep after 15 min** of inactivity (first request takes ~30 sec to wake)
- **750 hours/month** (enough for testing/demos)
- **1 GB disk** for database
- To keep always active: Upgrade to paid plan ($7/month)

## 🔧 Post-Deployment Setup

### Set JWT Secret (Optional - Auto-generated)
Render automatically generates a secure JWT_SECRET. To customize:
1. Go to your service → **Environment**
2. Find `JWT_SECRET`
3. Edit if needed

### Check Logs
Click **"Logs"** tab to see:
- Server startup messages
- API requests
- Errors (if any)

### Custom Domain (Optional)
1. Go to **Settings** → **Custom Domain**
2. Add your domain (e.g., `attendiq.yourdomain.com`)
3. Update DNS records as shown

## 🐛 Troubleshooting

### App Not Loading?
- Check **Logs** for errors
- Verify build completed successfully
- First request after sleep takes 30 seconds

### Database Issues?
- Render uses persistent disk (survives restarts)
- Database file: `attendiq.db`
- Located at: `/opt/render/project/src/`

### Environment Variables Missing?
- Check **Environment** tab
- Ensure `NODE_ENV=production`
- `JWT_SECRET` should be auto-generated

## 📊 Monitor Your App

- **Dashboard:** View metrics, logs, deploys
- **Events:** See all deployment history
- **Metrics:** CPU, Memory, Request stats

## 🔄 Auto-Deploy

Every time you push to GitHub `master` branch:
1. Render detects the change
2. Automatically rebuilds and deploys
3. New version goes live in ~3-5 minutes

To disable: Settings → Auto-Deploy → Toggle off

## 🎉 You're Live!

Once deployed, share your AttendIQ URL with:
- Faculty members
- Students
- Administrators

Everyone can access from anywhere!

---

**Need Help?** 
- Render Docs: https://render.com/docs
- Render Community: https://community.render.com
