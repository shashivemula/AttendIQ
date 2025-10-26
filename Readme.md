import pypandoc

# Markdown content for the README file
readme_content = """
# 🧠 AttendIQ – Smart QR-Based Attendance System
**A modern attendance solution combining QR verification, face recognition, and geolocation authentication.**

---

## 🚀 Overview
AttendIQ is a web-based smart attendance management system designed to prevent proxy attendance and ensure real-time, location-locked verification.
Built using **HTML, CSS, JavaScript, Node.js, Express, SQLite**, and integrated with **Face API** for face recognition.

---

## 💡 Key Features
- ✅ **Face Verification:** Uses Face API CDN models to register and verify student faces (stored in byte format for efficiency).
- 🕹️ **QR Code Authentication:** Each lecture session generates a unique QR for students to scan and mark presence.
- 🌍 **GeoLock Verification:** Ensures attendance is only marked from allowed campus coordinates.
- ⚡ **Real-Time Validation:** Verifies identity in under 15 seconds.
- 🧩 **Lightweight Architecture:** Optimized for performance and minimal server load.

---

## 🏗️ Tech Stack
| Component | Technology |
|------------|-------------|
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js, Express |
| Database | SQLite |
| APIs/Models | Face API (CDN-based) |
| Others | QR.js, GeoLocation API |

---

## 🧬 Workflow
1. **Registration Phase:**
   - Students register and upload their profile photo (converted and stored as byte data).
2. **Lecture Phase:**
   - Faculty generates a QR code for the session.
   - Students scan the QR → camera opens → face verified → attendance marked.
3. **Verification:**
   - Face API matches the live capture with stored data.
   - If verified + geolocation matched → marked as **Present**.

---

## 📦 Installation
```bash
# Clone the repository
git clone https://github.com/Krishnaraj-06/AttendIQ.git

# Navigate into project
cd AttendIQ

# Install dependencies
npm install

# Run the app
npm start
