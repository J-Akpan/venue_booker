import express from "express"
import {allUsers, signUp, login, profile, changePassword} from "../controllers/userController"
import { authenticateUser } from "../middlewares/userAuth"

const userRoutes:express.Router = express.Router()

userRoutes.get('/', authenticateUser, allUsers)
userRoutes.post('/signup', signUp)
userRoutes.post('/login', login)
userRoutes.put('/profile', authenticateUser,  profile)
userRoutes.post('/changepassword', authenticateUser,  changePassword)


export default userRoutes
