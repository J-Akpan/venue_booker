import express from "express"
import {Op} from "sequelize"
import { AuthRequest } from "../middlewares/userAuth"
import Venue from "../models/Venue"
import User from "../models/Users"
import { newVenueValidation, 
    updateVenueValidation,
    deleteVenueValidation,
    searchVenueValidation
 } from "../utilities/validatiton"

// find all users

export const allVenues = async (req: express.Request, res: express.Response) => {
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

        //req body
        const { names, description, location, capacity, pricePerHour, contact } = req.body

        const { error } = newVenueValidation.validate(req.body)
        if (error) {
            res.status(400).json({ msg: "Validation error", details: error.details[0]?.message })
        }

        const userId = req.user?.userId
        if(!userId){
            return res.status(400).json({msg: "error getting the ID"})
        }

        const ifVenueExist = await Venue.findOne({where: {userId, names}})
        if (ifVenueExist){
            return res.status(400).json({msg: "A venue with same name is already registered by you"})
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
export const venueUpdate = async (req:AuthRequest, res:express.Response) =>{
    const userId = req.user?.userId
    const { names, description, location, capacity, pricePerHour, contact } = req.body

    const {error} = updateVenueValidation.validate(req.body)
    if(error){
        return res.status(400).json({msg: "Validation error", details: error.details[0]?.message})
    }

    const ifVenueExist = await Venue.findOne({where: {userId, names}})
    if (!ifVenueExist){return res.status(400).json({msg: "You don't have venue with such name to update"})}

    const update = await Venue.update(
        {names, description, location, capacity, pricePerHour, contact},
        {where: {userId, names}
    })

    if (!update){
        return res.status(400).json({msg: "Error while updating "})
    }
    return res.status(201).json({msg: "Update successful"})   
}

// *******************************************************************************************
// delete venue

export const deleteVenue = async (req: AuthRequest, res: express.Response) =>{
    const userId = req.user?.userId
    const {names} = req.body

    const {error} = deleteVenueValidation.validate(req.body)
    if(error){
        return res.status(400).json({msg: "validation error", details: error.details[0]?.message})
    }

    const venueExist = await Venue.findOne({where: {userId, names}})
    if(!venueExist) {
        return res.status(404).json({msg: " Venue not  found"})
    }
    await Venue.destroy({where: {userId, names}})
    return res.status(201).json({msg: "Venue deleted successfully"})
}

// ******************************************************************************************************?

//search venues by users based on location, price, capacity

export const searchVenue = async (req:AuthRequest, res:express.Response) =>{
    const {searchTerm} = req.body

    const {error} = searchVenueValidation.validate(req.body)
    if(error){
        return res.status(400).json({msg: "Validation error", details: error.details[0]?.message})
    }

    const search = await Venue.findAll(
     {where: {
        [Op.or]: [
         { names: {[Op.iLike]: `%${searchTerm}%`}},
          {capacity: {[Op.iLike]: `%${searchTerm}%`}},
          {pricePerHour: {[Op.iLike]: `%${searchTerm}%`}},
          {location: {[Op.iLike]: `%${searchTerm}%`}},
        ]
     }}
    )
    if(!search){
        return res.status(400).json({msg: "Search term not found"})
    }

    return res.status(200).json(search)
}

// ********************************************************************************************************************************?
//list all venues registered by a single user
export const allUserVenue = async (req:AuthRequest, res:express.Response)=>{
    const userId = req.user?.userId

    const ownerVenue = await User.findAll({
        include: {model: Venue,
            where: {userId}
        }
    })
    if (ownerVenue){
        return res.status(200).json(ownerVenue)
    }

    return res.status(400).json({msg: "Server error"})

} 

