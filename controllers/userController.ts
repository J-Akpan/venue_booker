import express from "express"
import User from "../models/Users"

// find all users

const allUsers = async (req:express.Request, res:express.Response) =>{
    const fetchData = await User.findAll()
    return res.status(200).json(fetchData)

}


export default allUsers
