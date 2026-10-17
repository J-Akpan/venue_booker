import { Request } from "express"
import { AuditLog } from "./audit.model"
import { logger } from "../../shared/logger"

interface AuditEntry {
    action: string // e.g. "booking.cancel"
    entity: string // e.g. "booking"
    entityId?: string | undefined
    metadata?: Record<string, unknown> | undefined
}

/** Record an audit event. Auditing is best-effort: a failure is logged but never fails the request. */
export const audit = async (req: Pick<Request, "id" | "user" | "ip"> | null, entry: AuditEntry, actorId?: string) => {
    try {
        await AuditLog.create({
            actorId: actorId ?? req?.user?.userId ?? null,
            action: entry.action,
            entity: entry.entity,
            entityId: entry.entityId ?? null,
            metadata: entry.metadata ?? null,
            requestId: req?.id ? String(req.id) : null,
            ip: req?.ip ?? null,
        })
    } catch (err) {
        logger.error({ err, entry }, "failed to write audit log")
    }
}

export { AuditLog }
