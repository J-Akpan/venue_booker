import express from "express"
import Venue from "../models/Venue"

// find all users

const allVenues = async (req:express.Request, res:express.Response) =>{
    const fetchData = await Venue.findAll()
    return res.status(200).json(fetchData)
}


export default allVenues
