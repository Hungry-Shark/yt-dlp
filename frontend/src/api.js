export const getApiUrl = (path) => {
    // Vite built-in env variable
    const baseUrl = import.meta.env.VITE_API_URL || '';

    // Ensure path starts with /
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    return `${baseUrl}${normalizedPath}`;
};

export const getWsUrl = (path) => {
    const baseUrl = import.meta.env.VITE_API_URL || window.location.origin;

    // Convert http/https to ws/wss
    const wsBaseUrl = baseUrl.replace(/^http/, 'ws');

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${wsBaseUrl}${normalizedPath}`;
};
