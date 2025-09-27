import express from "express"
import { authenticateUser } from "../middlewares/userAuth"
import {allUserBookings, newBooking } from "../controllers/bookingController"

const bookingRoutes:express.Router = express.Router()

bookingRoutes.get('/', authenticateUser, allUserBookings)
bookingRoutes.post('/', authenticateUser, newBooking)

export default bookingRoutes
