import { useState, useEffect, useCallback } from 'react'
import VideoInfo from './components/VideoInfo'
import ThemeToggle from './components/ThemeToggle'
import { getApiUrl } from './api'

function App() {
    const [url, setUrl] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [videoData, setVideoData] = useState(null)

    const handleAnalyze = useCallback(async (urlToAnalyze = url) => {
        if (!urlToAnalyze.trim()) return

        if (!urlToAnalyze.includes('youtube.com') && !urlToAnalyze.includes('youtu.be')) {
            setError("Please enter a valid YouTube URL")
            return
        }

        setLoading(true)
        setError(null)
        setVideoData(null)

        try {
            const res = await fetch(getApiUrl('/api/info'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: urlToAnalyze.trim() })
            })

            if (!res.ok) {
                const errorData = await res.json()
                throw new Error(errorData.detail || 'Failed to fetch video info')
            }

            const data = await res.json()
            setVideoData(data)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }, [url])

    useEffect(() => {
        const timer = setTimeout(() => {
            if (url.trim() && (url.includes('youtube.com') || url.includes('youtu.be'))) {
                handleAnalyze(url);
            }
        }, 5000);

        return () => clearTimeout(timer);
    }, [url, handleAnalyze]);

    return (
        <div className="container">
            <header className="header">
                <h1 className="title">VaultDL</h1>
                <p className="tagline">Extract video, audio, and captions seamlessly</p>
                <ThemeToggle />
            </header>

            <form className="search-container" onSubmit={(e) => { e.preventDefault(); handleAnalyze(url); }}>
                <input
                    type="text"
                    className="url-input"
                    placeholder="Paste YouTube URL here (Video, Shorts, Post)..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={loading}
                />
                <button type="submit" className="btn" disabled={loading || !url.trim()}>
                    {loading ? (
                        <><div className="spinner"></div> Analyzing...</>
                    ) : 'Analyze'}
                </button>
            </form>

            {error && (
                <div className="error-banner">
                    {error}
                </div>
            )}

            {videoData && (
                <div className="slide-up">
                    <VideoInfo data={videoData} originalUrl={url.trim()} />
                </div>
            )}
        </div>
    )
}

export default App
