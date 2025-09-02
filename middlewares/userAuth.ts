import { Request, Response, NextFunction } from "express"
import jwt, { JwtPayload } from "jsonwebtoken"
import dotenv from "dotenv"
dotenv.config()



export interface AuthRequest extends Request {
    user?: JwtPayload & { userId: string }
}

export const authenticateUser = (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers["authorization"]
        //format should be bearer token
        const token = authHeader && authHeader.split(" ")[1]
        if (!token) {
            return res.status(401).json({ message: "Access denied" })
        }

        const privateKey = process.env.privateKey as string
        const decoded = jwt.verify(token, privateKey) as JwtPayload & { userId: string };
        req.user = decoded 
        next()
    } catch (error) {
        return res.status(403).json({ msg: "token expire or invalid", error })
    }

}

