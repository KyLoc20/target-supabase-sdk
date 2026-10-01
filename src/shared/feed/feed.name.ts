/** Normalize `platformName` so `Link.name` stays `{platform}.{feedKey}` with a single separator dot. */
export function sanitizeFeedPlatformName(platformName: string): string {
    return platformName.trim().replaceAll(".", " ");
}

/**
 * Default dedup `Link.name` for feed Links: `{platformName}.{feedKey}`.
 * Dots in `platformName` are replaced with spaces before joining (see {@link sanitizeFeedPlatformName}).
 */
export function buildFeedLinkName(platformName: string, feedKey: string): string {
    const platform = sanitizeFeedPlatformName(platformName);
    const key = feedKey.trim();
    if (platform === "") {
        throw new Error("buildFeedLinkName: platformName is empty");
    }
    if (key === "") {
        throw new Error("buildFeedLinkName: feedKey is empty");
    }
    return `${platform}.${key}`;
}
