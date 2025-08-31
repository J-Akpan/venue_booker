import express from "express"
import { Op } from "sequelize"
import User from "../models/Users"
import { signupValidation } from "../utilities/validatiton"
import { encryptPassword } from "../utilities/encryptPassword"

// find all users

export const allUsers = async (req: express.Request, res: express.Response) => {
    try {
        const fetchData = await User.findAll()
        return res.status(200).json(fetchData)
    } catch (error) {
        return res.status(500).json({ message: "Internal server error", error })
    }
}

//signup a new user
export const signUp = async (req: express.Request, res: express.Response) => {
    try {
        const { username, email, password, role } = req.body

        // validate user inputs
        const { error } = signupValidation.validate(req.body)
        if (error) {
            return res.status(400).json({
                message: "Validation error",
                details: error.details[0]?.message
            })
        }

        // check if user exists
        const existingUser = await User.findOne({
            where: {
                [Op.or]: [{ email }, { username }]
            }
        })
        if (existingUser) {
            return res.status(400).json({ message: "User already exists" })
        }

        //password hashing
        const hashed = await encryptPassword(password)
        console.log(hashed)
        const newUser = await User.create({ username, email, password: hashed, role })
        if (newUser) {
            return res.status(201).json({ message: "User created successfully", newUser })
        }
        return res.status(400).json({ message: "User not created" })

    } catch (error) {
        return res.status(500).json({ message: "Internal server error", error })

    }

}


//login a user
export const login = async (req: express.Request, res: express.Response) => {
    
}




