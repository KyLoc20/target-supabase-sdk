/** UTC `yyyyMMddHHmmss` segment in log spool batch filenames — browser-safe (no Node built-ins). */

export function formatLogSpoolBatchTimestamp(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
        `${d.getUTCFullYear()}` +
        `${pad(d.getUTCMonth() + 1)}` +
        `${pad(d.getUTCDate())}` +
        `${pad(d.getUTCHours())}` +
        `${pad(d.getUTCMinutes())}` +
        `${pad(d.getUTCSeconds())}`
    );
}
