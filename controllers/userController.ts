import express from "express"
import User from "../models/Users"
import { signupValidation } from "../utilities/validatiton"

// find all users

export const allUsers = async (req: express.Request, res: express.Response) => {
    try {
        const fetchData = await User.findAll()
        return res.status(200).json(fetchData)
    } catch (error) {
        return res.status(500).json({ message: "Internal server error", error })
    }
}

//signup user
export const signUp = async (req: express.Request, res: express.Response) => {
    try {
         const { username, email, password, role } = req.body 

         // validate user inputs
         const {error} = signupValidation.validate(req.body)
         if(error){
            return res.status(400).json({message: "Validation error", 
            details: error.details[0]?.message})
         }

         // check if user exists
         const existingUser = await User.findOne({where: {email}})
         if(existingUser){
            return res.status(400).json({message: "User already exists"})
         }

    } catch (error) {
        return res.status(500).json({ message: "Internal server error", error })
        
    }
   
    }




