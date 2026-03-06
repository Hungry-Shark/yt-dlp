import React, { useState, useEffect, useRef } from 'react';
import { getApiUrl } from '../api';

export default function CaptionPanel({ url }) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [captions, setCaptions] = useState({ manual: [], auto_generated: [] });
    const [selectedLang, setSelectedLang] = useState('');
    const [selectedFormat, setSelectedFormat] = useState('srt');
    const [downloading, setDownloading] = useState(false);

    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const dropdownRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        let isMounted = true;
        const fetchCaptions = async () => {
            setLoading(true);
            try {
                const res = await fetch(getApiUrl('/api/captions/list'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url })
                });

                if (!res.ok) throw new Error('Failed to load captions list');
                const data = await res.json();

                if (isMounted) {
                    setCaptions(data);

                    let defaultLang = '';
                    const enManual = data.manual.find(c => c.lang === 'en' || c.lang.startsWith('en-'));
                    const enAuto = data.auto_generated.find(c => c.lang === 'en' || c.lang.startsWith('en-'));

                    if (enManual) defaultLang = enManual.lang;
                    else if (enAuto) defaultLang = `auto_${enAuto.lang}`;
                    else if (data.manual.length > 0) defaultLang = data.manual[0].lang;
                    else if (data.auto_generated.length > 0) defaultLang = `auto_${data.auto_generated[0].lang}`;

                    setSelectedLang(defaultLang);
                }
            } catch (err) {
                if (isMounted) setError("Could not fetch captions.");
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchCaptions();
        return () => { isMounted = false; };
    }, [url]);

    const handleDownload = async () => {
        if (!selectedLang) return;

        setDownloading(true);
        const isAuto = selectedLang.startsWith('auto_');
        const actualLang = isAuto ? selectedLang.replace('auto_', '') : selectedLang;

        try {
            const res = await fetch(getApiUrl('/api/captions/download'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url,
                    lang: actualLang,
                    fmt: selectedFormat,
                    auto_generated: isAuto
                })
            });

            if (!res.ok) throw new Error("Failed to download captions");

            const blob = await res.blob();
            const contentDisposition = res.headers.get('Content-Disposition');
            let filename = `captions.${selectedFormat}`;
            if (contentDisposition && contentDisposition.includes('filename=')) {
                const parts = contentDisposition.split('filename=');
                if (parts.length > 1) {
                    filename = parts[1].replace(/"/g, '').replace(/utf-8''/i, '');
                }
            }

            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = blobUrl;
            a.download = decodeURIComponent(filename);
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(blobUrl);
            a.remove();
        } catch (err) {
            setError(err.message);
        } finally {
            setDownloading(false);
        }
    };

    const hasCaptions = captions.manual.length > 0 || captions.auto_generated.length > 0;

    const filteredManual = captions.manual.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()));
    const filteredAuto = captions.auto_generated.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()));

    const getSelectedName = () => {
        if (!selectedLang) return 'Select Language';
        const isAuto = selectedLang.startsWith('auto_');
        const langCode = isAuto ? selectedLang.replace('auto_', '') : selectedLang;

        if (isAuto) {
            const found = captions.auto_generated.find(c => c.lang === langCode);
            return found ? found.name : selectedLang;
        } else {
            const found = captions.manual.find(c => c.lang === langCode);
            return found ? found.name : selectedLang;
        }
    };

    if (loading) {
        return (
            <div className="panel-section">
                <h3 className="panel-title">Captions / Subtitles</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
                    <div className="spinner"></div> checking availability...
                </div>
            </div>
        );
    }

    return (
        <div className="panel-section">
            <h3 className="panel-title">Captions / Subtitles</h3>
            {error && <div className="error-banner" style={{ padding: '0.5rem', marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</div>}

            {!hasCaptions && !error ? (
                <p style={{ color: 'var(--text-secondary)', margin: 0 }}>No captions available for this video.</p>
            ) : (
                <div className="panel-row">
                    <div className="custom-select row-flex" ref={dropdownRef}>
                        <button
                            className="custom-select-button"
                            onClick={() => setDropdownOpen(!dropdownOpen)}
                            disabled={downloading}
                        >
                            {getSelectedName()}
                        </button>

                        {dropdownOpen && (
                            <div className="custom-select-dropdown">
                                <input
                                    type="text"
                                    className="custom-select-search"
                                    placeholder="Search language..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    autoFocus
                                />
                                <div className="custom-select-options">
                                    {filteredManual.length > 0 && <div className="custom-select-group">Manual</div>}
                                    {filteredManual.map(c => (
                                        <div
                                            key={c.lang}
                                            className={`custom-select-option ${selectedLang === c.lang ? 'selected' : ''}`}
                                            onClick={() => { setSelectedLang(c.lang); setDropdownOpen(false); setSearchQuery(''); }}
                                        >
                                            {c.name}
                                        </div>
                                    ))}

                                    {filteredAuto.length > 0 && <div className="custom-select-group">Auto-Generated</div>}
                                    {filteredAuto.map(c => (
                                        <div
                                            key={`auto_${c.lang}`}
                                            className={`custom-select-option ${selectedLang === `auto_${c.lang}` ? 'selected' : ''}`}
                                            onClick={() => { setSelectedLang(`auto_${c.lang}`); setDropdownOpen(false); setSearchQuery(''); }}
                                        >
                                            {c.name}
                                        </div>
                                    ))}

                                    {filteredManual.length === 0 && filteredAuto.length === 0 && (
                                        <div style={{ padding: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No languages found</div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="row-actions">
                        <select
                            className="select-input"
                            value={selectedFormat}
                            onChange={(e) => setSelectedFormat(e.target.value)}
                            disabled={downloading}
                            style={{ width: '80px', minWidth: '80px' }}
                        >
                            <option value="srt">SRT</option>
                            <option value="vtt">VTT</option>
                            <option value="txt">TXT</option>
                        </select>

                        <button
                            className="btn btn-secondary"
                            onClick={handleDownload}
                            disabled={downloading || !selectedLang}
                        >
                            {downloading ? <><div className="spinner"></div></> : 'Download'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
