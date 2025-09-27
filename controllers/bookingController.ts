import express from "express"
import Booking from "../models/Booking"
import { AuthRequest } from "../middlewares/userAuth"
import User from "../models/Users"
import Venue from "../models/Venue"
import { console } from "inspector"
import { bookingValidation } from "../utilities/validatiton"


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

        const {
            venueId,
            bookingDate,
            bookingEndDate,
            startTime,
            endTime,
            totalPrice
        } = req.body

        const { error } = bookingValidation.validate(req.body)
        if(error){
            return res.status(400).json({msg: "Server Error", 
                error: error.details[0]?.message})
        }
        const checkVenue = await Venue.findOne({where: {venueId}})
        if(!checkVenue){
            return res.status(404).json({msg: "Venue not found"})
        }

        //check if the user has already booked the venue for the same date and time
        const existingBooking = await Booking.findOne({
            where: {
                venueId,
                bookingDate,
                startTime,
                endTime
            }
        })

        if(existingBooking){
            return res.status(400).json({msg: "Venue already booked for the selected date and time"})
        }
        
        const booking = await Booking.create({
            userId,
            venueId,
            bookingDate,
            bookingEndDate,
            startTime,
            endTime,
            totalPrice
        }) 
        return res.status(201).json({msg: "Booking successful", booking})

    } catch (error) {
        console.log(error)
        return res.status(500).json({msg: "Server error"})
    }
}





// **********************************************************************************************************