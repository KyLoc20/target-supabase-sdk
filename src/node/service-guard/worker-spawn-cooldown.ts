let lastWorkerSpawnAt = 0;

export function getWorkerSpawnCooldownLastAt(): number {
    return lastWorkerSpawnAt;
}

export function markWorkerSpawned(at = Date.now()): void {
    lastWorkerSpawnAt = at;
}

export function resetWorkerSpawnCooldownForTests(): void {
    lastWorkerSpawnAt = 0;
}
