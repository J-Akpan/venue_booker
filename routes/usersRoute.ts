import express from "express"
import {allUsers, signUp} from "../controllers/userController"


const userRoutes:express.Router = express.Router()

userRoutes.get('/', allUsers)
userRoutes.post('/signup', signUp)


export default userRoutes
