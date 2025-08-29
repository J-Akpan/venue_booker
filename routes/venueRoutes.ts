import express from "express"
import allVenues from "../controllers/venueController"

const venueRoutes:express.Router = express.Router()

venueRoutes.get('/', allVenues)


export default venueRoutes
