import express from "express"
import Booking from "../models/Booking"
import { AuthRequest } from "../middlewares/userAuth"
import User from "../models/Users"
import Venue from "../models/Venue"
import { console } from "inspector"


// find all Bookings

export const allBookings = async (req:AuthRequest, res:express.Response) =>{
    const fetchData = await Booking.findAll()
    return res.status(200).json(fetchData)
}

// find all Bookings for a user

export const allUserBookings = async (req:AuthRequest, res:express.Response) =>{
    const userId = req.user?.userId
    if(!userId){
        return res.status(400).json({msg: "error getting the ID"})
    }
    const fetchData = await Booking.findAll({where: {userId}, include: [User, Venue]})
    return res.status(200).json(fetchData)
}

// create a booking

export const newBooking = async (req:AuthRequest, res:express.Response) =>{
    try {
        const userId = req.user?.userId
        if(!userId){
            return res.status(400).json({msg: "error getting the ID"})
        }

        const {venueId, 
            bookingDate, 
            bookingEndDate, 
            startTime, 
            endTime, 
            totalPrice} = req.body


    } catch (error) {
        console.log(error)
        return res.status(500).json({msg: "Server error"})
    }
}