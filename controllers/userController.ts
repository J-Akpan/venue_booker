import express from "express"
import { Op, where } from "sequelize"
import User from "../models/Users"
import { signupValidation, loginValidation, profileValidation } from "../utilities/validatiton"
import { encryptPassword, comparePassword } from "../utilities/encryptPassword"
import jwt from "jsonwebtoken"
import dotenv from "dotenv";
dotenv.config();
import { AuthRequest } from "../middlewares/userAuth"
import { log } from "console"

// find all users
export const allUsers = async (req: express.Request, res: express.Response) => {
    try {
        const fetchData = await User.findAll()
        return res.status(200).json(fetchData)
    } catch (error) {
        return res.status(500).json({ message: "Internal server error", error })
    }
}

// ****************************************************************************************
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
        const newUser = await User.create({ username, email, password: hashed, role })
        if (newUser) {
            return res.status(201).json({ message: "User created successfully", newUser })
        }
        return res.status(400).json({ message: "User not created" })

    } catch (error) {
        return res.status(500).json({ message: "Internal server error", error })
    }
}

// ******************************************************************************************
//login a user
/**
   * collect user input
   * validate user input
   * check if user exists
   * compare password
   * generate token
   * send response
   */
export const login = async (req: express.Request, res: express.Response) => {
    const privatKey = process.env.privateKey as string;
    try {
        const { username, password } = req.body

        //validate user inputs
        const { error } = loginValidation.validate(req.body)
        if (error) {
            return res.status(400).json({
                message: "Validation error", details: error.details[0]?.message
            })
        }
        //check is user exists
        const existingUser = await User.findOne({ where: { username } })
        if (!existingUser) {
            return res.status(400).json({ message: "User does not exist" })
        }
        const hashed = existingUser.get('password')
        //compare password
        const isPasswordValid = await comparePassword(password, hashed)
        if (!isPasswordValid) {
            return res.status(400).json({ message: "Invalid password" })
        }
        //generate token
        const payload = {
            userId: existingUser.get('userId'),
            username: existingUser.get('username'),
            email: existingUser.get('email'),
            role: existingUser.get('role'),
        }
        const token = jwt.sign(payload, privatKey, { expiresIn: '1h' })
        //verify token
        const verify = jwt.verify(token, privatKey)
        return res.status(200).json({
            message: "Login successful",
            // user: existingUser,
            token,
            verify
        })
    }
    catch (error) {
        return res.status(500).json({ message: "Internal server error", error })
    }
}
// *************************************************************************************

//profile management
/**
 * upload profile picture
 * update personal information
 * -name
 * -phone number
 * -state
 * 
 */

export const profile = async (req: AuthRequest, res: express.Response) => {
    try {
        const userId = req.user?.userId

        const {
            firstname,
            lastname,
            contact,
            address,
            gender,
        } = req.body

        // validate the req body
        const { error } = profileValidation.validate(req.body)
        if (error) {
            return res.status(400).json({
                message: "Validation error", details: error.details[0]?.message
            })
        }

        //check if user exists
        const existingUser = await User.findOne({ where: { userId } })
        if (!existingUser) {
            return res.status(400).json({ message: "User does not exist" })
        }

        //update user profile
        const updatedProfile = await User.update(
            {
                firstname,
                lastname,
                contact,
                address,
                gender
            },
            { where: { userId }}
        )
        if(updatedProfile){
            return res.status(200).json({message: "Profile updated successfully"})
        }
        return res.status(400).json({message: "Profile not updated"})

    } catch (error) {
        return res.status(500).json({ message: "Internal server error", error })

    }
}

// **************************************************************************************
//forgot passward / change password
export const changePassword = async (req: AuthRequest, res: express.Response) => {
    try {
        const { email, oldPassword, newPassword } = req.body
        //validate
        
       
       
        const userId = req.user?.userId
        const pass = await User.findOne({where:{userId}})
        const hashed = pass?.get('password')
        

        // await comparePassword(oldPassword, hashed)
    } catch (error) {
        return res.status(500).json({ message: "Internal server error", error })
    }
}
