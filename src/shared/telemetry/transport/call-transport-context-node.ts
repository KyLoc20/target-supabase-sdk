/**
 * Node-only AsyncLocalStorage backing for call↔fetch correlation.
 * Side-effect import from `src/node.ts` (never from browser entry).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { type CallTransportContextImpl, installCallTransportContextImpl } from "./call-transport-context";

type Store = NonNullable<ReturnType<CallTransportContextImpl["getStore"]>>;

const als = new AsyncLocalStorage<Store>();

const nodeImpl: CallTransportContextImpl = {
    run(store, fn) {
        return als.run(store, fn);
    },
    getStore() {
        return als.getStore();
    },
};

installCallTransportContextImpl(nodeImpl);
