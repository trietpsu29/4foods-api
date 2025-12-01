# 4Foods API

API for Android app 4Foods with Swagger docs, Dockerized deployment, and Socket.IO.

## Features
- RESTful API with JWT auth
- Swagger UI with basic auth
- MongoDB persistence
- Socket.IO for chat
- Docker Compose deployment

## Requirements
- MongoDB (Docker service included)
- Node.js 18+ (if running locally without Docker)
- Docker & Docker Compose (for reproducible deployments)
- Public VPS or Cloud instance if you want external access

## Environment Variables
Create `.env` from the template and update values:
```bash
cp .env.example .env
# Edit .env with your secrets and credentials
```
Important keys:
- MONGO_URI: e.g. mongodb://mongo:27017/4foods
- JWT_SECRET: random string
- EMAIL_USER/EMAIL_PASS: for mailer
- CLOUDINARY_*: for image uploads
- SWAGGER_USER/SWAGGER_PASS: basic auth for Swagger UI
- GOOGLE_CLIENT_ID: OAuth client id

Adjust API Docs host and scheme inside `swagger_output.json`:
- host: your_public_ip or domain
- schemes: ["https"] (recommended) or ["http"]

## Reproducibility: Run on three OS (Windows, Linux, macOS)

### A. Windows (PowerShell)
```powershell
# 1) Install Docker Desktop (includes docker compose)
#    Download & install from https://www.docker.com/products/docker-desktop
#    Ensure "Use WSL 2 based engine" is enabled

# 2) Clone repository
git clone https://github.com/trietpsu29/4foods-api
cd 4foods-api

# 3) Prepare environment
Copy-Item .env.example .env
# Open .env in editor and fill secrets

# 4) Build & run
docker compose up -d --build

# 5) Open firewall (Windows Defender Firewall)
# Control Panel -> System and Security -> Windows Defender Firewall -> Advanced settings
# Inbound Rules -> New Rule -> Port -> TCP 5000 -> Allow -> Name: 4foods-api

# 6) Access
# Swagger: http://localhost:5000/docs
# Root:    http://localhost:5000

# (Optional) If deploying to a remote Windows Server, replace localhost with your_public_ip
```

### B. Linux (Debian/Ubuntu)
```bash
# 1) Install Docker & Compose
sudo apt update
sudo apt install -y docker.io docker-compose

# 2) Enable and start Docker
sudo systemctl enable docker
sudo systemctl start docker

# 3) Clone repository
git clone https://github.com/trietpsu29/4foods-api
cd 4foods-api

# 4) Prepare environment
cp .env.example .env
# Edit .env to set secrets (vim/nano)

# 5) Open firewall for port 5000 (UFW example)
sudo ufw allow 5000/tcp
sudo ufw reload

# 6) Build & run
sudo docker compose up -d --build

# 7) Access (replace your_public_ip with your VPS IP/domain)
# Swagger: http://your_public_ip:5000/docs
# Root:    http://your_public_ip:5000
```

### C. macOS (Terminal)
```bash
# 1) Install Docker Desktop for Mac
#    https://www.docker.com/products/docker-desktop/

# 2) Clone repository
git clone https://github.com/trietpsu29/4foods-api
cd 4foods-api

# 3) Prepare environment
cp .env.example .env
# Edit .env with secrets

# 4) Build & run
docker compose up -d --build

# 5) Access
# Swagger: http://localhost:5000/docs
# Root:    http://localhost:5000

# macOS firewall prompts appear per app; allow Docker to listen on 5000
```

## Deploy to VPS or Cloud (Linux server example)
```bash
# 0) Prepare your VPS (Ubuntu)
sudo apt update
sudo apt install -y docker.io docker-compose git

# 1) Clone the repo
git clone https://github.com/trietpsu29/4foods-api
cd 4foods-api

# 2) Setup environment
cp .env.example .env
# Edit .env with your production values

# 3) Update Swagger host/schemes in swagger_output.json
# host: your_public_ip or your.domain.com
# schemes: ["https"] if you serve over TLS

# 4) Open firewall/port 5000
sudo ufw allow 5000/tcp
sudo ufw reload

# 5) Build & run
sudo docker compose up -d --build

# 6) Verify
curl http://your_public_ip:5000
# -> "4Foods API Server is running!"

# 7) Access in browser
# Swagger: http://your_public_ip:5000/docs
# Root:    http://your_public_ip:5000
```
## Notes
- Default port: 5000 (mapped in docker-compose.yml)
- MongoDB runs as a Docker service named `mongo`
- Ensure your Cloudinary and email credentials are correct to avoid runtime errors
- For HTTPS, place behind a reverse proxy (e.g. Nginx + Certbot) and set `schemes` to `https` in `swagger_output.json`

## Troubleshooting
```bash
# Logs
docker compose logs -f api
docker compose logs -f mongo

# Restart stack
docker compose down
docker compose up -d --build

# Verify Mongo connection string matches docker service name "mongo"
# Example: MONGO_URI=mongodb://mongo:27017/4foods
```
