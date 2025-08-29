import express from "express"
import allUsers from "../controllers/userController"


const userRoutes:express.Router = express.Router()

userRoutes.get('/', allUsers)


export default userRoutes
