import React, { useState } from 'react';

export default function DownloadPanel({ data, url }) {
    const defaultVideoQuality = data.video_qualities?.length > 0 ? data.video_qualities[0].split('p')[0] + 'p' : 'best';
    const [selectedQuality, setSelectedQuality] = useState(defaultVideoQuality);
    const [downloading, setDownloading] = useState(null); // 'video' | 'audio' | 'thumbnail' | null
    const [progressMsg, setProgressMsg] = useState('');
    const [progressData, setProgressData] = useState({ percent: 0, speed: '', eta: '', phase: 0 });
    const [abortController, setAbortController] = useState(null);
    const [error, setError] = useState(null);

    React.useEffect(() => {
        let ws = null;
        if (data?.id) {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(`${protocol}//${window.location.host}/api/ws/progress/${data.id}`);

            ws.onmessage = (event) => {
                const msg = event.data;
                setProgressMsg(msg);

                // Parse "Downloading... 45.2% 1.5MiB/s ETA 00:15"
                if (msg.includes('%')) {
                    const percentMatch = msg.match(/(\d+\.?\d*)%/);
                    const speedMatch = msg.match(/at\s+([^\s]+)/) || msg.match(/([0-9.]+[KMG]?iB\/s)/);
                    const etaMatch = msg.match(/ETA\s+([\d:]+)/);

                    if (percentMatch) {
                        const newPercent = parseFloat(percentMatch[1]);

                        // If percentage goes down sharply (e.g. 100% video finishes, then starts 0% audio), advance phase
                        setProgressData(prev => {
                            let newPhase = prev.phase;
                            if (prev.percent > 90 && newPercent < 10) {
                                newPhase += 1;
                            }
                            return {
                                percent: newPercent,
                                speed: speedMatch ? speedMatch[1] : '',
                                eta: etaMatch ? etaMatch[1] : '',
                                phase: newPhase
                            }
                        });
                    }
                } else if (msg.includes('Processing')) {
                    setProgressData(prev => ({ ...prev, percent: 100, phase: 2 }));
                }
            };
        }

        return () => {
            if (ws) {
                if (ws.readyState === WebSocket.CONNECTING) {
                    ws.onopen = () => ws.close(); // wait for it to open before gracefully closing
                } else if (ws.readyState === WebSocket.OPEN) {
                    ws.close();
                }
            }
        };
    }, [data?.id]);

    const getStatusText = () => {
        if (progressMsg.includes('Processing') || progressData.phase === 2) return 'Adding the magic... ✨';
        if (downloading === 'audio') return 'Ripping high quality audio... 🎵';

        // Phase 0 translates to the first file download pass (usually the video track)
        if (progressData.phase === 0) return 'Building your video... 🎬';
        // Phase 1 translates to the second file download pass (usually the audio track interleaving)
        return 'Adding some music... 🎧';
    };

    const handleCancel = async () => {
        if (abortController) {
            abortController.abort();
            setDownloading(null);
            setProgressMsg('');
            setProgressData({ percent: 0, speed: '', eta: '', phase: 0 });
            setAbortController(null);

            if (data?.id) {
                try {
                    await fetch('/api/cancel', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ video_id: data.id })
                    });
                } catch (e) { }
            }
        }
    };

    const handleDownload = async (format, quality = 'best') => {
        setDownloading(format);
        setProgressMsg('');
        setProgressData({ percent: 0, speed: '', eta: '', phase: 0 });
        setError(null);

        const controller = new AbortController();
        setAbortController(controller);

        try {
            const res = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, format, quality, video_id: data.id }),
                signal: controller.signal
            });

            if (!res.ok) {
                let errorMsg = `Failed to download ${format}`;
                try {
                    const errorData = await res.json();
                    if (errorData.detail) errorMsg = errorData.detail;
                } catch (e) { }
                throw new Error(errorMsg);
            }

            const blob = await res.blob();
            const contentDisposition = res.headers.get('Content-Disposition');
            let filename = `${data.title || 'download'}`;

            // Standardize filename
            filename = filename.replace(/[<>:"/\\|?*]+/g, '_');

            if (contentDisposition && contentDisposition.includes('filename=')) {
                const parts = contentDisposition.split('filename=');
                if (parts.length > 1) {
                    filename = parts[1].replace(/"/g, '').replace(/utf-8''/i, '');
                }
            } else {
                const ext = format === 'video' ? 'mp4' : format === 'audio' ? 'mp3' : 'jpg';
                filename = `${filename}.${ext}`;
            }

            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = blobUrl;
            try {
                a.download = decodeURIComponent(filename);
            } catch (e) {
                a.download = filename;
            }
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(blobUrl);
            a.remove();
        } catch (err) {
            // Ignore abort errors
            if (err.name !== 'AbortError') {
                setError(err.message);
            }
        } finally {
            setDownloading(null);
            setProgressMsg('');
            setAbortController(null);
        }
    };

    return (
        <div className="panel-section">
            <h3 className="panel-title">Media Downloads</h3>

            {error && <div className="error-banner" style={{ padding: '0.5rem', marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</div>}

            {downloading && (downloading === 'video' || downloading === 'audio') && progressMsg && (
                <div className="progress-container">
                    <div className="progress-header">
                        <span className="progress-status">{getStatusText()}</span>
                        <span className="progress-percent">{progressData.percent}%</span>
                    </div>
                    <div className="progress-bar-bg">
                        <div
                            className="progress-bar-fill"
                            style={{
                                width: `${progressData.percent}%`,
                                backgroundColor: progressMsg.includes('Processing') ? '#22c55e' : 'var(--accent-color)'
                            }}
                        />
                    </div>
                    <div className="progress-footer">
                        <span>{progressData.speed}</span>
                        <span>{progressData.eta ? `ETA: ${progressData.eta}` : ''}</span>
                    </div>
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div className="panel-row">
                    <span style={{ fontWeight: 500, width: '80px' }}>Video</span>
                    <select
                        className="select-input"
                        value={selectedQuality}
                        onChange={(e) => setSelectedQuality(e.target.value)}
                        disabled={downloading !== null}
                    >
                        {data.video_qualities?.map(q => {
                            // q can be "1080p (24.0 MB)". The backend needs "1080"
                            const val = q.split('p')[0] + 'p';
                            return <option key={q} value={val}>{q}</option>
                        })}
                        {!data.video_qualities?.length && <option value="best">Best available</option>}
                    </select>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                            className="btn"
                            onClick={() => handleDownload('video', selectedQuality)}
                            disabled={downloading !== null}
                        >
                            {downloading === 'video' ? <><div className="spinner"></div> Please wait...</> : 'Download MP4'}
                        </button>
                        {downloading && (
                            <button className="btn btn-secondary" onClick={handleCancel} style={{ padding: '0.6rem 1rem' }}>
                                Cancel
                            </button>
                        )}
                    </div>
                </div>

                <div className="panel-row">
                    <span style={{ fontWeight: 500, width: '80px' }}>Audio</span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', flex: 1 }}>192kbps MP3</span>
                    <button
                        className="btn btn-secondary"
                        onClick={() => handleDownload('audio')}
                        disabled={downloading !== null || !data.has_audio}
                        style={{ opacity: data.has_audio ? 1 : 0.5 }}
                    >
                        {downloading === 'audio' ? <><div className="spinner"></div> Please wait...</> : 'Download MP3'}
                    </button>
                </div>

                <div className="panel-row">
                    <span style={{ fontWeight: 500, width: '80px' }}>Cover</span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', flex: 1 }}>Highest resolution JPEG</span>
                    <button
                        className="btn btn-secondary"
                        onClick={() => handleDownload('thumbnail')}
                        disabled={downloading !== null}
                    >
                        {downloading === 'thumbnail' ? <><div className="spinner"></div> Fetching...</> : 'Download JPEG'}
                    </button>
                </div>
            </div>
        </div>
    );
}
