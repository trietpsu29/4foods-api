# 4Foods API — Simple Reproducible Setup

Follow these steps to deploy on a VPS with Docker & Docker Compose.

## Step 1: Login to VPS
```bash
ssh root@157.66.101.113
# Password: Admin@2352
cd /home/repo
```

## Step 2: Clone the repository
```bash
git clone git@github.com:trietpsu29/4foods-api.git
cd 4foods-api
```

## Step 3: Install Docker and Docker Compose
```bash
apt update
apt install docker.io docker-compose -y
```

## Step 4: Build and start containers
```bash
docker compose up -d --build
```

## Step 5: Open in your browser to check
- https://api.4foods.app/ — main page confirming the API is running
- https://api.4foods.app/docs — API docs