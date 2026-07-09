export const formatTimestamp = (timestamp: number): string => {
    return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        fractionalSecondDigits: 3,
    }).format(timestamp);
};

export const formatRelativeTime = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 1000) return "刚刚";
    if (diff < 60000) return `${Math.floor(diff / 1000)}秒前`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;

    return formatTimestamp(timestamp);
};

export const getRandomInterval = (): number => {
    const min = 15 * 1000;
    const max = 1 * 60 * 1000;
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

export const formatHeartbeat = (timestamp: number): string => {
    const absolute = formatTimestamp(timestamp);
    const relative = formatRelativeTime(timestamp);
    return `${absolute} (${relative})`;
};
