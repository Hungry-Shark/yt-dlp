import React from 'react';
import DownloadPanel from './DownloadPanel';
import CaptionPanel from './CaptionPanel';
import './VideoInfo.css';

export default function VideoInfo({ data, originalUrl }) {
    const formatDuration = (seconds) => {
        if (!seconds) return '0:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const formatViews = (views) => {
        if (!views) return '0';
        return new Intl.NumberFormat('en-US', { notation: 'compact' }).format(views) + ' views';
    };

    const formatDate = (ds) => {
        if (!ds || ds.length !== 8) return '';
        const year = ds.substring(0, 4);
        const month = ds.substring(4, 6);
        const day = ds.substring(6, 8);
        const d = new Date(year, month - 1, day);
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    };

    return (
        <div className="card">
            <div className="thumbnail-wrapper">
                <img src={data.thumbnail} alt={data.title} className="thumbnail" />
                <span className="duration-badge">{formatDuration(data.duration)}</span>
                {data.is_short && <span className="short-badge">SHORT</span>}
            </div>

            <div className="info-content">
                <h2 className="video-title">{data.title}</h2>
                <div className="video-meta">
                    <span className="channel-name">{data.channel}</span>
                    <span className="dot-separator">•</span>
                    <span>{formatViews(data.view_count)}</span>
                    {data.upload_date && (
                        <>
                            <span className="dot-separator">•</span>
                            <span>{formatDate(data.upload_date)}</span>
                        </>
                    )}
                </div>
                <p className="video-desc">{data.description}</p>

                <div className="panels-container">
                    <DownloadPanel data={data} url={originalUrl} />
                    <CaptionPanel url={originalUrl} />
                </div>
            </div>
        </div>
    );
}
