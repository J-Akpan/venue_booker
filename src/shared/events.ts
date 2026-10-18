import { EventEmitter } from "node:events"
import { logger } from "./logger"

/**
 * In-process domain events: the seam between modules in the monolith.
 * A module publishes a fact ("booking.confirmed") and never imports the modules that react to it
 * (notifications, cache invalidation, audit). If a module is later extracted into a service,
 * these events become messages on a broker and the publishers don't change.
 */
export interface DomainEvents {
    "user.registered": { userId: string; email: string; username: string }
    "user.passwordResetRequested": { email: string; otp: string }
    "venue.changed": { venueId: string }
    "booking.created": { bookingId: string; userId: string; venueId: string }
    "booking.confirmed": { bookingId: string; userId: string; venueId: string }
    "booking.cancelled": { bookingId: string; userId: string; venueId: string; refund: boolean }
    "case.resolved": { caseId: string; raisedBy: string; type: "complaint" | "dispute"; outcome: "resolved" | "rejected"; resolution: string }
}

const bus = new EventEmitter()

export const publish = <K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]) => {
    bus.emit(event, payload)
}

export const subscribe = <K extends keyof DomainEvents>(event: K, handler: (payload: DomainEvents[K]) => void | Promise<void>) => {
    bus.on(event, (payload: DomainEvents[K]) => {
        // A failing subscriber must never break the publisher's request.
        Promise.resolve()
            .then(() => handler(payload))
            .catch((err) => logger.error({ err, event }, "event handler failed"))
    })
}
