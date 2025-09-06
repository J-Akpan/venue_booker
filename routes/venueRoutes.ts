import express from "express"
import allVenues from "../controllers/venueController"
import { newVenue } from "../controllers/venueController"
import { authenticateUser } from "../middlewares/userAuth"

const venueRoutes:express.Router = express.Router()

venueRoutes.get('/', allVenues)
venueRoutes.post('/new', authenticateUser, newVenue)


export default venueRoutes
