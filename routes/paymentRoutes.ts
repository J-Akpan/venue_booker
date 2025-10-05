import express from "express"
import { createPayment, processPayment } from "../controllers/paymentController"
import { authenticateUser } from "../middlewares/userAuth"

const paymentRoutes: express.Router = express.Router()

paymentRoutes.post('/', authenticateUser, createPayment)
paymentRoutes.post('/pay', authenticateUser, processPayment)

export default paymentRoutes 