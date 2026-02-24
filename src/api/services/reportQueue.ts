export const REPORT_CONCURRENCY = (() => {
    const raw = process.env.REPORT_CONCURRENCY;
    if (!raw) {
        return 1;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
})();

let activeReportCount = 0;
const reportQueue: Array<() => void> = [];

export type ReportSlotWaiter = {
    queued: boolean;
    position: number;
    totalQueued: number;
    wait: Promise<void>;
};

export function createReportSlotWaiter(signal?: AbortSignal): ReportSlotWaiter {
    if (REPORT_CONCURRENCY <= 0) {
        return { queued: false, position: 0, totalQueued: 0, wait: Promise.resolve() };
    }
    if (activeReportCount < REPORT_CONCURRENCY) {
        activeReportCount += 1;
        return { queued: false, position: 0, totalQueued: 0, wait: Promise.resolve() };
    }
    let resolveWait!: () => void;
    let rejectWait!: (error: Error) => void;
    const wait = new Promise<void>((resolve, reject) => {
        resolveWait = resolve;
        rejectWait = reject;
    });
    const grant = () => {
        signal?.removeEventListener("abort", onAbort);
        activeReportCount += 1;
        resolveWait();
    };
    const onAbort = () => {
        const index = reportQueue.indexOf(grant);
        if (index >= 0) {
            reportQueue.splice(index, 1);
        }
        rejectWait(new Error("请求已取消"));
    };
    const position = reportQueue.length + 1;
    reportQueue.push(grant);
    const totalQueued = reportQueue.length;
    if (signal) {
        if (signal.aborted) {
            onAbort();
        } else {
            signal.addEventListener("abort", onAbort, { once: true });
        }
    }
    return { queued: true, position, totalQueued, wait };
}

export function releaseReportSlot(): void {
    if (REPORT_CONCURRENCY <= 0) {
        return;
    }
    activeReportCount = Math.max(0, activeReportCount - 1);
    const next = reportQueue.shift();
    if (next) {
        next();
    }
}

export async function withReportSlot<T>(
    signal: AbortSignal | undefined,
    work: () => Promise<T>,
    onQueued?: (info: { position: number; totalQueued: number; concurrency: number }) => void
): Promise<T> {
    const waiter = createReportSlotWaiter(signal);
    if (waiter.queued) {
        onQueued?.({ position: waiter.position, totalQueued: waiter.totalQueued, concurrency: REPORT_CONCURRENCY });
    }
    await waiter.wait;
    try {
        return await work();
    } finally {
        releaseReportSlot();
    }
}
