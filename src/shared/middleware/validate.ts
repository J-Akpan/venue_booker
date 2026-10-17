import { Request, Response, NextFunction } from "express"
import Joi from "joi"
import { badRequest } from "../errors"

type Source = "body" | "query" | "params"

/**
 * Validate and sanitise input at the edge. Unknown fields are stripped, which is what stops
 * mass-assignment (e.g. a client sending `role: "Admin"` or `status: "Completed"`).
 */
export const validate = (schema: Joi.ObjectSchema, source: Source = "body") => (req: Request, _res: Response, next: NextFunction) => {
    const { value, error } = schema.validate(req[source], { abortEarly: false, stripUnknown: true, convert: true })
    if (error) {
        throw badRequest(
            "Validation failed",
            error.details.map((d) => ({ field: d.path.join("."), message: d.message.replace(/"/g, "") })),
        )
    }
    // Express 5 exposes req.query as a getter, so redefine rather than assign.
    Object.defineProperty(req, source, { value, writable: true, configurable: true, enumerable: true })
    next()
}
