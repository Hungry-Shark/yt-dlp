import React, { useEffect, useState } from 'react';

export default function ThemeToggle() {
    const [isDark, setIsDark] = useState(false);

    useEffect(() => {
        // Init theme from localStorage or system preference
        const savedTheme = localStorage.getItem('vaultdl-theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

        if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
            setIsDark(true);
            document.documentElement.classList.add('dark');
        } else {
            setIsDark(false);
            document.documentElement.classList.remove('dark');
        }
    }, []);

    const toggleTheme = (event) => {
        const x = event.clientX;
        const y = event.clientY;

        const endRadius = Math.hypot(
            Math.max(x, window.innerWidth - x),
            Math.max(y, window.innerHeight - y)
        );

        const newIsDark = !isDark;

        // Ensure browser supports the view transitions API
        if (!document.startViewTransition) {
            applyTheme(newIsDark);
            return;
        }

        const transition = document.startViewTransition(() => {
            applyTheme(newIsDark);
        });

        transition.ready.then(() => {
            // Animate from the mouse click coordinates expanding outwards
            const clipPath = [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${endRadius}px at ${x}px ${y}px)`
            ];

            document.documentElement.animate(
                { clipPath: newIsDark ? clipPath : [...clipPath].reverse() },
                {
                    duration: 500,
                    easing: 'ease-in-out',
                    pseudoElement: newIsDark ? '::view-transition-new(root)' : '::view-transition-old(root)'
                }
            );
        });
    };

    const applyTheme = (dark) => {
        setIsDark(dark);
        if (dark) {
            document.documentElement.classList.add('dark');
            localStorage.setItem('vaultdl-theme', 'dark');
        } else {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('vaultdl-theme', 'light');
        }
    };

    return (
        <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label="Toggle Dark Mode"
            title="Toggle Theme"
        >
            {isDark ? '☀️' : '🌙'}
        </button>
    );
}
