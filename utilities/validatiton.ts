import express from "express"
import Joi from "joi"

export const signupValidation = Joi.object({
    username: Joi.string().min(6).max(30).pattern(/^(?=.*\d)/).required(),
    password: Joi.string().min(6).pattern(/^(?=.*[0-9])(?=.*[!@#$%^&*(),.?":{}|<>])/).required(),
    role: Joi.string().valid('user', 'venue owner').required(),
    email: Joi.string().email().required()
})

