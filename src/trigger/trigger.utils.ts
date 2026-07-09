import type { Trigger, TriggerDailySchedule } from "./trigger.interface";

interface UtcDateParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
}

function parseUtcDateParts(now: Date): UtcDateParts {
    return {
        year: now.getUTCFullYear(),
        month: now.getUTCMonth() + 1,
        day: now.getUTCDate(),
        hour: now.getUTCHours(),
        minute: now.getUTCMinutes(),
    };
}

export function buildDailyFireKey(_schedule: TriggerDailySchedule, now: Date): string {
    const { year, month, day } = parseUtcDateParts(now);
    const yyyy = String(year).padStart(4, "0");
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `daily:${yyyy}-${mm}-${dd}`;
}

export function isDailyScheduleDue(
    schedule: TriggerDailySchedule,
    now: Date,
    lastFireKey: string | null | undefined,
): boolean {
    const parts = parseUtcDateParts(now);
    if (parts.hour !== schedule.hour || parts.minute !== schedule.minute) {
        return false;
    }
    const fireKey = buildDailyFireKey(schedule, now);
    return lastFireKey !== fireKey;
}

export function isTriggerDue(trigger: Trigger, now: Date = new Date()): boolean {
    const { schedule, lastFireKey } = trigger.details;
    if (schedule.kind !== "daily") {
        throw new Error(`Unsupported trigger schedule kind: ${String((schedule as { kind?: string }).kind)}`);
    }
    return isDailyScheduleDue(schedule, now, lastFireKey);
}

export function buildFireKey(trigger: Trigger, now: Date = new Date()): string {
    const { schedule } = trigger.details;
    if (schedule.kind !== "daily") {
        throw new Error(`Unsupported trigger schedule kind: ${String((schedule as { kind?: string }).kind)}`);
    }
    return buildDailyFireKey(schedule, now);
}
