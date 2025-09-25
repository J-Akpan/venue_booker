import express from "express"
import { authenticateUser } from "../middlewares/userAuth"
import { allBookings } from "../controllers/bookingController"

const bookingRoutes:express.Router = express.Router()

bookingRoutes.get('/', authenticateUser, allBookings)


export default bookingRoutes
