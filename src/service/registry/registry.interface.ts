/**
 * Capacity slots on the system registry Config (`details.objects`).
 * Not fields on a Service Target row — see {@link Service} in `service.interface.ts`.
 */

export enum ServiceSlotStatus {
    EMPTY = "EMPTY",
    ACTIVE = "ACTIVE",
}

export interface ServiceSlot {
    serviceValue: string;
    /** Bound Service.id when {@link ServiceSlotStatus.ACTIVE}; null when EMPTY. */
    serviceId: string | null;
    status: ServiceSlotStatus;
}
