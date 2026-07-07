export interface ReadinessCheckResult {
    name: string;
    ok: boolean;
    detail?: string;
}

export interface ReadinessReport {
    ok: boolean;
    checks: ReadinessCheckResult[];
    message: string | null;
}

export type ReadinessCheck = () => ReadinessCheckResult | Promise<ReadinessCheckResult>;
