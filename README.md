# 4Foods API

Backend API for the 4Foods application.

## Project Presentation

### 🎬 Introduction Video

https://github.com/user-attachments/assets/7c88b399-87b8-43b6-9bcc-342c4dca2479

### 📊 Feature Presentation

[View 4Foods Feature Presentation on Canva](https://www.canva.com/design/DAG65KJcn-E/qtdaQdnCpnF-egRHE2DegA/edit)

## Live Demo

- **API:** https://api.4foods.app/
- **API Documentation:** https://api.4foods.app/docs

## Deployment Guide

Follow these steps to deploy the API on a VPS using Docker and Docker Compose.

### Step 1: Connect to the VPS

```bash
ssh root@YOUR_SERVER_IP
cd /home/repo
```

### Step 2: Clone the Repository

```bash
git clone git@github.com:trietpsu29/4foods-api.git
cd 4foods-api
```

### Step 3: Install Docker

```bash
apt update
apt install docker.io docker-compose -y
```

### Step 4: Build and Start the Containers

```bash
docker compose up -d --build
```

### Step 5: Verify the Deployment

Open the following URLs in your browser:

- https://api.4foods.app/
- https://api.4foods.app/docs
