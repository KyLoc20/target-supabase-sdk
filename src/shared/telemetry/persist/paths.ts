import { isAbsolute, join, resolve } from "node:path";
import type { TelemetryLane } from "../types";

export function resolveTelemetryDataRoot(configuredRoot: string, cwd: string = process.cwd()): string {
    return isAbsolute(configuredRoot) ? configuredRoot : resolve(cwd, configuredRoot);
}

export function telemetryLaneDir(root: string, lane: TelemetryLane): string {
    return join(root, lane);
}
