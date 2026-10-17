import { randomUUID } from "node:crypto"
import { Request, Response, NextFunction } from "express"

/** Accept an upstream correlation id (load balancer / gateway) or mint one, and echo it back. */
export const requestId = (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.headers["x-request-id"]
    req.id = typeof incoming === "string" && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID()
    res.setHeader("X-Request-Id", req.id)
    next()
}
