import express from "express"
import { AuthRequest } from "../middlewares/userAuth"
import Venue from "../models/Venue"
import User from "../models/Users"
import {newVenueValidation} from "../utilities/validatiton"

// find all users

const allVenues = async (req:express.Request, res:express.Response) =>{
    const fetchData = await Venue.findAll()
    return res.status(200).json(fetchData)
}

/**
 * create venue
 * validate inpute 
 * submit if user is a venue owner
 */

export const newVenue = async (req:AuthRequest, res:express.Response)=>{
    try {
        const user = await User.findOne()
        const userId  = user?.get('userId')

        //req body
        const {names, description, location, capacity, pricePerHour, constact} = req.body

        const {error} = newVenueValidation.validate(req.body)

        


        
    } catch (error) {
       return res.status(500).json({msg: "server Error", error})
    }

}


export default allVenues
