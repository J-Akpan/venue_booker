import express from "express"
import { AuthRequest } from "../middlewares/userAuth"
import Venue from "../models/Venue"
import User from "../models/Users"
import { newVenueValidation } from "../utilities/validatiton"

// find all users

const allVenues = async (req: express.Request, res: express.Response) => {
    const fetchData = await Venue.findAll()
    return res.status(200).json(fetchData)
}

/**
 * create venue
 * validate inpute 
 * submit if user is a venue owner
 */

export const newVenue = async (req: AuthRequest, res: express.Response) => {
    try {
        const user = await User.findOne()

        //req body
        const { names, description, location, capacity, pricePerHour, contact } = req.body

        const { error } = newVenueValidation.validate(req.body)
        if (error) {
            res.status(400).json({ msg: "Validation error", details: error.details[0]?.message })
        }

        const userId = user?.get('userId')
        if(!userId){
            return res.status(400).json({msg: "error getting the ID"})
        }

        const createVenue = await Venue.create({
            names,
            description, 
            location, 
            capacity, 
            pricePerHour, 
            userId, 
            contact,
        })

        if (!createVenue){
            return res.status(400).json({msg: "Server error"})
        }
        return res.status(201).json({msg: "Venue created successfully"})

    } catch (error) {
        return res.status(500).json({ msg: "server Error", error })
    }

}
// ***********************************************************************************

//Update venue details

