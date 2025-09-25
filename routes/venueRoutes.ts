import express from "express"
import { allUserVenue, 
    allVenues, 
    deleteVenue, 
    newVenue, 
    searchVenue, 
    venueUpdate } from "../controllers/venueController"
import { authenticateUser } from "../middlewares/userAuth"

const venueRoutes:express.Router = express.Router()

venueRoutes.get('/', allVenues)
venueRoutes.post('/new', authenticateUser, newVenue)
venueRoutes.put('/update', authenticateUser, venueUpdate )
venueRoutes.delete('/delete', authenticateUser, deleteVenue )
venueRoutes.get('/myvenue', authenticateUser, allUserVenue )
venueRoutes.get('/search', searchVenue )


export default venueRoutes
