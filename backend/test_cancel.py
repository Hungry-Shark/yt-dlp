import yt_dlp
import time

def hook(d):
    if d['status'] == 'downloading':
        percent = d.get('_percent_str', '0.0%').strip()
        print(f"Progress: {percent}")
        if '10' in percent or '1.' in percent:
            print("TRIGGERING CANCEL via ValueError")
            raise ValueError("Download cancelled by user")

ydl_opts = {
    'progress_hooks': [hook],
    'quiet': True,
    'format': 'worst'
}

with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    try:
        ydl.download(['ytsearch1:python tutorial 10 minutes'])
    except Exception as e:
        print(f"Caught at root: {e}")
