export const LOG_TOPIC_TRIGGER = "trigger";

/** Default main-loop interval for {@link TriggerNode} when `loopIntervalMs` is omitted (ms). */
export const TRIGGER_LOOP_INTERVAL_MS = 60_000;

/** Default extra retries after first failure within one runner tick. */
export const TRIGGER_RUNNER_DEFAULT_RETRY_COUNT = 3;

/** Default delay between retry attempts within the same tick (ms). */
export const TRIGGER_RUNNER_DEFAULT_RETRY_DELAY_MS = 0;
