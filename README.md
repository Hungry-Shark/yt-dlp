# VaultDL

VaultDL is a self-hosted YouTube Media Downloader utilizing yt-dlp, FFmpeg, and React.

## Getting Started

1. Ensure Docker and Docker Compose are installed.
2. Clone the repository and navigate to the project root.
3. Run the following command:

```bash
docker compose up --build
```

4. Once the containers are running, navigate to `http://localhost:5173` in your web browser.
5. The backend API is available on `http://localhost:8000` automatically proxied.

## Environment configuration
To define specific environment configurations, copy `.env.example` to `.env` and set variables accordingly.
