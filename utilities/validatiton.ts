import express from "express"
import Joi, { string } from "joi"

export const signupValidation = Joi.object({
    username: Joi.string().min(6).max(30).pattern(/^(?=.*\d)/).required(),
    password: Joi.string().min(6).pattern(/^(?=.*[0-9])(?=.*[!@#$%^&*(),.?":{}|<>])/).required(),
    role: Joi.string().valid('User', 'Venue Owner', 'Admin').required(),
    email: Joi.string().email().required()
})

export const loginValidation = Joi.object({
    username: Joi.string().min(6).max(30).pattern(/^(?=.*\d)/).required(),
    password: Joi.string().min(6).pattern(/^(?=.*[0-9])(?=.*[!@#$%^&*(),.?":{}|<>])/).required()
})

export const profileValidation = Joi.object({
    firstname: Joi.string().required(),
    lastname: Joi.string().required(),
    contact: Joi.string().required(),
    address: Joi.string().required(),
    gender: Joi.string().required(),
})

export const changePasswordValidation = Joi.object({
    oldPassword: Joi.string().required(),
    newPassword: Joi.string().min(6).pattern(/^(?=.*[0-9])(?=.*[!@#$%^&*(),.?":{}|<>])/).required(),
    confirmPassword: Joi.string().required()

})

export const forgotPasswordValidation = Joi.object({
    email: Joi.string().email().required()
})

export const changeValidation = Joi.object({
    otp: Joi.string().required(),
    newPassword: Joi.string().min(6).pattern(/^(?=.*[0-9])(?=.*[!@#$%^&*(),.?":{}|<>])/).required(),
    confirmPassword: Joi.string().required()

})

// **********************************************************************************************************?
// venue validatikon
// ************************************************************

export const newVenueValidation = Joi.object({
    names: Joi.string().required(),
    description: Joi.string().required(),
    location: Joi.string().required(),
    capacity: Joi.string().required(),
    pricePerHour : Joi.string().required(),
    contact: Joi.string().required()
})

export const updateVenueValidation = Joi.object({
    names: Joi.string().required(),
    description: Joi.string(),
    location: Joi.string(),
    capacity: Joi.string(),
    pricePerHour : Joi.string(),
    contact: Joi.string()
})

export const deleteVenueValidation = Joi.object({
    names: Joi.string().required()
})

export const searchVenueValidation = Joi.object({
    searchTerm: Joi.string().required()
})

export const bookingValidation = Joi.object({
    venueId: Joi.string().required(),
    bookingDate: Joi.date().required(),
    bookingEndDate: Joi.date().required(),
    startTime: Joi.string().required(),
    endTime: Joi.string().required(),
    totalPrice: Joi.number().required()
})
// **********************************************************************************************************
