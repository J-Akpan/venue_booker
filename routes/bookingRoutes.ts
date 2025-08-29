import express from "express"
import allBookings from "../controllers/bookingController"

const bookingRoutes:express.Router = express.Router()

bookingRoutes.get('/', allBookings)


export default bookingRoutes
