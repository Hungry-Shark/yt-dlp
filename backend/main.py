import os
import uuid
import shutil
from typing import Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yt_dlp
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="VaultDL Backend", version="1.0")

CORS_ORIGIN = os.getenv("CORS_ORIGIN", "http://localhost:5173")
DOWNLOAD_DIR = os.getenv("DOWNLOAD_DIR", "/tmp/ytdl_downloads")
YOUTUBE_COOKIES = os.getenv("YOUTUBE_COOKIES", "")

os.makedirs(DOWNLOAD_DIR, exist_ok=True)

if YOUTUBE_COOKIES:
    # Save cookies to a file temporarily so yt-dlp can use it
    with open("/tmp/youtube_cookies.txt", "w") as f:
        f.write(YOUTUBE_COOKIES)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[CORS_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class URLRequest(BaseModel):
    url: str

class DownloadRequest(BaseModel):
    url: str
    format: str # video, audio, thumbnail
    quality: Optional[str] = "best"
    video_id: Optional[str] = None

class CaptionRequest(BaseModel):
    url: str
    lang: str = "en"
    fmt: str = "vtt" # srt, vtt, or txt
    auto_generated: bool = False

# WebSocket Progress Tracking
active_connections: dict[str, list[WebSocket]] = {}
cancelled_jobs: set[str] = set()

class CancelRequest(BaseModel):
    video_id: str

@app.post("/api/cancel")
async def cancel_download(request: CancelRequest):
    cancelled_jobs.add(request.video_id)
    return {"status": "cancelled"}

def cleanup_job(directory: str):
    if os.path.exists(directory):
        shutil.rmtree(directory, ignore_errors=True)

def handle_ytdlp_error(e: yt_dlp.utils.DownloadError):
    error_msg = str(e)
    if "Private video" in error_msg:
        detail = "This video is private."
    elif "Age-restricted" in error_msg:
        detail = "This video is age-restricted and cannot be downloaded without authentication."
    elif "Video unavailable" in error_msg:
        detail = "This video is unavailable or has been deleted."
    else:
        detail = f"Could not process URL: {error_msg}"
    return HTTPException(status_code=400, detail=detail)

@app.get("/health")
async def health_check():
    return {"status": "ok"}

@app.websocket("/api/ws/progress/{video_id}")
async def websocket_endpoint(websocket: WebSocket, video_id: str):
    await websocket.accept()
    if video_id not in active_connections:
        active_connections[video_id] = []
    active_connections[video_id].append(websocket)
    try:
        while True:
            await websocket.receive_text() # keep open
    except WebSocketDisconnect:
        active_connections[video_id].remove(websocket)
        if not active_connections[video_id]:
            del active_connections[video_id]

@app.post("/api/info")
async def get_video_info(request: URLRequest):
    valid_domains = ["youtube.com", "youtu.be"]
    if not any(domain in request.url for domain in valid_domains):
        raise HTTPException(status_code=400, detail="Invalid URL: Please provide a valid YouTube link.")

    ydl_opts = {
        'extract_flat': False,
        'download': False,
        'quiet': True,
        'no_warnings': True,
    }
    
    if YOUTUBE_COOKIES:
        ydl_opts['cookiefile'] = "/tmp/youtube_cookies.txt"
        
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(request.url, download=False, process=False)
            
            formats = info.get("formats", [])
            video_qualities = []
            has_audio = False
            
            # Helper to format bytes
            def format_bytes(size):
                if not size:
                    return ""
                for unit in ['B', 'KB', 'MB', 'GB']:
                    if size < 1024.0:
                        return f"{size:.1f} {unit}"
                    size /= 1024.0
                return f"{size:.1f} TB"
            
            for f in formats:
                if not f.get("url"):
                    continue

                if f.get('acodec') != 'none':
                    has_audio = True
                
                height = f.get("height")
                ext = f.get("ext")
                vcodec = f.get("vcodec")
                filesize = f.get("filesize") or f.get("filesize_approx")
                
                if height and str(vcodec).lower() != 'none':
                    size_str = f" ({format_bytes(filesize)})" if filesize else ""
                    quality_str = f"{height}p{size_str}"
                    
                    # Store as dict initially to prevent duplicates of same height, keeping largest/best size
                    existing = next((item for item in video_qualities if item['height'] == height), None)
                    if not existing:
                        video_qualities.append({'height': height, 'label': quality_str, 'size_val': filesize or 0})
                    elif existing and filesize and existing['size_val'] < filesize:
                        existing['label'] = quality_str
                        existing['size_val'] = filesize
                        
            # Sort qualities e.g., ['1080p', '720p', '480p']
            video_qualities = sorted(
                video_qualities, 
                key=lambda x: x['height'], 
                reverse=True
            )
            # Flatten to list of labels
            video_qualities = [q['label'] for q in video_qualities]

            is_short = "/shorts/" in request.url or info.get("duration", 0) <= 60
            video_id = info.get("id")
            thumbnail_url = f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg" if video_id else info.get("thumbnail")

            desc = info.get("description", "")
            if desc:
                desc = desc[:100] + "..." if len(desc) > 100 else desc

            return {
                "id": video_id,
                "title": info.get("title"),
                "channel": info.get("uploader"),
                "duration": info.get("duration"),
                "thumbnail": thumbnail_url,
                "description": desc,
                "view_count": info.get("view_count", 0),
                "upload_date": info.get("upload_date", ""),
                "video_qualities": video_qualities,
                "has_audio": has_audio,
                "is_short": is_short
            }
            
    except yt_dlp.utils.DownloadError as e:
        raise handle_ytdlp_error(e)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@app.post("/api/download")
async def download_media(request: DownloadRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    job_dir = os.path.join(DOWNLOAD_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)
    
    import asyncio
    import re
    loop = asyncio.get_running_loop()
    track_id = request.video_id or "unknown"

    def internal_progress_hook(d):
        # Allow cancellation by both the global video_id hook or the unique background job_id hook
        if track_id in cancelled_jobs or job_id in cancelled_jobs:
            raise ValueError("Download cancelled by user")

        if d['status'] == 'downloading':
            percent_str = d.get('_percent_str', '0.0%').strip()
            speed_str = d.get('_speed_str', '').strip()
            # Clean strict ansi codes from yt-dlp progress
            percent_str = re.sub(r'\x1b\[[0-9;]*m', '', percent_str)
            speed_str = re.sub(r'\x1b\[[0-9;]*m', '', speed_str)
            msg = f"Downloading... {percent_str} {speed_str}".strip()
            if track_id in active_connections:
                for conn in active_connections[track_id]:
                    try:
                        asyncio.run_coroutine_threadsafe(conn.send_text(msg), loop)
                    except Exception:
                        pass
        elif d['status'] == 'finished':
            if track_id in active_connections:
                for conn in active_connections[track_id]:
                    try:
                        asyncio.run_coroutine_threadsafe(conn.send_text("Processing..."), loop)
                    except Exception:
                        pass

    ydl_opts = {
        'outtmpl': f'{job_dir}/%(title)s.%(ext)s',
        'quiet': True,
        'no_warnings': True,
        'restrictfilenames': True, 
        'progress_hooks': [internal_progress_hook],
        'nocolor': True,
    }
    
    if YOUTUBE_COOKIES:
        ydl_opts['cookiefile'] = "/tmp/youtube_cookies.txt"

    try:
        if request.format == "video":
            q = None
            if request.quality and request.quality != "best":
                # The frontend sends strings like "1080p (14.2 MB)" now, so we need to isolate just "1080"
                q = request.quality.split('p')[0].strip()
            # The 'mp4' extension constraint sometimes fails for specific qualities when using cookies
            # It's safer to let yt-dlp pick the best video and audio streams up to the target height,
            # and then merge them into an mp4 container.
            if not q:
                ydl_opts['format'] = 'bestvideo+bestaudio/best'
            else:
                ydl_opts['format'] = f'bestvideo[height<={q}]+bestaudio/best[height<={q}]/best'
            
            ydl_opts['merge_output_format'] = 'mp4'

        elif request.format == "audio":
            ydl_opts['format'] = 'bestaudio/best'
            ydl_opts['postprocessors'] = [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }]
            
        elif request.format == "thumbnail":
            ydl_opts['skip_download'] = True
            ydl_opts['writethumbnail'] = True
            
        else:
            raise HTTPException(status_code=400, detail="Invalid format requested.")

        def run_ydl_download():
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([request.url])
            finally:
                if job_id in cancelled_jobs:
                    cancelled_jobs.discard(job_id)
                if track_id in cancelled_jobs:
                    cancelled_jobs.discard(track_id)
                
        try:
            await asyncio.to_thread(run_ydl_download)
        except asyncio.CancelledError:
            print("FastAPI request aborted by client. Adding to cancelled_jobs to stop background thread.")
            cancelled_jobs.add(job_id)
            raise

        downloaded_files = os.listdir(job_dir)
        if not downloaded_files:
            raise Exception("No file was produced.")
            
        target_file = None
        if request.format == "thumbnail":
            for f in downloaded_files:
                if f.endswith(('.jpg', '.webp', '.png')):
                    target_file = f
                    break
        else:
            target_file = downloaded_files[0]
            
        if not target_file:
             raise Exception("Target file not found after processing.")

        if request.format == "thumbnail":
             # Convert whatever was downloaded (webp/png) into max quality jpeg
             orig_path = os.path.join(job_dir, target_file)
             new_target = f"{os.path.splitext(target_file)[0]}.jpg"
             new_path = os.path.join(job_dir, new_target)
             
             with Image.open(orig_path) as img:
                 img.convert("RGB").save(new_path, "JPEG", quality=100)
             
             # Optionally delete original if it's not the same
             if orig_path != new_path:
                 os.remove(orig_path)
                 
             target_file = new_target

        file_path = os.path.join(job_dir, target_file)
        
        background_tasks.add_task(cleanup_job, job_dir)
        
        media_types = {
            "video": "video/mp4",
            "audio": "audio/mpeg",
            "thumbnail": "image/jpeg"
        }
        
        return FileResponse(
            path=file_path,
            filename=target_file,
            media_type=media_types.get(request.format, "application/octet-stream")
        )
            
    except yt_dlp.utils.DownloadError as e:
        cleanup_job(job_dir)
        raise handle_ytdlp_error(e)
    except Exception as e:
        cleanup_job(job_dir)
        raise HTTPException(status_code=500, detail=f"Download error: {str(e)}")


@app.post("/api/captions/list")
async def list_captions(request: URLRequest):
    ydl_opts = {
        'extract_flat': False,
        'download': False,
        'quiet': True,
        'no_warnings': True,
        'listsubtitles': True,
    }
    if YOUTUBE_COOKIES:
        ydl_opts['cookiefile'] = "/tmp/youtube_cookies.txt"
        
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(request.url, download=False, process=False)
            subs = info.get('subtitles', {})
            auto_subs = info.get('automatic_captions', {})
            
            manual = [{"lang": k, "name": v[0].get('name', k)} for k, v in subs.items() if v]
            auto = [{"lang": k, "name": f"{k} (Auto)"} for k, v in auto_subs.items() if v]
            
            return {
                "manual": manual,
                "auto_generated": auto
            }
    except yt_dlp.utils.DownloadError as e:
        raise handle_ytdlp_error(e)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/captions/download")
def download_captions(request: CaptionRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    job_dir = os.path.join(DOWNLOAD_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)
    
    fmt = request.fmt if request.fmt in ["srt", "vtt", "txt"] else "vtt"
    dl_fmt = "vtt" if fmt == "txt" else fmt
    
    ydl_opts = {
        'skip_download': True,
        'writesubtitles': not request.auto_generated,
        'writeautomaticsub': request.auto_generated,
        'subtitleslangs': [request.lang],
        'subtitlesformat': f'{dl_fmt}/best',
        'outtmpl': f'{job_dir}/%(title)s.%(ext)s',
        'quiet': True,
        'no_warnings': True,
        'restrictfilenames': True,
        'postprocessors': [{
            'key': 'FFmpegSubtitlesConvertor',
            'format': dl_fmt,
        }],
    }
    if YOUTUBE_COOKIES:
        ydl_opts['cookiefile'] = "/tmp/youtube_cookies.txt"
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([request.url])
            
        downloaded_files = os.listdir(job_dir)
        if not downloaded_files:
            raise HTTPException(status_code=404, detail="Requested captions not found or unavailable.")
            
        target_file = None
        for f in downloaded_files:
            if f.endswith(f'.{dl_fmt}'):
                target_file = f
                break
                
        if not target_file:
             raise Exception("Caption file wasn't formatted correctly by downloader.")
             
        file_path = os.path.join(job_dir, target_file)
        
        if fmt == "txt":
            import re
            txt_target = target_file.replace('.vtt', '.txt')
            txt_path = os.path.join(job_dir, txt_target)
            
            with open(file_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
                
            with open(txt_path, 'w', encoding='utf-8') as f:
                for line in lines:
                    line_stripped = line.strip()
                    if 'WEBVTT' in line_stripped or 'Language:' in line_stripped or 'Kind:' in line_stripped or '-->' in line_stripped:
                        continue
                    if line_stripped == '' or line_stripped.isdigit():
                        continue
                    clean_line = re.sub(r'<[^>]+>', '', line)
                    f.write(clean_line)
                    
            target_file = txt_target
            file_path = txt_path

        background_tasks.add_task(cleanup_job, job_dir)
        
        return FileResponse(
            path=file_path,
            filename=target_file,
            media_type="text/plain"
        )
    except yt_dlp.utils.DownloadError as e:
        cleanup_job(job_dir)
        raise handle_ytdlp_error(e)
    except Exception as e:
        cleanup_job(job_dir)
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Caption download error: {str(e)}")
