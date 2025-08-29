import express from "express"
import Booking from "../models/Booking"

// find all Bookings

const allBookings = async (req:express.Request, res:express.Response) =>{
    const fetchData = await Booking.findAll()
    return res.status(200).json(fetchData)

}


export default allBookings
