import { Request, Response, NextFunction } from "express"
import {
    ExclusionConstraintError,
    ForeignKeyConstraintError,
    UniqueConstraintError,
    ConnectionError,
    TimeoutError,
} from "sequelize"
import { AppError } from "../errors"
import { logger } from "../logger"

export const notFoundHandler = (req: Request, res: Response) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.path} not found`, requestId: req.id } })
}

// Single place where errors become HTTP responses. Internals (stack traces, SQL) never leave the server.
export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const send = (status: number, code: string, message: string, details?: unknown) =>
        res.status(status).json({ error: { code, message, details, requestId: req.id } })

    if (err instanceof AppError) return send(err.status, err.code, err.message, err.details)
    if (err instanceof ExclusionConstraintError) return send(409, "CONFLICT", "That time slot is already taken")
    if (err instanceof UniqueConstraintError) return send(409, "CONFLICT", "A record with these details already exists")
    if (err instanceof ForeignKeyConstraintError) return send(400, "BAD_REQUEST", "Referenced record does not exist")
    if (err instanceof ConnectionError || err instanceof TimeoutError) {
        logger.error({ err, requestId: req.id }, "database unavailable")
        return send(503, "SERVICE_UNAVAILABLE", "Service temporarily unavailable, please retry")
    }
    if ((err as any)?.type === "entity.parse.failed") return send(400, "BAD_REQUEST", "Malformed JSON body")
    if ((err as any)?.type === "entity.too.large") return send(413, "PAYLOAD_TOO_LARGE", "Request body too large")

    logger.error({ err, requestId: req.id, path: req.path }, "unhandled error")
    return send(500, "INTERNAL", "Something went wrong")
}
