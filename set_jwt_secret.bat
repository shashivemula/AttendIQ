@echo off
REM This script sets the JWT_SECRET environment variable and restarts the server

set JWT_SECRET=fd3bcbcd97da020b608eb732fa5ea58216b497ea617eb0ecef32ae3a842d9bd2ebdc256736eb3f8288ae2946e17276a2a1069734f23e3d43c1a435acbee57084

REM Kill any process using port 5000
npx kill-port 5000 --yes

REM Start the server with the new environment variable
npm run dev
