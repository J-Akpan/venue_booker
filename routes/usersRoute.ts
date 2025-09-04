import express from "express"
import {allUsers, signUp, login, profile, changePassword, forgotPassword, resetPassword} from "../controllers/userController"
import { authenticateUser } from "../middlewares/userAuth"

const userRoutes:express.Router = express.Router()

userRoutes.get('/', authenticateUser, allUsers)
userRoutes.post('/signup', signUp)
userRoutes.post('/login', login)
userRoutes.put('/profile', authenticateUser,  profile)
userRoutes.put('/changepassword', authenticateUser,  changePassword)
userRoutes.post('/forgotpassword', authenticateUser,  forgotPassword)
userRoutes.put('/updatepassword', authenticateUser, resetPassword)

export default userRoutes
